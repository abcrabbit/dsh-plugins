/**
 * Host half of the deliverable-link-route bundle.
 *
 * The Web client renders a hover menu on conversation file links (blue Markdown
 * file links / inline file references) with four actions: open with the system
 * default program, open the containing folder, copy the file, and copy the
 * file's full path. All four need Host capabilities the browser does not have,
 * so this standalone host-only bundle serves one authenticated HTTP route that
 *
 *  1. resolves the path taken from the link's `title` attribute against the
 *     Session workspace cwd (or as an absolute path) through the composed
 *     filesystem, never trusting the client string as a Host path; and
 *  2. opens or reveals the resolved path through the Session controller, or
 *     writes the Windows clipboard from a short-lived PowerShell child whose
 *     payload arrives through an environment variable.
 *
 * It lives in its own package so a running Host can load it fresh: the original
 * deliverable-hover-menu package is not in this profile's module-watch roots,
 * so edits to it are only picked up by an app restart.
 *
 * The route is a plain `webServer` exact route; Connection's own trust checks
 * and signed-browser-cookie admission guard it exactly like `/api`.
 */
import { spawn } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'

/** The one route this plugin owns. Keep it in sync with `client.js`. */
const ROUTE_PATH = '/dsh-deliverable-menu/link'
/** A link request is one small JSON object. */
const MAX_BODY_BYTES = 8192
/** Longest `path`/`cwd` a link request may carry. */
const MAX_PATH_CHARS = 8192
/** Actions a conversation file link may ask the Host for. */
const LINK_ACTIONS = ['open', 'reveal', 'copyFile', 'copyPath']
/** How long one PowerShell clipboard write may take before it is abandoned. */
const CLIPBOARD_TIMEOUT_MS = 8000
/** How long filesystem reads and desktop actions may take before the request fails. */
const RESOLVE_TIMEOUT_MS = 15000
/** PowerShell CLI flags; `-STA` is required by the clipboard APIs. */
const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-STA', '-Command']

/** Services the Host half needs before it can register the route. */
export const inject = ['webServer', 'connection', 'fs', 'sessionController']

/**
 * Register the link route for as long as this plugin is mounted.
 * @param ctx - Host plugin Context.
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  const connection = ctx.connection
  ctx.effect(
    () => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (request, response) => handleRequest(ctx, connection, request, response),
    }),
    'deliverable-link-route: link route',
  )
}

/**
 * Answer one conversation-file-link action.
 * @param ctx - Host plugin Context.
 * @param connection - Host Connection service (route trust + browser auth).
 * @param request - Incoming HTTP request.
 * @param response - Incoming HTTP response.
 */
async function handleRequest(ctx, connection, request, response) {
  try {
    const rejection = connection.requestRejection({ headers: request.headers })
    if (rejection !== undefined) {
      sendJson(response, rejection, {
        ok: false,
        code: 'unauthorized',
        message: 'request is not an authenticated browser request',
      })
      return
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, code: 'method-not-allowed', message: 'only POST is accepted' })
      return
    }
    const link = await readLinkRequest(request)
    if (link === undefined) {
      sendJson(response, 400, {
        ok: false,
        code: 'bad-request',
        message: 'body must carry a path and one of the open, reveal, copyFile, or copyPath actions',
      })
      return
    }
    let resolved
    try {
      resolved = await resolveLinkPath(ctx, link)
    } catch (error) {
      respondResolutionFailure(ctx, response, error)
      return
    }
    const { hostPath, info } = resolved
    if (link.action === 'open' || link.action === 'reveal') {
      if (!desktopAvailable(ctx)) {
        sendJson(response, 409, {
          ok: false,
          code: 'desktop-unavailable',
          message: 'the Host desktop is unavailable',
        })
        return
      }
      const signal = resolveSignal()
      try {
        if (link.action === 'reveal') await ctx.sessionController.openWorkspacePath({ path: hostPath, action: 'reveal' }, signal)
        else await ctx.sessionController.openWorkspacePath({ path: hostPath }, signal)
      } catch (error) {
        warnFail(ctx, link.action === 'reveal' ? 'reveal failed' : 'open failed')
        sendJson(response, 500, {
          ok: false,
          code: link.action === 'reveal' ? 'reveal-failed' : 'open-failed',
          message: link.action === 'reveal' ? 'the containing folder could not be opened' : 'the linked file could not be opened',
        })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }
    if (link.action === 'copyFile' && (info === undefined || info === null || info.type !== 'file')) {
      sendJson(response, 422, {
        ok: false,
        code: 'file-unavailable',
        message: 'only a regular file can be copied as a file',
      })
      return
    }
    if (process.platform !== 'win32') {
      sendJson(response, 501, {
        ok: false,
        code: 'unsupported-platform',
        message: 'system clipboard writes are only supported on Windows',
      })
      return
    }
    try {
      await writeClipboard(link.action, hostPath)
    } catch (error) {
      warnFail(ctx, 'clipboard write failed')
      sendJson(response, 500, {
        ok: false,
        code: 'clipboard-failed',
        message: 'the system clipboard write failed',
      })
      return
    }
    sendJson(response, 200, { ok: true })
  } catch (error) {
    warnFail(ctx, 'request handling failed')
    sendJson(response, 500, { ok: false, code: 'internal', message: 'the file link request could not be completed' })
  }
}

/**
 * Whether the Host desktop is available for open/reveal actions.
 * @param ctx - Host plugin Context.
 * @returns true only when the desktop reports availability.
 */
function desktopAvailable(ctx) {
  try {
    const desktop = ctx.sessionController.workspaceDesktop()
    return desktop !== null && typeof desktop === 'object' && desktop.available === true
  } catch (error) {
    return false
  }
}

/** One refusal this route answers itself instead of classifying from a service error. */
class RouteRefusal extends Error {
  /**
   * @param status - HTTP status to answer with.
   * @param code - stable failure code the client localizes.
   * @param message - short non-sensitive diagnostic.
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'RouteRefusal'
    this.status = status
    this.code = code
  }
}

/**
 * Read and validate the conversation-file-link body.
 *
 * `path` is the raw path from the link's Markdown/title; `cwd` is the session
 * workspace root the browser supplies. A relative `path` requires a `cwd`; an
 * absolute `path` may stand alone. The route never trusts `path` as a Host
 * path: {@link resolveLinkPath} resolves it through the composed filesystem.
 * @param request - Incoming HTTP request.
 * @returns the action, path, and optional cwd, or undefined when the body is unusable.
 */
async function readLinkRequest(request) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const { path, cwd, action } = body
  if (typeof action !== 'string' || !LINK_ACTIONS.includes(action)) return undefined
  const linkPath = pathValue(path)
  if (linkPath === undefined) return undefined
  const workspaceRoot = cwd === undefined ? undefined : cwdValue(cwd)
  if (workspaceRoot === undefined && !isAbsolute(linkPath)) return undefined
  return { action, path: linkPath, cwd: workspaceRoot }
}

/**
 * Validate one link `path` string.
 * @param value - raw body value.
 * @returns the trimmed non-empty path, or undefined when invalid.
 */
function pathValue(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_PATH_CHARS) return undefined
  if (hasControlCharacters(trimmed)) return undefined
  return trimmed
}

/**
 * Validate one link `cwd` string; it must be an absolute path.
 * @param value - raw body value.
 * @returns the trimmed absolute cwd, or undefined when invalid.
 */
function cwdValue(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_PATH_CHARS) return undefined
  if (hasControlCharacters(trimmed)) return undefined
  if (!isAbsolute(trimmed)) return undefined
  return trimmed
}

/** Whether a string carries a control character or NUL. */
function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value)
}

/**
 * Resolve a file link to its canonical Host path and prove it exists.
 * @param ctx - Host plugin Context.
 * @param link - validated action, path, and optional cwd.
 * @returns the canonical Host path and its filesystem stat.
 * @throws {RouteRefusal} when the path cannot be mapped, resolved, or stat'ed.
 */
async function resolveLinkPath(ctx, link) {
  const { fs } = ctx
  if (fs === undefined || fs === null || typeof fs.processPathFromHostPath !== 'function' || typeof fs.resolve !== 'function' || typeof fs.processPath !== 'function' || typeof fs.stat !== 'function') {
    throw new RouteRefusal(500, 'internal', 'the Host filesystem service is unavailable')
  }
  const signal = resolveSignal()
  const candidate = isAbsolute(link.path) ? link.path : resolve(link.cwd, link.path)
  const mapped = fs.processPathFromHostPath(candidate)
  if (mapped === undefined) {
    throw new RouteRefusal(422, 'file-unavailable', 'the path has no verified Host location')
  }
  const target = await fs.resolve(mapped, signal === undefined ? {} : { signal })
  const hostPath = fs.processPath(target)
  if (typeof hostPath !== 'string' || hostPath === '') {
    throw new RouteRefusal(422, 'file-unavailable', 'the path has no verified Host location')
  }
  const info = await fs.stat(target, signal)
  if (info === undefined || info === null) {
    throw new RouteRefusal(404, 'file-unavailable', 'the linked path does not exist')
  }
  return { hostPath, info }
}

/**
 * Answer a resolution failure: a self-described refusal, a not-found service
 * error, or an opaque internal failure.
 * @param ctx - Host plugin Context.
 * @param response - Incoming HTTP response.
 * @param error - caught value from resolution.
 */
function respondResolutionFailure(ctx, response, error) {
  if (error instanceof RouteRefusal) {
    sendJson(response, error.status, { ok: false, code: error.code, message: error.message })
    return
  }
  if (failureStatus(error) === 404) {
    sendJson(response, 404, { ok: false, code: 'file-unavailable', message: 'the linked path is unavailable' })
    return
  }
  warnFail(ctx, 'file-link resolution failed')
  sendJson(response, 500, { ok: false, code: 'internal', message: 'the file link could not be resolved' })
}

/**
 * Translate filesystem failures into the status the browser reports from.
 * @param error - caught value.
 * @returns 404 for a missing path; 500 otherwise.
 */
function failureStatus(error) {
  const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404
  return 500
}

/** One bounded cancellation lifetime shared by resolution and desktop actions. */
function resolveSignal() {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(RESOLVE_TIMEOUT_MS) : undefined
}

/**
 * Write one clipboard payload with a short-lived Windows PowerShell child.
 * The payload travels in an environment variable; the script is constant.
 * @param action - `copyFile` (file drop list) or `copyPath` (text).
 * @param payload - absolute Host path.
 * @returns a promise settled after PowerShell exited successfully.
 * @throws {RouteRefusal} on spawn failure, non-zero exit, or timeout.
 */
function writeClipboard(action, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = { ...process.env }
    delete env.DSH_COPY_PATH
    delete env.DSH_COPY_TEXT
    if (action === 'copyFile') env.DSH_COPY_PATH = payload
    else env.DSH_COPY_TEXT = payload
    const fail = () => rejectPromise(new RouteRefusal(500, 'clipboard-failed', 'the system clipboard write failed'))
    let child
    try {
      child = spawn(powershellPath(), [...POWERSHELL_FLAGS, clipboardScript(action)], {
        env,
        windowsHide: true,
        stdio: 'ignore',
        timeout: CLIPBOARD_TIMEOUT_MS,
        killSignal: 'SIGTERM',
      })
    } catch (error) {
      fail()
      return
    }
    let settled = false
    const settle = (failed) => {
      if (settled) return
      settled = true
      if (failed) fail()
      else resolvePromise()
    }
    child.once('error', () => settle(true))
    child.once('close', (code) => settle(code !== 0))
  })
}

/**
 * The constant PowerShell script for one action; the payload is never part of it.
 * `-LiteralPath` puts the file itself on the clipboard (Explorer-style copy);
 * `-Value` puts the full path on it as text.
 * @param action - `copyFile` or `copyPath`.
 * @returns the script text.
 */
function clipboardScript(action) {
  return action === 'copyFile'
    ? "$ErrorActionPreference = 'Stop'; Set-Clipboard -LiteralPath $env:DSH_COPY_PATH"
    : "$ErrorActionPreference = 'Stop'; Set-Clipboard -Value $env:DSH_COPY_TEXT"
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
 * Read and parse a bounded JSON request body.
 * @param request - Incoming HTTP request.
 * @returns the parsed JSON value.
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
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        settle(undefined, JSON.parse(text))
      } catch (error) {
        settle(error)
      }
    })
    request.on('error', (error) => settle(error))
  })
}

/**
 * Write one JSON response without throwing on a dead socket.
 * @param response - Incoming HTTP response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(response, status, body) {
  if (response.writableEnded) return
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
 * Report one Host-side failure without echoing a user path or secret.
 * @param ctx - Host plugin Context.
 * @param message - fixed diagnostic.
 */
function warnFail(ctx, message) {
  try {
    ctx.logger?.warn?.(`deliverable-link-route: ${message}`)
  } catch (error) {
    // Logging must never break the response path.
  }
}
