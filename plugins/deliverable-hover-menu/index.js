/**
 * Host half of the deliverable-hover-menu bundle.
 *
 * The Web client renders a hover menu on `present`ed file cards with four
 * actions. Opening and revealing go through the shipped deliverables routes;
 * the two clipboard actions ("copy this file" as a file drop list, and "copy
 * full path" as text) need the operating system clipboard, which only the Host
 * can write. This plugin serves exactly one authenticated HTTP route that
 *
 *  1. resolves the addressed delivered file through the Session log and the
 *     workspace file service, using the same coordinates and validation the
 *     shipped `@deepseek-ai/dsh-client-ui-deliverables` Host half uses for
 *     `present.open`;
 *  2. verifies the resolved path round-trips through the Host filesystem
 *     mapping exactly like `openVerified` in that package; and
 *  3. writes the clipboard from a short-lived Windows PowerShell child whose
 *     payload arrives through an environment variable, so no user data is ever
 *     interpolated into a command line or script.
 *
 * The route is a plain `webServer` exact route; Connection's own trust checks
 * and signed-browser-cookie admission guard it exactly like `/api`.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

/** The one route this plugin owns. Keep it in sync with `client.js`. */
const ROUTE_PATH = '/dsh-deliverable-menu/copy'
/** A copy request is one small JSON object. */
const MAX_BODY_BYTES = 8192
/** How long one PowerShell clipboard write may take before it is abandoned. */
const CLIPBOARD_TIMEOUT_MS = 8000
/** How long Session/workspace reads may take before the request fails. */
const RESOLVE_TIMEOUT_MS = 15000
/** PowerShell CLI flags; `-STA` is required by the clipboard APIs. */
const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-STA', '-Command']
/** Stable digits-only coordinate grammar shared with the shipped deliverables routes. */
const NUMERIC = /^\d+$/
/** The shipped browser-relative action route whose coordinates this plugin consumes. */
const PRESENT_OPEN_SEGMENT = 'present.open'

/** Services the Host half needs before it can register the route. */
export const inject = ['webServer', 'connection', 'sessionQuery', 'workspaceFiles', 'sandboxPolicy', 'fs']

/**
 * Register the copy route for as long as this plugin is mounted.
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
    'deliverable-hover-menu: copy route',
  )
}

/**
 * Answer one copy request.
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
    if (process.platform !== 'win32') {
      sendJson(response, 501, {
        ok: false,
        code: 'unsupported-platform',
        message: 'system clipboard writes are only supported on Windows',
      })
      return
    }
    const copy = await readCopyRequest(request)
    if (copy === undefined) {
      sendJson(response, 400, {
        ok: false,
        code: 'bad-request',
        message: 'body must be a JSON object with a present.open actionUrl and a copyFile or copyPath action',
      })
      return
    }
    let hostPath
    try {
      hostPath = await resolveDeliveredPath(ctx, copy.coordinates)
    } catch (error) {
      respondResolutionFailure(ctx, response, error)
      return
    }
    try {
      await writeClipboard(copy.action, hostPath)
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
    sendJson(response, 500, { ok: false, code: 'internal', message: 'the copy request could not be completed' })
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
 * Read and validate the JSON request body.
 * @param request - Incoming HTTP request.
 * @returns the action plus the delivered-file coordinates, or undefined when the body is unusable.
 */
async function readCopyRequest(request) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const { actionUrl, action } = body
  if (typeof action !== 'string') return undefined
  if (action !== 'copyFile' && action !== 'copyPath') return undefined
  const coordinates = presentedCoordinates(actionUrl)
  if (coordinates === undefined) return undefined
  return { action, coordinates }
}

/**
 * Extract the delivered-file coordinates from a card's `present.open` URL.
 *
 * The shipped client passes `api/present.open?sessionId=…&seq=…&index=…` (a
 * document-relative route); absolute forms are accepted too. The origin and
 * path carry no authority here — the Session log lookup below is the only
 * source of truth — but the route tail is checked so a wrong URL fails early.
 * @param actionUrl - card action URL supplied by the authenticated browser.
 * @returns the coordinates, or undefined when the URL is not a present.open route.
 */
function presentedCoordinates(actionUrl) {
  if (typeof actionUrl !== 'string' || actionUrl.length === 0 || actionUrl.length > 4096) return undefined
  if (/[\u0000-\u001f\u007f]/.test(actionUrl)) return undefined
  let url
  try {
    url = new URL(actionUrl, 'http://localhost')
  } catch (error) {
    return undefined
  }
  if (url.pathname !== `/${PRESENT_OPEN_SEGMENT}` && !url.pathname.endsWith(`/${PRESENT_OPEN_SEGMENT}`)) return undefined
  const sessionId = url.searchParams.get('sessionId')
  const seq = coordinate(url.searchParams.get('seq'))
  const index = coordinate(url.searchParams.get('index'))
  if (sessionId === null || sessionId === '' || sessionId.length > 256) return undefined
  if (/[\u0000-\u001f\u007f]/.test(sessionId)) return undefined
  if (seq === undefined || index === undefined) return undefined
  return { sessionId, seq, index }
}

/** A digits-only safe integer from a query parameter, or undefined. */
function coordinate(value) {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
}

/**
 * Validate a file declaration read from a Session log.
 * @param value - decoded durable data.
 * @returns whether the declaration contains a path and optional description.
 */
function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, description } = value
  return typeof path === 'string' && path.trim().length > 0 && (description === undefined || typeof description === 'string')
}

/**
 * Validate a delivery event before reading its file declarations.
 * @param value - decoded durable event data.
 * @returns whether the event identifies a turn and a file list.
 */
function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { turn, callId, files } = value
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1 && typeof callId === 'string' && callId.length > 0 && Array.isArray(files)
}

/**
 * Resolve the declared delivered file to its verified absolute Host path.
 * @param ctx - Host plugin Context.
 * @param coordinates - Session identity, delivery event seq, and file index.
 * @returns the absolute Host path, verified through the filesystem mapping.
 * @throws {RouteRefusal} when the event, declaration, or path is unusable.
 */
async function resolveDeliveredPath(ctx, coordinates) {
  const { sessionId, seq, index } = coordinates
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(RESOLVE_TIMEOUT_MS) : undefined
  const read = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal)
  if (read === null || typeof read !== 'object') throw new RouteRefusal(404, 'file-unavailable', 'the delivered file is unavailable')
  const { target, session } = read
  if (target === null || typeof target !== 'object' || target.type !== 'deliverables/presented' || !isPresentedData(target.data)) {
    throw new RouteRefusal(404, 'file-unavailable', 'the delivered file is unavailable')
  }
  const file = target.data.files[index]
  if (!isPresentedFile(file)) throw new RouteRefusal(404, 'file-unavailable', 'the delivered file is unavailable')
  const workspaceRoot = session !== null && typeof session === 'object' && typeof session.cwd === 'string' && session.cwd !== ''
    ? session.cwd
    : ctx.sandboxPolicy.workspaceRoot
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    throw new RouteRefusal(503, 'unavailable', 'the workspace root is unavailable')
  }
  const stat = await ctx.workspaceFiles.stat({ sessionId, workspaceRoot }, file.path, signal)
  const hostPath = stat !== null && typeof stat === 'object' ? stat.absolutePath : undefined
  if (typeof hostPath !== 'string' || hostPath === '') {
    throw new RouteRefusal(404, 'file-unavailable', 'the delivered file is unavailable')
  }
  if (!await verifyHostPath(ctx, hostPath, signal)) {
    throw new RouteRefusal(422, 'file-unavailable', 'the delivered path has no verified Host location')
  }
  return hostPath
}

/**
 * Prove the absolute path round-trips through the Host filesystem mapping,
 * mirroring `openVerified` in the shipped deliverables plugin.
 * @param ctx - Host plugin Context.
 * @param hostPath - absolute path produced by the workspace file service.
 * @param signal - optional cancellation for the mapping resolution.
 * @returns whether the mapping resolves back to the same path.
 */
async function verifyHostPath(ctx, hostPath, signal) {
  const { fs } = ctx
  if (fs === undefined || fs === null || typeof fs.processPathFromHostPath !== 'function' || typeof fs.resolve !== 'function' || typeof fs.processPath !== 'function') {
    throw new RouteRefusal(503, 'unavailable', 'the Host filesystem service is unavailable')
  }
  const mapped = fs.processPathFromHostPath(hostPath)
  if (mapped === undefined) return false
  return fs.processPath(await fs.resolve(mapped, signal === undefined ? {} : { signal })) === hostPath
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
    sendJson(response, 404, { ok: false, code: 'file-unavailable', message: 'the delivered file is unavailable' })
    return
  }
  warnFail(ctx, 'delivered-file resolution failed')
  sendJson(response, 500, { ok: false, code: 'internal', message: 'the delivered file could not be resolved' })
}

/**
 * Translate Session lookup and workspace fileservice failures into the status
 * the browser retries from, mirroring the shipped deliverables plugin.
 * @param error - caught value.
 * @returns 404 for a missing Session, event, or file; 500 otherwise.
 */
function failureStatus(error) {
  const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined
  if (
    code === 'session/not-found'
    || code === 'workspace-file/not-found'
    || code === 'workspace-file/not-regular-file'
    || code === 'SESSION_QUERY_SESSION_NOT_FOUND'
    || code === 'SESSION_QUERY_EVENT_NOT_FOUND'
    || code === 'ENOENT'
    || code === 'ENOTDIR'
  ) return 404
  return 500
}

/**
 * Write one clipboard payload with a short-lived Windows PowerShell child.
 * The payload travels in an environment variable; the script is constant.
 * @param action - `copyFile` (file drop list) or `copyPath` (text).
 * @param payload - absolute Host file path.
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
    ctx.logger?.warn?.(`deliverable-hover-menu: ${message}`)
  } catch (error) {
    // Logging must never break the response path.
  }
}
