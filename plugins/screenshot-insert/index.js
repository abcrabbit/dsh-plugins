/**
 * Host half of the screenshot-insert bundle.
 *
 * The Web client renders a light-green screenshot button beside the composer's
 * prompt-enhance action. A click posts to this plugin's one authenticated exact
 * route, which captures the screen on a background child process and answers
 * the raw PNG:
 *
 * - Windows: PowerShell captures the monitor under the mouse cursor; the
 *   browser shows the frozen capture and the operator frames a region.
 * - macOS: the system `screencapture` tool runs in interactive selection mode
 *   (the normal macOS crosshair, including Space for window selection); the
 *   browser goes straight to the annotation editor with the selected region.
 *
 * The browser then lets the operator mark the capture with rectangles and
 * arrows and inserts the confirmed PNG into the composer as a runtime image
 * draft attachment. The route is a plain `webServer` exact route; Connection's
 * own trust checks and signed-browser-cookie admission guard it exactly like
 * `/api`. Capture arguments are constant: request data never becomes command
 * text, and no captured bytes are written anywhere except a private temporary
 * directory that is deleted before the response is sent.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The one route this plugin owns. Keep it in sync with `client.js`. */
const ROUTE_PATH = '/dsh-screenshot/capture'
/** Response header telling the browser the PNG is already a selected region. */
const REGION_HEADER = 'x-dsh-capture-region'
/** End-to-end budget for one Windows capture child; first-run PowerShell start is the slow path. */
const WINDOWS_CAPTURE_TIMEOUT_MS = 20000
/** Interactive macOS selection may legitimately stay open while the operator frames. */
const DARWIN_CAPTURE_TIMEOUT_MS = 300000
/** Refuse parallel captures instead of stacking capture children. */
const MAX_CONCURRENT_CAPTURES = 2
/** Keep a bounded slice of child stderr for Host diagnostics only. */
const MAX_STDERR_CHARS = 4096
/** Windows PowerShell flags; the script is encoded, so no quoting surface remains. */
const POWERSHELL_FLAGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']
/** The constant Windows capture script, shipped beside this module. */
const CAPTURE_SCRIPT = readFileSync(fileURLToPath(new URL('./capture.ps1', import.meta.url)), 'utf8')
/** `-EncodedCommand` expects base64 of UTF-16LE script text. */
const CAPTURE_SCRIPT_BASE64 = Buffer.from(CAPTURE_SCRIPT, 'utf16le').toString('base64')
/** The system screenshot tool on macOS. */
const DARWIN_SCREENCAPTURE = '/usr/sbin/screencapture'

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
 * Register the capture route and track the PowerShell children it starts.
 * @param ctx - Host plugin Context.
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  const connection = ctx.connection
  const children = new Set()
  let inFlight = 0

  ctx.effect(
    () => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (request, response) => handleRequest(ctx, connection, request, response, children, {
        enter: () => {
          if (inFlight >= MAX_CONCURRENT_CAPTURES) return false
          inFlight += 1
          return true
        },
        leave: () => { inFlight -= 1 },
      }),
    }),
    'screenshot-insert: capture route',
  )

  ctx.effect(() => () => {
    for (const child of children) {
      try {
        child.kill()
      } catch (error) {
        // A child that already exited needs no cleanup.
      }
    }
    children.clear()
  }, 'screenshot-insert: capture children')
}

/**
 * Answer one capture request with the raw PNG of the cursor's monitor.
 * @param ctx - Host plugin Context.
 * @param connection - Host Connection service (route trust + browser auth).
 * @param request - Incoming HTTP request.
 * @param response - Incoming HTTP response.
 * @param children - live PowerShell children owned by this plugin.
 * @param gate - concurrency gate for capture children.
 */
async function handleRequest(ctx, connection, request, response, children, gate) {
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
    // The capture body carries no input; drain it so the connection can close.
    request.resume()
    if (!gate.enter()) {
      sendJson(response, 429, { ok: false, code: 'capture-busy', message: 'another screen capture is already in flight' })
      return
    }
    try {
      const capture = await captureScreen(ctx, children)
      sendPng(response, capture.bytes, capture.region)
    } catch (error) {
      if (response.writableEnded || response.destroyed) return
      const code = error instanceof CaptureError ? error.code : 'capture-failed'
      const status = code === 'capture-timeout'
        ? 504
        : code === 'capture-unavailable'
          ? 501
          : code === 'capture-cancelled'
            ? 409
            : 500
      warnFail(ctx, error instanceof Error ? error.message : String(error))
      sendJson(response, status, { ok: false, code, message: 'the screen capture failed' })
    } finally {
      gate.leave()
    }
  } catch (error) {
    warnFail(ctx, describe(error))
    sendJson(response, 500, { ok: false, code: 'internal', message: 'the screen capture request could not be completed' })
  }
}

/**
 * Capture the screen into PNG bytes with the platform's standard mechanism.
 * @param ctx - Host plugin Context (for platform diagnostics).
 * @param children - live capture children owned by this plugin.
 * @returns the PNG bytes and whether they already hold one selected region.
 * @throws {CaptureError} when the platform has no supported capture path.
 */
async function captureScreen(ctx, children) {
  const platform = process.platform
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new CaptureError('capture-unavailable', 'screen capture is only supported on Windows and macOS')
  }
  const directory = await mkdtemp(join(tmpdir(), 'dsh-screenshot-'))
  const outputPath = join(directory, 'screen.png')
  try {
    if (platform === 'darwin') {
      await runDarwinCapture(ctx, children, outputPath)
      const bytes = await readFile(outputPath)
      if (!hasPngSignature(bytes)) throw new CaptureError('capture-failed', 'screencapture did not produce a PNG')
      return { bytes, region: true }
    }
    await runCaptureScript(ctx, children, outputPath)
    const bytes = await readFile(outputPath)
    if (!hasPngSignature(bytes)) throw new CaptureError('capture-failed', 'the capture child did not produce a PNG')
    return { bytes, region: false }
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
 * @param children - live capture children owned by this plugin.
 * @param outputPath - destination PNG path.
 * @returns a promise settled after the child exited with a capture on disk.
 * @throws {CaptureError} on spawn failure, timeout, or cancelled selection.
 */
function runDarwinCapture(ctx, children, outputPath) {
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
    children.add(child)
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      children.delete(child)
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
      // Interactive selection writes the PNG only on a completed selection; a
      // cancelled selection (Escape, empty drag) leaves no file.
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
 * Run the constant capture script with one bounded PowerShell child.
 * @param ctx - Host plugin Context (for diagnostics).
 * @param children - live PowerShell children owned by this plugin.
 * @param outputPath - destination PNG path passed through the environment.
 * @returns a promise settled after the child exited successfully.
 * @throws {CaptureError} on spawn failure, non-zero exit, or timeout.
 */
function runCaptureScript(ctx, children, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawn(powershellPath(), [...POWERSHELL_FLAGS, CAPTURE_SCRIPT_BASE64], {
        env: { ...process.env, DSH_SCREENSHOT_OUT: outputPath },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (error) {
      rejectPromise(new CaptureError('capture-failed', describe(error), error))
      return
    }
    children.add(child)
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      children.delete(child)
      if (error === undefined) resolvePromise()
      else rejectPromise(error)
    }
    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch (error) {
        // The child may have exited between the timer and this kill.
      }
    }, WINDOWS_CAPTURE_TIMEOUT_MS)
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
      if (code === 0) {
        settle(undefined)
        return
      }
      if (stderr !== '') warnFail(ctx, stderr)
      settle(new CaptureError('capture-failed', `the screen capture child exited with code ${String(code)}`))
    })
  })
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

/**
 * Write one PNG response without throwing on a dead socket.
 * @param response - Incoming HTTP response.
 * @param bytes - PNG bytes.
 * @param region - whether the PNG already holds one selected region.
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
 * Describe an unknown failure for Host-side diagnostics.
 * @param error - caught value.
 * @returns its message.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Report one Host-side failure without echoing captured pixels or paths.
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
