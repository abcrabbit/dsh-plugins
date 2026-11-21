/**
 * Host half of the screenshot-insert bundle.
 *
 * The Web client renders a light-green screenshot button beside the composer's
 * prompt-enhance action. One authenticated exact route answers three actions:
 *
 * - info: the running platform and the capture modes it supports.
 * - windows: the capturable top-level windows (Windows only) for the picker.
 * - capture: a PNG of the requested mode.
 *     area       - the whole virtual desktop (every monitor) as-is
 *     area-clean - same, with the DSH window minimized for the shot so other
 *                  windows and other screens are visible; DSH is restored after
 *     window     - one chosen top-level window, brought to the front briefly
 *     native     - macOS only: the system interactive selection (all displays,
 *                  window selection with Space)
 *
 * The browser then lets the operator mark the capture with rectangles and
 * arrows and inserts the confirmed PNG into the composer as a runtime image
 * draft attachment.
 *
 * Windows captures run in one long-lived PowerShell worker (capture.ps1) that
 * compiles its native helpers once, so repeated captures stay fast. The macOS
 * path spawns the system `screencapture` per request. Request data never
 * becomes command text, and captured bytes are written only to a private
 * temporary directory deleted before the response is sent. The route is a
 * plain `webServer` exact route; Connection's own trust checks and
 * signed-browser-cookie admission guard it exactly like `/api`.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The one route this plugin owns. Keep it in sync with `client.js`. */
const ROUTE_PATH = '/dsh-screenshot/request'
/** Response header telling the browser the PNG already holds one region/window. */
const REGION_HEADER = 'x-dsh-capture-region'
/** Actions this route answers. */
const ACTIONS = ['info', 'windows', 'capture']
/** Capture modes each platform supports. */
const WINDOWS_MODES = ['area-clean', 'area', 'window']
const DARWIN_MODES = ['native']
/** Refuse parallel actions instead of stacking heavy captures. */
const MAX_CONCURRENT_ACTIONS = 2
/** Longest single Windows capture action (hide/restore and foreground waits included). */
const CAPTURE_TIMEOUT_MS = 30000
/** Longest window list action. */
const LIST_TIMEOUT_MS = 20000
/** Longest first start of the Windows capture worker (C# compile included). */
const WORKER_READY_TIMEOUT_MS = 30000
/** Interactive macOS selection may legitimately stay open while the operator frames. */
const DARWIN_CAPTURE_TIMEOUT_MS = 300000
/** One request is a small JSON object. */
const MAX_BODY_BYTES = 8192
/** Keep a bounded slice of child stderr for Host diagnostics only. */
const MAX_STDERR_CHARS = 4096
/** Window handles are decimal strings. */
const WINDOW_ID_PATTERN = /^[0-9]{1,20}$/
/** The system screenshot tool on macOS. */
const DARWIN_SCREENCAPTURE = '/usr/sbin/screencapture'
/** The long-lived Windows capture worker shipped beside this module. */
const WINDOWS_CAPTURE_WORKER = fileURLToPath(new URL('./capture.ps1', import.meta.url))

/** Services the Host half needs before it can register the route. */
export const inject = ['webServer', 'connection']

/** Failure carrying a stable code so the Client can localize it. */
class CaptureError extends Error {
  /**
   * @param code - stable failure code placed in the JSON response.
   * @param message - Host-side detail, never shown verbatim to the user.
   * @param cause - underlying failure, when there is one.
   */
  constructor(code, message, cause) {
    super(message === undefined ? code : message)
    this.name = 'CaptureError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * Register the screenshot route and, on Windows, one pre-warmed capture worker.
 * @param ctx - Host plugin Context.
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  const connection = ctx.connection
  const worker = new WindowsCaptureWorker(ctx.logger)
  let inFlight = 0

  ctx.effect(
    () => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (request, response) => handleRequest(ctx, connection, request, response, worker, {
        enter: () => {
          if (inFlight >= MAX_CONCURRENT_ACTIONS) return false
          inFlight += 1
          return true
        },
        leave: () => { inFlight -= 1 },
      }),
    }),
    'screenshot-insert: capture route',
  )

  ctx.effect(() => {
    const timer = setTimeout(() => { worker.prewarm() }, 2500)
    return () => {
      clearTimeout(timer)
      worker.dispose()
    }
  }, 'screenshot-insert: capture worker')
}

/**
 * Answer one screenshot action.
 * @param ctx - Host plugin Context.
 * @param connection - Host Connection service (route trust + browser auth).
 * @param request - Incoming HTTP request.
 * @param response - Incoming HTTP response.
 * @param worker - Windows capture worker owned by this plugin.
 * @param gate - concurrency gate for capture actions.
 */
async function handleRequest(ctx, connection, request, response, worker, gate) {
  try {
    const rejection = connection.requestRejection({ headers: request.headers })
    if (rejection !== undefined) {
      sendJson(response, rejection, { ok: false, code: 'unauthorized', message: 'request is not an authenticated browser request' })
      return
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, code: 'method-not-allowed', message: 'only POST is accepted' })
      return
    }
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, 400, { ok: false, code: 'bad-request', message: 'the request body is not a JSON object' })
      return
    }
    const action = typeof body.action === 'string' ? body.action : 'capture'
    if (!ACTIONS.includes(action)) {
      sendJson(response, 400, { ok: false, code: 'bad-request', message: 'unknown screenshot action' })
      return
    }
    if (!gate.enter()) {
      sendJson(response, 429, { ok: false, code: 'capture-busy', message: 'another screenshot action is already in flight' })
      return
    }
    try {
      if (action === 'info') {
        sendJson(response, 200, { ok: true, platform: process.platform, modes: supportedModes() })
        return
      }
      if (action === 'windows') {
        await handleWindowList(ctx, response, worker)
        return
      }
      await handleCapture(ctx, response, worker, body)
    } catch (error) {
      const code = error instanceof CaptureError ? error.code : 'capture-failed'
      const status = code === 'capture-timeout'
        ? 504
        : code === 'capture-unavailable'
          ? 501
          : code === 'capture-cancelled'
            ? 409
            : code === 'bad-request'
              ? 400
              : 500
      warnFail(ctx, error instanceof Error ? error.message : String(error))
      if (!response.writableEnded && !response.destroyed) {
        sendJson(response, status, { ok: false, code, message: 'the screenshot action failed' })
      }
    } finally {
      gate.leave()
    }
  } catch (error) {
    warnFail(ctx, describe(error))
    sendJson(response, 500, { ok: false, code: 'internal', message: 'the screenshot request could not be completed' })
  }
}

/** Capture modes the running platform supports. */
function supportedModes() {
  if (process.platform === 'win32') return WINDOWS_MODES
  if (process.platform === 'darwin') return DARWIN_MODES
  return []
}

/**
 * Answer the capturable top-level window list (Windows only).
 * @param ctx - Host plugin Context.
 * @param response - Incoming HTTP response.
 * @param worker - Windows capture worker.
 */
async function handleWindowList(ctx, response, worker) {
  if (process.platform !== 'win32') {
    throw new CaptureError('capture-unavailable', 'window capture is only supported on Windows')
  }
  const result = await worker.execute({ mode: 'list' }, LIST_TIMEOUT_MS)
  if (result === null || typeof result !== 'object' || result.ok !== true || !Array.isArray(result.windows)) {
    throw new CaptureError('window-list-failed', 'the capture worker did not return a window list')
  }
  const windows = []
  for (const entry of result.windows) {
    if (windows.length >= 60) break
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string' || !WINDOW_ID_PATTERN.test(entry.id)) continue
    if (typeof entry.title !== 'string' || entry.title === '') continue
    windows.push({
      id: entry.id,
      title: entry.title.slice(0, 300),
      process: typeof entry.process === 'string' ? entry.process.slice(0, 120) : '',
      iconic: entry.iconic === true,
    })
  }
  sendJson(response, 200, { ok: true, windows })
}

/**
 * Run one capture and answer the raw PNG.
 * @param ctx - Host plugin Context.
 * @param response - Incoming HTTP response.
 * @param worker - Windows capture worker.
 * @param body - parsed request body (mode, optional window id).
 */
async function handleCapture(ctx, response, worker, body) {
  const platform = process.platform
  if (platform === 'darwin') {
    await captureDarwin(ctx, response)
    return
  }
  if (platform !== 'win32') {
    throw new CaptureError('capture-unavailable', 'screen capture is only supported on Windows and macOS')
  }
  const rawMode = typeof body.mode === 'string' ? body.mode : 'area'
  const mode = rawMode === 'native' ? 'area' : rawMode
  if (!WINDOWS_MODES.includes(mode)) {
    throw new CaptureError('bad-request', 'unknown capture mode')
  }
  let windowId
  if (mode === 'window') {
    if (typeof body.window !== 'string' || !WINDOW_ID_PATTERN.test(body.window)) {
      throw new CaptureError('bad-request', 'window capture needs a numeric window handle')
    }
    windowId = body.window
  }
  const directory = await mkdtemp(join(tmpdir(), 'dsh-screenshot-'))
  const outputPath = join(directory, 'screen.png')
  try {
    const result = await worker.execute({
      mode,
      output: outputPath,
      ...windowId === undefined ? {} : { window: windowId },
    }, CAPTURE_TIMEOUT_MS)
    if (result === null || typeof result !== 'object' || result.ok !== true) {
      const detail = result !== null && typeof result === 'object' && typeof result.error === 'string' ? result.error : 'the capture worker failed'
      const code = mode === 'window' ? 'window-capture-failed' : 'capture-failed'
      throw new CaptureError(code, detail)
    }
    const bytes = await readFile(outputPath)
    if (!hasPngSignature(bytes)) throw new CaptureError('capture-failed', 'the capture worker did not produce a PNG')
    sendPng(response, bytes, mode === 'window')
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Run the macOS system selection and answer the selected region.
 * @param ctx - Host plugin Context.
 * @param response - Incoming HTTP response.
 */
async function captureDarwin(ctx, response) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-screenshot-'))
  const outputPath = join(directory, 'screen.png')
  try {
    await runDarwinCapture(ctx, outputPath)
    const bytes = await readFile(outputPath)
    if (!hasPngSignature(bytes)) throw new CaptureError('capture-failed', 'screencapture did not produce a PNG')
    sendPng(response, bytes, true)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Run macOS `screencapture` in interactive selection mode. The user frames the
 * region (or presses Space for a window) in the standard system crosshair; an
 * Escape or other cancel leaves no file and is reported as a cancelled capture
 * so the browser can dismiss silently.
 * @param ctx - Host plugin Context (for diagnostics).
 * @param outputPath - destination PNG path.
 * @returns a promise settled after the child exited with a capture on disk.
 * @throws {CaptureError} on spawn failure, timeout, or cancelled selection.
 */
function runDarwinCapture(ctx, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawn(DARWIN_SCREENCAPTURE, ['-i', '-x', '-t', 'png', outputPath], {
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (error) {
      rejectPromise(new CaptureError('capture-failed', describe(error), error))
      return
    }
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolvePromise()
      else rejectPromise(error)
    }
    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch (error) {
        // The child may have exited between the timer and this signal.
      }
    }, DARWIN_CAPTURE_TIMEOUT_MS)
    child.stderr?.on('data', (chunk) => {
      if (stderr.length >= MAX_STDERR_CHARS) return
      stderr += String(chunk)
    })
    child.once('error', (error) => settle(new CaptureError('capture-failed', describe(error), error)))
    child.once('close', (code) => {
      if (timedOut) {
        settle(new CaptureError('capture-timeout', 'the screen capture timed out'))
        return
      }
      if (!existsSync(outputPath)) {
        if (stderr !== '') warnFail(ctx, stderr)
        settle(new CaptureError('capture-cancelled', 'the region selection was cancelled'))
        return
      }
      if (code === 0) {
        settle(undefined)
        return
      }
      if (stderr !== '') warnFail(ctx, stderr)
      settle(new CaptureError('capture-failed', `screencapture exited with code ${String(code)}`))
    })
  })
}

/**
 * One long-lived Windows capture worker: starts `capture.ps1`, then exchanges
 * one JSON request/response line per action. Serialized per worker; a failed or
 * timed-out worker is discarded and restarted by the next action.
 */
class WindowsCaptureWorker {
  /**
   * @param logger - Host logger (may be absent).
   */
  constructor(logger) {
    this.logger = logger
    this.child = null
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
    this.readyTimer = null
    this.pending = null
    this.buffer = ''
    this.stderr = ''
    this.queue = Promise.resolve()
    this.disposed = false
  }

  /** Start the worker once and resolve when it reports ready. */
  ensure() {
    if (this.disposed) return Promise.reject(new CaptureError('capture-unavailable', 'the capture worker is disposed'))
    if (this.readyPromise !== null) return this.readyPromise
    let child
    try {
      child = spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_CAPTURE_WORKER], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      return Promise.reject(new CaptureError('capture-unavailable', describe(error), error))
    }
    this.child = child
    this.buffer = ''
    this.stderr = ''
    const ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      this.readyTimer = setTimeout(() => {
        this.fail(new CaptureError('capture-timeout', 'the capture worker did not start in time'))
      }, WORKER_READY_TIMEOUT_MS)
    })
    this.readyPromise = ready
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { this.onStdout(chunk) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      if (this.stderr.length >= MAX_STDERR_CHARS) return
      this.stderr += chunk
    })
    child.once('error', (error) => { this.fail(new CaptureError('capture-unavailable', describe(error), error)) })
    child.once('close', () => { this.fail(new CaptureError('capture-unavailable', 'the capture worker exited')) })
    return ready
  }

  /** Read complete JSON lines from the worker's stdout. */
  onStdout(chunk) {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch (error) {
        continue
      }
      if (message !== null && typeof message === 'object' && message.ready === true) {
        if (this.readyTimer !== null) {
          clearTimeout(this.readyTimer)
          this.readyTimer = null
        }
        const resolve = this.readyResolve
        this.readyResolve = null
        this.readyReject = null
        if (resolve !== null) resolve()
        continue
      }
      const pending = this.pending
      if (pending !== null) {
        this.pending = null
        if (pending.timer !== null) clearTimeout(pending.timer)
        pending.resolve(message)
      }
    }
  }

  /** Drop the worker and reject everything waiting on it. */
  fail(error) {
    const child = this.child
    this.child = null
    this.readyPromise = null
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    const rejectReady = this.readyReject
    this.readyResolve = null
    this.readyReject = null
    if (rejectReady !== null) rejectReady(error)
    const pending = this.pending
    this.pending = null
    if (pending !== null) {
      if (pending.timer !== null) clearTimeout(pending.timer)
      pending.reject(error)
    }
    if (child !== null && child.exitCode === null) {
      try {
        child.kill()
      } catch (error) {
        // Already gone.
      }
    }
    if (child !== null && this.stderr !== '') {
      const message = this.stderr.slice(0, 800)
      this.stderr = ''
      try {
        this.logger?.warn?.('screenshot-insert: capture worker: ' + message)
      } catch (error) {
        // Logging must never break the response path.
      }
    }
  }

  /**
   * Run one action on the worker, serialized behind earlier actions.
   * @param request - JSON-serializable worker request.
   * @param timeoutMs - bound for this one action.
   * @returns the worker's JSON response.
   */
  execute(request, timeoutMs) {
    const run = this.queue.then(() => this.doExecute(request, timeoutMs))
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Wait for ready, then send one request line and await its response line. */
  doExecute(request, timeoutMs) {
    return new Promise((resolve, reject) => {
      this.ensure().then(() => {
        if (this.disposed || this.child === null) {
          reject(new CaptureError('capture-unavailable', 'the capture worker is not available'))
          return
        }
        const pending = { resolve, reject, timer: null }
        this.pending = pending
        pending.timer = setTimeout(() => {
          if (this.pending !== pending) return
          this.pending = null
          this.fail(new CaptureError('capture-timeout', 'the capture action timed out'))
        }, timeoutMs)
        try {
          this.child.stdin.write(JSON.stringify(request) + '\n')
        } catch (error) {
          if (this.pending === pending) this.pending = null
          if (pending.timer !== null) clearTimeout(pending.timer)
          this.fail(new CaptureError('capture-unavailable', describe(error), error))
        }
      }, (error) => { reject(error) })
    })
  }

  /** Start the worker in the background on Windows so the first click is fast. */
  prewarm() {
    if (process.platform !== 'win32' || this.disposed) return
    this.ensure().catch(() => {})
  }

  /** Stop the worker for good. */
  dispose() {
    this.disposed = true
    this.fail(new CaptureError('capture-unavailable', 'the capture worker is disposed'))
  }
}

/**
 * Resolve the Windows PowerShell executable from the system root.
 * @returns the absolute executable path.
 */
function powershellPath() {
  const root = typeof process.env.SystemRoot === 'string' && process.env.SystemRoot !== ''
    ? process.env.SystemRoot
    : typeof process.env.windir === 'string' && process.env.windir !== ''
      ? process.env.windir
      : 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Whether the bytes start with the PNG signature. */
function hasPngSignature(bytes) {
  return bytes.length > 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
}

/**
 * Write one PNG response without throwing on a dead socket.
 * @param response - Incoming HTTP response.
 * @param bytes - PNG bytes.
 * @param region - whether the PNG already holds one selected region/window.
 */
function sendPng(response, bytes, region) {
  if (response.writableEnded || response.destroyed) return
  try {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      [REGION_HEADER]: region === true ? '1' : '0',
    })
    response.end(bytes)
  } catch (error) {
    response.destroy?.()
  }
}

/**
 * Write one JSON response without throwing on a dead socket.
 * @param response - Incoming HTTP response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(response, status, body) {
  if (response.writableEnded || response.destroyed) return
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify(body))
  } catch (error) {
    response.destroy?.()
  }
}

/**
 * Read and parse one bounded JSON request body; an empty body answers `{}`.
 * @param request - Incoming HTTP request.
 * @returns the parsed JSON object.
 */
function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    let settled = false
    const settle = (error, value) => {
      if (settled) return
      settled = true
      if (error !== undefined) rejectPromise(error)
      else resolvePromise(value)
    }
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settle(new Error('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        settle(undefined, {})
        return
      }
      try {
        const value = JSON.parse(text)
        settle(undefined, value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {})
      } catch (error) {
        settle(error)
      }
    })
    request.on('error', (error) => settle(error))
  })
}

/**
 * Describe an unknown failure for Host-side diagnostics.
 * @param error - caught value.
 * @returns its message.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Report one Host-side failure without echoing captured pixels or user paths.
 * @param ctx - Host plugin Context.
 * @param message - fixed diagnostic.
 */
function warnFail(ctx, message) {
  try {
    ctx.logger?.warn?.(`screenshot-insert: ${message}`)
  } catch (error) {
    // Logging must never break the response path.
  }
}
