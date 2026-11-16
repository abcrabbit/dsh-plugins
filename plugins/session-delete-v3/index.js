/**
 * Host half of the session-delete bundle (v3).
 *
 * Deleting is a two-step operation that the user can see and undo:
 *
 *  1. The client marks a Session for deletion. This Host half persists the id in
 *     a durable pending queue; NO file is removed while the app runs (DSH keeps
 *     every session it has resumed live for the whole process lifetime, so the
 *     log may still be held open).
 *  2. On the next app start, before any client can re-open the session, this
 *     plugin drains the queue and removes the stored Session directory, its
 *     projection cache entry, and its archive flag.
 *
 * Routes (all behind Connection's browser-cookie trust gate):
 *   GET  /dsh-session-delete-v3/pending  -> { ok, ids }
 *   POST /dsh-session-delete-v3/delete   -> { ok, pending: true }
 *   POST /dsh-session-delete-v3/cancel   -> { ok, pending: false }
 */
import { mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

/** Route base; keep in sync with `client.js`. */
const ROUTE_BASE = '/dsh-session-delete-v3'
const PENDING_ROUTE = `${ROUTE_BASE}/pending`
const DELETE_ROUTE = `${ROUTE_BASE}/delete`
const CANCEL_ROUTE = `${ROUTE_BASE}/cancel`
/** A request body is one small JSON object. */
const MAX_BODY_BYTES = 8192
/** A session may only be cleaned when the process is this fresh (i.e. at boot). */
const BOOT_WINDOW_MS = 5 * 60 * 1000
/** One delayed retry after the first boot cleanup attempt. */
const CLEANUP_RETRY_MS = 2000

/**
 * Apply the plugin: register the routes as soon as the web carrier and the
 * Connection trust service exist, and drain the pending queue once at boot.
 * @param ctx - Host plugin Context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    let disposed = false
    let retryTimer
    let disposers = []
    const tryRegister = () => {
      if (disposed) return
      const webServer = ctx.get('webServer')
      const connection = ctx.get('connection')
      if (webServer === undefined || connection === undefined) {
        retryTimer = setTimeout(tryRegister, 200)
        return
      }
      disposers = [
        webServer.register({ kind: 'exact', path: PENDING_ROUTE, handler: (request, response) => handleRoute(ctx, connection, 'pending', request, response) }),
        webServer.register({ kind: 'exact', path: DELETE_ROUTE, handler: (request, response) => handleRoute(ctx, connection, 'delete', request, response) }),
        webServer.register({ kind: 'exact', path: CANCEL_ROUTE, handler: (request, response) => handleRoute(ctx, connection, 'cancel', request, response) }),
      ]
    }
    tryRegister()
    return () => {
      disposed = true
      clearTimeout(retryTimer)
      for (const dispose of disposers) {
        try { dispose() } catch (error) { /* registration already gone */ }
      }
      disposers = []
    }
  }, 'session-delete-v3: routes')

  ctx.effect(() => {
    let disposed = false
    let retryTimer
    let retried = false
    const isBoot = process.uptime() * 1000 < BOOT_WINDOW_MS
    if (!isBoot) return () => {}
    const attempt = () => {
      if (disposed) return
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined || typeof persistence.stat !== 'function') {
        retryTimer = setTimeout(attempt, 250)
        return
      }
      void runPendingCleanup(ctx).finally(() => {
        if (disposed || retried) return
        retried = true
        retryTimer = setTimeout(() => { void runPendingCleanup(ctx) }, CLEANUP_RETRY_MS)
      })
    }
    attempt()
    return () => {
      disposed = true
      clearTimeout(retryTimer)
    }
  }, 'session-delete-v3: boot cleanup')
}

/**
 * Answer one queue route.
 * @param ctx - Host plugin Context.
 * @param connection - Host Connection service (route trust + browser auth).
 * @param route - one of pending / delete / cancel.
 * @param request - Incoming HTTP request.
 * @param response - Incoming HTTP response.
 */
async function handleRoute(ctx, connection, route, request, response) {
  try {
    const rejection = connection.requestRejection({ headers: request.headers })
    if (rejection !== undefined) {
      sendJson(response, rejection, { ok: false, code: 'unauthorized', message: 'request is not an authenticated browser request' })
      return
    }
    if (route === 'pending') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        sendJson(response, 405, { ok: false, code: 'method-not-allowed', message: 'only GET is accepted' })
        return
      }
      sendJson(response, 200, { ok: true, ids: await listPending(ctx) })
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
      sendJson(response, 400, { ok: false, code: 'bad-request', message: 'request body is not a JSON object' })
      return
    }
    const sessionId = body !== null && typeof body === 'object' && typeof body.sessionId === 'string' ? body.sessionId : ''
    if (sessionId === '' || sessionId.length > 256 || /[\u0000-\u001f\u007f]/.test(sessionId)) {
      sendJson(response, 400, { ok: false, code: 'bad-request', message: 'sessionId is missing or malformed' })
      return
    }
    if (route === 'delete') {
      const outcome = await enqueueForDeletion(ctx, sessionId)
      sendJson(response, outcome.status, outcome.body)
      return
    }
    await cancelDeletion(ctx, sessionId)
    sendJson(response, 200, { ok: true, pending: false })
  } catch (error) {
    sendJson(response, 500, { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Add one existing Session to the durable deletion queue.
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity to delete on the next start.
 * @returns the HTTP status and JSON body.
 */
export async function enqueueForDeletion(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.stat !== 'function') {
    return { status: 503, body: { ok: false, code: 'persistence-unavailable', message: 'session persistence is unavailable' } }
  }
  let snapshot
  try {
    snapshot = await persistence.stat(sessionId)
  } catch (error) {
    return { status: 500, body: { ok: false, code: 'stat-failed', message: error instanceof Error ? error.message : String(error) } }
  }
  if (snapshot === undefined) {
    await removePending(ctx, sessionId)
    return { status: 200, body: { ok: true, pending: false, notFound: true } }
  }
  const queued = await addPending(ctx, sessionId)
  if (!queued) {
    return { status: 500, body: { ok: false, code: 'queue-failed', message: 'could not persist the pending delete request' } }
  }
  return { status: 200, body: { ok: true, pending: true } }
}

/**
 * Remove one Session from the durable deletion queue (cancel a pending delete).
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity to keep.
 * @returns always resolves; cancellation is best-effort by design.
 */
export async function cancelDeletion(ctx, sessionId) {
  await removePending(ctx, sessionId)
}

/**
 * Read the current durable deletion queue.
 * @param ctx - Host plugin Context.
 * @returns queued Session identities.
 */
export async function listPending(ctx) {
  return readPending(ctx)
}

/**
 * Drain the pending queue: remove every queued Session that is cold now and
 * keep the rest for a later start.
 * @param ctx - Host plugin Context.
 */
export async function runPendingCleanup(ctx) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.stat !== 'function') return
  const ids = await readPending(ctx)
  if (ids.length === 0) return
  const remaining = []
  for (const sessionId of ids) {
    if (isLive(ctx, sessionId)) {
      remaining.push(sessionId)
      continue
    }
    const outcome = await deleteStoredSession(ctx, sessionId)
    if (outcome.body === undefined || outcome.body.ok !== true) remaining.push(sessionId)
  }
  await writePending(ctx, remaining)
}

/**
 * Remove one queued Session's durable storage and its derived leftovers.
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity to remove.
 * @returns the HTTP status and JSON body.
 */
async function deleteStoredSession(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.stat !== 'function') {
    return { status: 503, body: { ok: false, code: 'persistence-unavailable', message: 'session persistence is unavailable' } }
  }
  let snapshot
  try {
    snapshot = await persistence.stat(sessionId)
  } catch (error) {
    return { status: 500, body: { ok: false, code: 'stat-failed', message: error instanceof Error ? error.message : String(error) } }
  }
  if (snapshot === undefined) {
    await removePending(ctx, sessionId)
    return { status: 200, body: { ok: true, deleted: false, notFound: true } }
  }
  const header = snapshot.header
  if (header !== undefined && header !== null && typeof header.id === 'string' && header.id !== sessionId) {
    return { status: 409, body: { ok: false, code: 'identity-mismatch', message: 'stored session identity does not match the request' } }
  }
  const root = sessionRoot(persistence)
  if (root === undefined) {
    return { status: 503, body: { ok: false, code: 'root-unavailable', message: 'session storage root is unavailable' } }
  }
  const encodedId = encodeSegment(sessionId)
  let projectEntries
  try {
    projectEntries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    return { status: 500, body: { ok: false, code: 'root-unreadable', message: error instanceof Error ? error.message : String(error) } }
  }
  const candidates = []
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, encodedId)
    try {
      if ((await stat(candidate)).isDirectory()) candidates.push(candidate)
    } catch (error) {
      // Absent under this project directory is the normal case.
    }
  }
  if (candidates.length === 0) {
    await removePending(ctx, sessionId)
    return { status: 200, body: { ok: true, deleted: false, notFound: true } }
  }
  if (candidates.length > 1) {
    return { status: 409, body: { ok: false, code: 'ambiguous-session', message: 'more than one stored directory matches this session' } }
  }
  const target = candidates[0]
  const containment = await checkContainment(root, target, encodedId)
  if (containment !== undefined) {
    return { status: 409, body: { ok: false, code: 'unsafe-path', message: containment } }
  }
  try {
    const entries = await readdir(target)
    const looksLikeSession = entries.some((name) => /^session(\.[A-Za-z0-9._-]+)?\.jsonl(\.zstd)?$/.test(name))
    if (!looksLikeSession) {
      return { status: 409, body: { ok: false, code: 'not-a-session-directory', message: 'the matched directory does not hold a session log' } }
    }
    await rm(target, { recursive: true, force: true })
  } catch (error) {
    return { status: 500, body: { ok: false, code: 'delete-failed', message: error instanceof Error ? error.message : String(error) } }
  }
  await cleanupDerivedState(ctx, root, sessionId)
  await removePending(ctx, sessionId)
  return { status: 200, body: { ok: true, deleted: true } }
}

/**
 * Best-effort removal of derived state that would otherwise outlive the log.
 * @param ctx - Host plugin Context.
 * @param sessionsRoot - configured Session storage root.
 * @param sessionId - removed Session identity.
 */
async function cleanupDerivedState(ctx, sessionsRoot, sessionId) {
  const dshHome = dirname(sessionsRoot)
  const cacheFile = join(dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  try {
    await unlink(cacheFile)
  } catch (error) {
    // Derived cache; absence is normal.
  }
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined && typeof registry.unarchiveSession === 'function') {
    try {
      await registry.unarchiveSession(sessionId)
    } catch (error) {
      // The archive flag is best-effort cleanup, never a reason to fail the delete.
    }
  }
}

/**
 * Whether the given Session currently has a live Agent or attached Session.
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity.
 * @returns true while the app still holds the Session.
 */
function isLive(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && typeof sessions.get === 'function' && sessions.get(sessionId) !== undefined) return true
  const agents = ctx.get('agents')
  if (agents !== undefined && typeof agents.get === 'function' && agents.get(sessionId) !== undefined) return true
  return false
}

/** Absolute path of the durable pending-delete queue. */
function queuePath(ctx) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.root === 'string' && isAbsolute(persistence.root)) {
    return join(dirname(resolve(persistence.root)), 'session-delete', 'pending.json')
  }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'session-delete', 'pending.json')
}

/**
 * Read the pending-delete queue.
 * @param ctx - Host plugin Context.
 * @returns the queued Session identities.
 */
async function readPending(ctx) {
  try {
    const parsed = JSON.parse(await readFile(queuePath(ctx), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value) => typeof value === 'string' && value !== '')
  } catch (error) {
    return []
  }
}

/**
 * Persist the pending-delete queue atomically.
 * @param ctx - Host plugin Context.
 * @param ids - complete queue contents.
 */
async function writePending(ctx, ids) {
  const path = queuePath(ctx)
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `pending.${process.pid}.${Date.now()}.tmp`)
  await writeFile(temporary, JSON.stringify(ids, null, 2), 'utf8')
  await rename(temporary, path)
}

/**
 * Add one Session to the pending-delete queue.
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity to queue.
 * @returns whether the queue was written.
 */
async function addPending(ctx, sessionId) {
  try {
    const ids = await readPending(ctx)
    if (!ids.includes(sessionId)) ids.push(sessionId)
    await writePending(ctx, ids)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Remove one Session from the pending-delete queue.
 * @param ctx - Host plugin Context.
 * @param sessionId - Session identity to drop.
 */
async function removePending(ctx, sessionId) {
  try {
    const ids = await readPending(ctx)
    const next = ids.filter((value) => value !== sessionId)
    if (next.length !== ids.length) await writePending(ctx, next)
  } catch (error) {
    // Queue hygiene only; never fail the user action for it.
  }
}

/**
 * Resolve the configured Session persistence root.
 * @param persistence - Session persistence service.
 * @returns the absolute root directory, or undefined when it cannot be found.
 */
function sessionRoot(persistence) {
  if (typeof persistence.root === 'string' && isAbsolute(persistence.root)) return resolve(persistence.root)
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME : ''
  if (home !== '') return resolve(join(home, 'sessions'))
  return undefined
}

/**
 * Prove the matched session directory really sits below the configured root and
 * still names the requested session after symlinks resolve.
 * @param root - configured Session root.
 * @param target - matched session directory.
 * @param encodedId - expected directory name of the requested session.
 * @returns a refusal reason, or undefined when containment holds.
 */
async function checkContainment(root, target, encodedId) {
  let realRoot
  let realTarget
  try {
    realRoot = await realpath(root)
    realTarget = await realpath(target)
  } catch (error) {
    return 'the matched path cannot be resolved'
  }
  if (realRoot === realTarget || !realTarget.startsWith(realRoot + sep)) {
    return 'the matched path escapes the session root'
  }
  if (basename(realTarget) !== encodedId) {
    return 'the matched path does not name the requested session'
  }
  return undefined
}

/**
 * Copy of the persistence backend's injective path-segment escaping, used only
 * to find the session directory; never to build a path from user input alone.
 * @param raw - arbitrary non-empty string.
 * @returns one safe path segment.
 */
function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
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
