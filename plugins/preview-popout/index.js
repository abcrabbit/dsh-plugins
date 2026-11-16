/**
 * Host half of the preview pop-out bundle.
 *
 * A Web client cannot create a native window by itself: the Desktop shell's
 * window-open policy denies in-page windows. The Host owns the two pieces the
 * browser cannot do alone:
 *
 *  1. mint an authenticated application URL through
 *     `connection.authenticatedUrl()` (the launch-token URL that establishes a
 *     browser session), with a pop-out payload in the URL fragment; and
 *  2. spawn the dedicated native preview window (`native/electron`, a minimal
 *     Electron application that hard-links this installation's Chromium
 *     runtime, so no second copy is installed and no system browser is used).
 *
 * Cold spawning pays the whole application boot before the preview appears, so
 * the Host also keeps one *warm* window: an already booted, fully transparent
 * native window parked on a warm URL. The client asks for it when the pointer
 * enters a file tab, and a later drag only hands it the payload; the warm page
 * claims the payload, restores the preview and only then reveals itself. A warm
 * window that is never used is closed after a short idle timeout.
 *
 * Routes: `/open` mints a URL for the pure-Web deployment, `/native` spawns or
 * assigns a native window, `/warm`, `/warm-ready` and `/claim` implement the
 * warm pool, and `/ready` records a window's restore outcome.
 *
 * The routes are loopback-only in practice because the Web server binds
 * 127.0.0.1; they refuse non-POST, oversize, and malformed requests. The launch
 * token is never logged or echoed into another surface: it only travels inside
 * the returned URL, exactly like the URL the application prints on startup.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The route that mints one pop-out URL. Keep in sync with `client.js`. */
const OPEN_ROUTE = '/dsh-preview-popout/open'
/** The route that spawns or assigns the dedicated native preview window. */
const NATIVE_ROUTE = '/dsh-preview-popout/native'
/** The route that asks the Host to keep a warm native window ready. */
const WARM_ROUTE = '/dsh-preview-popout/warm'
/** The route a warm window calls once its application finished booting. */
const WARM_READY_ROUTE = '/dsh-preview-popout/warm-ready'
/** The route a warm window polls for the payload it should display. */
const CLAIM_ROUTE = '/dsh-preview-popout/claim'
/** The route a warm window reports its ahead-of-time preview preparation to. */
const WARM_PREPARED_ROUTE = '/dsh-preview-popout/warm-prepared'
/** The route the pop-out window reports its restore outcome to. */
const READY_ROUTE = '/dsh-preview-popout/ready'
/** The minimal Electron application bundled beside this file. */
const NATIVE_EXE = fileURLToPath(new URL('./native/electron/DeepSeek Harness.exe', import.meta.url))
/** How many native preview windows one Host keeps alive before refusing more. */
const MAX_NATIVE_WINDOWS = 8
/** How long an unused warm window may stay parked before it is closed. */
const WARM_IDLE_MS = 25000
/** A request is one small JSON object. */
const MAX_BODY_BYTES = 8192
/** The largest accepted resource address. */
const MAX_ADDRESS_LENGTH = 4096
/** Append-only request ledger used to verify the gesture without the page's console. */
const LEDGER_PATH = 'C:\\Users\\bcrab\\Documents\\deepseek-harness\\default-workspace\\verify-preview\\popout-requests.jsonl'
/** Only file resources are detached; page tabs such as the guide have nothing to show. */
const RESOURCE_PREFIX = 'dsh-resource://file/'
/** The warm application URL fragment prefix; `client.js` mirrors it. */
const WARM_HASH_PREFIX = '#dsh-preview-popout-warm='

/** Live native windows, so plugin disposal closes them. */
const nativeWindows = new Set()
/** The one parked warm window, or null. */
let warmWindow = null

/** Services required before the routes can be registered. */
export const inject = ['webServer', 'connection']

/**
 * Register the pop-out routes for as long as this plugin is mounted.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_ROUTE,
    handler: (request, response) => handleOpen(ctx, request, response),
  }), 'preview-popout: open route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: NATIVE_ROUTE,
    handler: (request, response) => handleNative(ctx, request, response),
  }), 'preview-popout: native route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WARM_ROUTE,
    handler: (request, response) => handleWarm(ctx, request, response),
  }), 'preview-popout: warm route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WARM_READY_ROUTE,
    handler: (request, response) => handleWarmReady(request, response),
  }), 'preview-popout: warm-ready route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLAIM_ROUTE,
    handler: (request, response) => handleClaim(request, response),
  }), 'preview-popout: claim route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WARM_PREPARED_ROUTE,
    handler: (request, response) => handleWarmPrepared(request, response),
  }), 'preview-popout: warm-prepared route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: READY_ROUTE,
    handler: (request, response) => handleReady(request, response),
  }), 'preview-popout: ready route')
  ctx.effect(() => () => {
    disposeWarm()
    for (const child of nativeWindows) {
      try {
        child.kill()
      } catch {
        // A window that already exited needs no cleanup.
      }
    }
    nativeWindows.clear()
  }, 'preview-popout: native windows')
}

/**
 * Record one pop-out window's restore outcome for diagnostics and verification.
 * @param request - incoming HTTP request carrying `{ ok, sessionId, address }`.
 * @param response - incoming HTTP response.
 */
async function handleReady(request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined) {
      sendJson(response, 400, { ok: false })
      return
    }
    record({
      event: body.ok === true ? 'popout-ready' : 'popout-failed',
      sessionId: isSafeSessionId(body.sessionId) ? body.sessionId : undefined,
      address: isFileAddress(body.address) ? body.address : undefined,
    })
    sendJson(response, 200, { ok: true })
  } catch {
    sendJson(response, 500, { ok: false })
  }
}

/**
 * Answer one pop-out request with an authenticated application URL and its payload.
 * @param ctx - Host plugin context.
 * @param request - incoming HTTP request.
 * @param response - incoming HTTP response.
 */
async function handleOpen(ctx, request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, message: 'only POST is accepted' })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined) {
      sendJson(response, 400, { ok: false, message: 'body must be a JSON object' })
      return
    }
    const { sessionId, address, title } = body
    if (!isSafeSessionId(sessionId) || !isFileAddress(address)) {
      sendJson(response, 400, { ok: false, message: 'sessionId and a dsh-resource://file/ address are required' })
      return
    }
    const url = mintPopoutUrl(ctx, sessionId, address, title)
    record({ sessionId, address, title: typeof title === 'string' ? title.slice(0, 120) : '', hasUrl: true })
    sendJson(response, 200, { ok: true, url })
  } catch (error) {
    record({ error: String(error && error.message ? error.message : error) })
    sendJson(response, 500, { ok: false, message: 'the pop-out window could not be prepared' })
  }
}

/**
 * Answer one native-window request: hand the payload to the parked warm window
 * when one exists, otherwise spawn a cold window.
 * @param ctx - Host plugin context.
 * @param request - incoming HTTP request carrying `{ sessionId, address, title }`.
 * @param response - incoming HTTP response.
 */
async function handleNative(ctx, request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, message: 'only POST is accepted' })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined) {
      sendJson(response, 400, { ok: false, message: 'body must be a JSON object' })
      return
    }
    const { sessionId, address, title } = body
    if (!isSafeSessionId(sessionId) || !isFileAddress(address)) {
      sendJson(response, 400, { ok: false, message: 'sessionId and a dsh-resource://file/ address are required' })
      return
    }
    if (!existsSync(NATIVE_EXE)) {
      sendJson(response, 503, { ok: false, code: 'native-shell-missing', message: 'the native preview shell is not installed' })
      return
    }
    const payload = {
      v: 1,
      sessionId,
      address,
      title: typeof title === 'string' ? title.slice(0, 512) : '',
    }
    if (warmWindow !== null && !warmWindow.claimed) {
      warmWindow.payload = payload
      scheduleWarmIdle(warmWindow)
      record({
        event: 'popout-warm-assigned',
        id: warmWindow.id,
        warmReady: warmWindow.ready,
        sessionId,
        address,
        title: typeof title === 'string' ? title.slice(0, 120) : '',
      })
      sendJson(response, 200, { ok: true, mode: 'warm', ready: warmWindow.ready })
      return
    }
    pruneNativeWindows()
    if (nativeWindows.size >= MAX_NATIVE_WINDOWS) {
      sendJson(response, 429, { ok: false, code: 'too-many-windows', message: 'too many preview windows are open' })
      return
    }
    const child = spawnColdWindow(ctx, payload)
    sendJson(response, 200, { ok: true, mode: 'cold', pid: child.pid ?? null })
  } catch (error) {
    record({ error: String(error && error.message ? error.message : error) })
    sendJson(response, 500, { ok: false, message: 'the native preview window could not be opened' })
  }
}

/**
 * Park one warm window, spawning it when none exists yet.
 * @param ctx - Host plugin context.
 * @param request - incoming HTTP request.
 * @param response - incoming HTTP response.
 */
async function handleWarm(ctx, request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false })
      return
    }
    if (!existsSync(NATIVE_EXE)) {
      sendJson(response, 503, { ok: false, code: 'native-shell-missing' })
      return
    }
    const body = await readJsonBody(request)
    let hint
    if (body !== undefined && isSafeSessionId(body.sessionId) && isFileAddress(body.address)) {
      hint = {
        sessionId: body.sessionId,
        address: body.address,
        title: typeof body.title === 'string' ? body.title.slice(0, 512) : '',
      }
    }
    const warm = spawnWarmWindow(ctx, hint)
    if (warm === null) {
      sendJson(response, 503, { ok: false })
      return
    }
    sendJson(response, 200, { ok: true, ready: warm.ready })
  } catch (error) {
    record({ error: String(error && error.message ? error.message : error) })
    sendJson(response, 500, { ok: false })
  }
}

/**
 * Mark the warm window whose application finished booting.
 * @param request - incoming HTTP request carrying `{ id }`.
 * @param response - incoming HTTP response.
 */
async function handleWarmReady(request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined || !isWarmId(body.id)) {
      sendJson(response, 400, { ok: false })
      return
    }
    if (warmWindow !== null && warmWindow.id === body.id) {
      warmWindow.ready = true
      scheduleWarmIdle(warmWindow)
      record({ event: 'warm-ready', id: body.id })
    }
    sendJson(response, 200, { ok: true })
  } catch {
    sendJson(response, 500, { ok: false })
  }
}

/**
 * Record that a parked window finished restoring a hinted preview behind the scenes.
 * @param request - incoming HTTP request carrying `{ id }`.
 * @param response - incoming HTTP response.
 */
async function handleWarmPrepared(request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined || !isWarmId(body.id)) {
      sendJson(response, 400, { ok: false })
      return
    }
    record({ event: 'warm-prepared', id: body.id })
    sendJson(response, 200, { ok: true })
  } catch {
    sendJson(response, 500, { ok: false })
  }
}

/**
 * Let a warm window claim the payload assigned to it.
 * @param request - incoming HTTP request carrying `{ id }`.
 * @param response - incoming HTTP response.
 */
async function handleClaim(request, response) {
  try {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false })
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined || !isWarmId(body.id)) {
      sendJson(response, 400, { ok: false })
      return
    }
    if (warmWindow === null || warmWindow.id !== body.id || warmWindow.payload === null) {
      sendJson(response, 200, { ok: true, payload: null })
      return
    }
    const payload = warmWindow.payload
    warmWindow.claimed = true
    clearTimeout(warmWindow.timer)
    if (warmWindow.child.exitCode === null && warmWindow.child.signalCode === null) nativeWindows.add(warmWindow.child)
    record({ event: 'warm-claimed', id: body.id, sessionId: payload.sessionId, address: payload.address })
    warmWindow = null
    sendJson(response, 200, { ok: true, payload })
  } catch {
    sendJson(response, 500, { ok: false })
  }
}

/**
 * Spawn one warm window parked on a warm URL.
 * @param ctx - Host plugin context.
 * @param hint - optional hover payload the parked page may preview ahead of time.
 * @returns the warm record, or null when the shell is missing.
 */
function spawnWarmWindow(ctx, hint) {
  if (warmWindow !== null && !warmWindow.claimed) return warmWindow
  if (!existsSync(NATIVE_EXE)) return null
  pruneNativeWindows()
  const id = randomUUID()
  const suffix = hint === undefined ? '' : `.${encodePayload(hint)}`
  const url = `${mintAuthenticatedBase(ctx)}${WARM_HASH_PREFIX}${id}${suffix}`
  const child = spawn(NATIVE_EXE, [], {
    env: nativeWindowEnv(url, hint === undefined ? 'Preview' : hint.title, true),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  const warm = { id, child, ready: false, payload: null, claimed: false, timer: null, hint }
  warmWindow = warm
  const settle = (failed) => {
    const current = warmWindow === warm
    if (current) {
      clearTimeout(warm.timer)
      warmWindow = null
    }
    if (failed && current && warm.payload !== null) {
      // The parked window died after a payload was assigned: fall back to a cold one.
      record({ event: 'warm-fallback', id: warm.id })
      try {
        spawnColdWindow(ctx, warm.payload)
      } catch (error) {
        record({ error: String(error && error.message ? error.message : error) })
      }
    }
  }
  child.once('exit', () => settle(true))
  child.once('error', () => settle(true))
  child.unref()
  scheduleWarmIdle(warm)
  record({
    event: 'warm-spawn',
    id,
    pid: child.pid,
    hint: hint === undefined ? undefined : { address: hint.address, title: hint.title.slice(0, 120) },
  })
  return warm
}

/** Reset a warm window's idle timer. */
function scheduleWarmIdle(warm) {
  clearTimeout(warm.timer)
  warm.timer = setTimeout(() => {
    if (warmWindow === warm && !warm.claimed) {
      record({ event: 'warm-idle-timeout', id: warm.id })
      disposeWarm()
    }
  }, WARM_IDLE_MS)
  warm.timer.unref?.()
}

/** Close and forget the parked warm window. */
function disposeWarm() {
  const warm = warmWindow
  warmWindow = null
  if (warm === null) return
  clearTimeout(warm.timer)
  try {
    warm.child.kill()
  } catch {
    // An already exited child needs no cleanup.
  }
}

/**
 * Spawn one cold native window that loads the full pop-out URL.
 * @param ctx - Host plugin context.
 * @param payload - `{ sessionId, address, title }`.
 * @returns the spawned child process.
 */
function spawnColdWindow(ctx, payload) {
  const url = mintPopoutUrl(ctx, payload.sessionId, payload.address, payload.title)
  const child = spawn(NATIVE_EXE, [], {
    env: nativeWindowEnv(url, payload.title),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.once('exit', () => nativeWindows.delete(child))
  child.once('error', () => nativeWindows.delete(child))
  nativeWindows.add(child)
  child.unref()
  record({
    event: 'popout-native',
    sessionId: payload.sessionId,
    address: payload.address,
    title: typeof payload.title === 'string' ? payload.title.slice(0, 120) : '',
    pid: child.pid,
  })
  return child
}

/** Forget native windows that already exited. */
function pruneNativeWindows() {
  for (const child of nativeWindows) {
    if (child.exitCode !== null || child.signalCode !== null) nativeWindows.delete(child)
  }
}

/**
 * Environment for one native window process.
 *
 * The Desktop Host runs inside an Electron "node mode" child, so the Electron
 * runtime switches and the parent's NODE_OPTIONS must be removed or the new
 * process would run as a plain Node script instead of opening a window.
 * @param url - authenticated application URL carrying the pop-out payload.
 * @param title - window title (the file name).
 * @param warm - whether this is a parked warm window (hidden from the taskbar until claimed).
 * @returns a fresh environment object for the child.
 */
function nativeWindowEnv(url, title, warm = false) {
  const env = { ...process.env }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_NO_ATTACH_CONSOLE', 'NODE_OPTIONS']) delete env[key]
  env.DSH_PREVIEW_URL = url
  env.DSH_PREVIEW_TITLE = typeof title === 'string' && title.length > 0 ? title.slice(0, 200) : 'Preview'
  if (warm) env.DSH_PREVIEW_WARM = '1'
  else delete env.DSH_PREVIEW_WARM
  return env
}

/** The authenticated application base URL (with its launch token). */
function mintAuthenticatedBase(ctx) {
  const webServer = ctx.webServer
  if (typeof webServer.port !== 'number' || typeof webServer.protocol !== 'string') {
    throw new Error('the Web server is unavailable')
  }
  return ctx.connection.authenticatedUrl(`${webServer.protocol}//127.0.0.1:${webServer.port}/`)
}

/**
 * Mint one authenticated application URL with the pop-out payload in its fragment.
 * @param ctx - Host plugin context.
 * @param sessionId - Session that owns the previewed file.
 * @param address - `dsh-resource://file/…` address.
 * @param title - display title carried to the new window.
 * @returns the authenticated URL.
 */
function mintPopoutUrl(ctx, sessionId, address, title) {
  const payload = encodePayload({ sessionId, address, title: typeof title === 'string' ? title.slice(0, 512) : '' })
  return `${mintAuthenticatedBase(ctx)}#dsh-preview-popout=${payload}`
}

/** Whether a value looks like the warm window id minted above. */
function isWarmId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{16,64}$/iu.test(value)
}

/** Whether a value is a plausible Session id. */
function isSafeSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Whether a value is a detachable file resource address. */
function isFileAddress(value) {
  return typeof value === 'string'
    && value.length > RESOURCE_PREFIX.length
    && value.length <= MAX_ADDRESS_LENGTH
    && value.startsWith(RESOURCE_PREFIX)
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Encode the pop-out payload for the URL fragment. */
function encodePayload(payload) {
  return Buffer.from(JSON.stringify({ v: 1, ...payload }), 'utf8').toString('base64url')
}

/** Read and parse a bounded JSON request body. */
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
        const parsed = JSON.parse(text)
        settle(undefined, typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined)
      } catch (error) {
        settle(error)
      }
    })
    request.on('error', (error) => settle(error))
  })
}

/** Write one JSON response without throwing on a dead socket. */
function sendJson(response, status, body) {
  if (response.writableEnded) return
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify(body))
  } catch {
    response.destroy?.()
  }
}

/** Append one line to the verification ledger; failures never break the feature. */
function record(entry) {
  try {
    mkdirSync(dirname(LEDGER_PATH), { recursive: true })
    appendFileSync(LEDGER_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // Diagnostics must never fail the feature.
  }
}
