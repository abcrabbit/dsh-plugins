/**
 * Host half of the DeepSeek 余额/Token usage bundle.
 *
 * The whole usage history is read from the DeepSeek Open Platform with the
 * account grant the user already signed in with (no separate token to paste):
 * the `deepseekAccount` service is the only consumer allowed to obtain it, and
 * this plugin keeps the token Host-side for the lifetime of one request.
 *
 * Data source:
 *  - `GET {origin}/api/v0/usage/export?start=&end=&tz=0` (web-platform private
 *    endpoint, authenticated with the DSH account grant header) returns a zip
 *    with `amount-*.csv` (per UTC day / model / API key / type / price / amount)
 *    and `cost-*.csv` (per day wallet cost). This is the only source that
 *    attributes usage to individual API keys.
 *  - The export window may be at most 31 days, so history is fetched one
 *    calendar month per request and cached in memory. Historical months never
 *    change; only the current month is re-read on refresh.
 *  - A month is aggregated into compact rows `{date, key, model, tokens,
 *    requests, cost}`; the overview route filters and re-aggregates those rows
 *    in memory, so any custom range (including ranges longer than 30 days) is
 *    served without touching the platform again.
 *
 * Balances: the status route also reports the prepaid balance of the
 * UncensoredLLM relay configured in this profile. The relay is OpenAI-compatible
 * and exposes `GET /v1/dashboard/billing/subscription`; `hard_limit_usd` is its
 * remaining prepaid balance. That key lives in the credentials service
 * (`UNCENSOREDLLM_API_KEY`) and never reaches the Client. Both provider balances
 * are refreshed about every two hours (and on a manual refresh).
 *
 * UncensoredLLM token usage: the relay exposes no key-level usage history, so
 * this plugin folds the relay's provider usage out of the local Session logs
 * (the same `assistant/message` usage records the chat UI reads) and serves it
 * as `GET /deepseek-usage/v1/local-usage`. Session files are cached per file by
 * size+mtime, so a rescan only decodes logs that changed.
 *
 * Routes (all behind Connection's browser trust gate):
 *  - GET  /deepseek-usage/v1/status
 *  - GET  /deepseek-usage/v1/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&key=&model=
 *  - GET  /deepseek-usage/v1/local-usage?from=YYYY-MM-DD&to=YYYY-MM-DD&model=
 *  - POST /deepseek-usage/v1/refresh
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync, zstdDecompressSync } from 'node:zlib'

/** Services required before the routes can be registered. */
export const inject = ['webServer', 'connection', 'deepseekAccount', 'credentials']

const ROUTE_STATUS = '/deepseek-usage/v1/status'
const ROUTE_OVERVIEW = '/deepseek-usage/v1/overview'
const ROUTE_LOCAL_USAGE = '/deepseek-usage/v1/local-usage'
const ROUTE_REFRESH = '/deepseek-usage/v1/refresh'

/** Cached data younger than this is served without a platform round trip. */
const DATA_TTL_MS = 5 * 60_000
/** Account profile and wallet balance are cheap to re-read. */
const ACCOUNT_TTL_MS = 60_000
/** A user-triggered refresh cannot hammer the platform more often than this. */
const MIN_FORCE_REFRESH_MS = 10_000
/** DeepSeek Open Platform has no earlier usage than its first public launch. */
const FLOOR_YEAR = 2023
const FLOOR_MONTH = 1
/** Parallel export requests; the platform tolerates a handful of concurrent reads. */
const SYNC_CONCURRENCY = 4
/** One export request budget; a month export is tiny. */
const EXPORT_TIMEOUT_MS = 45_000
/** Largest CSV text this plugin will parse out of one export zip. */
const MAX_CSV_BYTES = 32 * 1024 * 1024
/** Largest export zip this plugin will accept. */
const MAX_ZIP_BYTES = 48 * 1024 * 1024
/** Header for platform requests; identifies the integration without leaking data. */
const USER_AGENT = 'DeepSeek-Harness/usage-panel'
/** Fallback currency when the export does not name one. */
const CURRENCY_FALLBACK = 'CNY'
/** Version string sent to the account service with client metadata. */
const ACCOUNT_CLIENT_VERSION = '0.2.2-rc.1'
/** UncensoredLLM relay configured in this profile (OpenAI-compatible). */
const ULM_CREDENTIAL_REF = 'UNCENSOREDLLM_API_KEY'
const ULM_SUBSCRIPTION_URL = 'https://api.uncensoredllm.ai/v1/dashboard/billing/subscription'
const ULM_TIMEOUT_MS = 20_000
/** Both provider balances are refreshed roughly every two hours. */
const BALANCE_TTL_MS = 2 * 60 * 60 * 1000
const BALANCE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
/** UncensoredLLM prepaid balance (USD) that counts as "low" for the user. */
const ULM_LOW_BALANCE_USD = 2
/** Provider id the relay route registers in the LLM service. */
const ULM_PROVIDER = 'uncensoredllm'
/** Session logs rescanned at most this often while the panel stays open. */
const SESSION_SCAN_TTL_MS = 10 * 60 * 1000
/** Amount CSV types that count as token usage. */
const TOKEN_TYPES = new Set(['output_tokens', 'input_tokens', 'input_cache_hit_tokens', 'input_cache_miss_tokens'])
/** Stable error codes mirrored by the client's localized copy. */
const ERROR_MESSAGES = {
  signed_out: '尚未登录 DeepSeek 开放平台账号',
  auth_expired: 'DeepSeek 账号授权已过期，请重新登录',
  platform: 'DeepSeek 开放平台接口返回异常',
  network: '无法连接 DeepSeek 开放平台',
  timeout: 'DeepSeek 开放平台请求超时',
  invalid_query: '查询参数不合法',
  not_ready: '用量数据尚未同步完成',
}

/** Failure carrying a stable code for the Client's localized copy. */
class UsageError extends Error {
  /**
   * @param code - stable code from {@link ERROR_MESSAGES}.
   * @param detail - Host-side detail, never shown verbatim in the UI.
   */
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`)
    this.name = 'UsageError'
    this.code = code
  }
}

/**
 * Register the three read routes owned by this bundle.
 * @param ctx - Host plugin Context.
 */
export function apply(ctx) {
  const store = createUsageStore(ctx)
  const routes = [
    {
      kind: 'exact',
      path: ROUTE_STATUS,
      handler: (request, response) => handleJson(ctx, request, response, () => store.status(request)),
    },
    {
      kind: 'exact',
      path: ROUTE_OVERVIEW,
      handler: (request, response) => handleJson(ctx, request, response, () => store.overview(request)),
    },
    {
      kind: 'exact',
      path: ROUTE_LOCAL_USAGE,
      handler: (request, response) => handleJson(ctx, request, response, () => store.localOverview(request)),
    },
    {
      kind: 'exact',
      path: ROUTE_REFRESH,
      handler: (request, response) => handleJson(ctx, request, response, () => store.refresh(request)),
    },
  ]
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'deepseek-usage: routes')
  // Keep both provider balances warm even while the panel is closed, so the
  // sidebar entry shows a recent figure the moment the user looks at it.
  ctx.effect(() => {
    const timer = setInterval(() => {
      store.refreshBalances().catch((error) => {
        console.error('[deepseek-usage] scheduled balance refresh failed:', error && (error.message || error))
      })
    }, BALANCE_REFRESH_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'deepseek-usage: balance refresh timer')
}

/** One JSON request/response wrapper shared by the three routes. */
async function handleJson(ctx, request, response, run) {
  try {
    const rejection = ctx.connection.requestRejection({ headers: request.headers })
    if (rejection !== undefined) {
      sendJson(response, rejection, { ok: false, code: 'unauthorized', message: 'request is not an authenticated browser request' })
      return
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      sendJson(response, 405, { ok: false, code: 'method_not_allowed', message: 'only GET and POST are accepted' })
      return
    }
    request.resume()
    sendJson(response, 200, await run())
  } catch (error) {
    const code = error instanceof UsageError ? error.code : 'internal'
    if (!(error instanceof UsageError)) console.error('[deepseek-usage] request failed:', error && (error.stack || error.message || error))
    sendJson(response, 200, { ok: false, code, message: ERROR_MESSAGES[code] ?? '用量数据读取失败' })
  }
}

function sendJson(response, status, body) {
  let text
  try { text = JSON.stringify(body) } catch { text = '{"ok":false,"code":"internal"}' }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(text)
}

/**
 * Owns the month cache, compact dataset and the routes' read operations.
 * @param ctx - Host plugin Context.
 */
function createUsageStore(ctx) {
  /** @type {Map<string, {key: string, complete: boolean, rows: Array<object>, walletByDate: Map<string, object>, currency: string, maskedKeys: Map<string, string>, syncedAt: number}>} */
  const months = new Map()
  /** @type {null | {rows: Array<object>, keys: string[], models: string[], maskedKeys: Map<string,string>, walletByDate: Map<string, object>, currency: string, firstDate: string|null, lastDate: string|null}} */
  let dataset = null
  /** @type {null | {at: number, error: {code: string}|null}} */
  let lastSync = null
  /** @type {null | Promise<void>} */
  let syncing = null
  /** @type {null | {at: number, account: object|null, balance: object|null}} */
  let accountCache = null
  /** Last account-grant failure, surfaced to the Client instead of an empty panel. */
  let lastError = null
  /** @type {null | {at: number, value: {currency: string, available: number, low: boolean, hasPaymentMethod: boolean}|null, error: {code: string}|null}} */
  let ulmCache = null
  /** @type {null | Promise<object>} */
  let ulmPending = null
  /** Session-log based UncensoredLLM usage (independent of the DeepSeek bill). */
  const localUsage = createLocalUsageStore()

  return {
    status,
    overview,
    localOverview,
    refresh,
    refreshBalances,
  }

  /** GET /status: account identity, both provider balances, dataset bounds and sync state. */
  async function status(request) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    // The sidebar entry only needs the balances; `light=1` skips the month sync
    // so opening the app never waits for the whole usage history.
    const light = url.searchParams.get('light') === '1'
    const ulm = await readUlmBalance(false)
    const session = await readSession()
    if (session === null) {
      return {
        ok: true, signedIn: false, account: null, balance: null,
        balances: { deepseek: null, ulm: ulmSummary(ulm) },
        keys: [], models: [], firstDate: null, lastDate: null, lastSync: null, syncing: false,
        error: { code: 'signed_out' },
      }
    }
    let syncError = null
    if (!light) {
      try {
        await ensureData(request, false)
      } catch (error) {
        syncError = error
        lastError = error
      }
    }
    const account = await readAccount(request)
    // A partial sync (some months failed but the dataset is usable) still has to
    // be visible; otherwise an incomplete month would look like missing usage.
    const failureCode = syncError !== null
      ? (syncError instanceof UsageError ? syncError.code : 'internal')
      : syncFailureCode()
    return {
      ok: true,
      signedIn: true,
      account: account.account,
      balance: account.balance,
      balances: {
        deepseek: account.balance === null
          ? null
          : Object.assign({}, account.balance, { updatedAt: accountCache === null ? null : accountCache.at }),
        ulm: ulmSummary(ulm),
      },
      keys: dataset === null ? [] : dataset.keys,
      models: dataset === null ? [] : dataset.models,
      firstDate: dataset === null ? null : dataset.firstDate,
      lastDate: dataset === null ? null : dataset.lastDate,
      lastSync: lastSync === null ? null : lastSync.at,
      syncing: syncing !== null,
      ...failureCode === null ? {} : { error: { code: failureCode } },
    }
  }

  /** GET /overview: aggregate the cached dataset for one filter, no platform call. */
  async function overview(request) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const query = parseQuery(url)
    const session = await readSession()
    if (session === null) throw new UsageError('signed_out')
    let syncError = null
    try {
      await ensureData(request, query.refresh || false)
    } catch (error) {
      syncError = error
    }
    if (dataset === null) {
      if (syncError !== null) throw syncError
      throw new UsageError('not_ready')
    }
    const payload = aggregate(query)
    const failureCode = syncError !== null
      ? (syncError instanceof UsageError ? syncError.code : 'internal')
      : syncFailureCode()
    return {
      ok: true,
      ...payload,
      lastSync: lastSync === null ? null : lastSync.at,
      syncing: syncing !== null,
      ...failureCode === null ? {} : { stale: true, error: { code: failureCode } },
    }
  }

  /** Code of the newest sync failure (thrown or tolerated partial), or null. */
  function syncFailureCode() {
    if (lastError !== null) return lastError instanceof UsageError ? lastError.code : 'internal'
    if (lastSync !== null && lastSync.error !== null) return lastSync.error.code
    return null
  }

  /** GET /local-usage: UncensoredLLM token usage folded from local Session logs. */
  async function localOverview(request) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const query = parseQuery(url)
    const data = await localUsage.read(query.refresh === true)
    return Object.assign({ ok: true }, summarizeLocalUsage(data, query))
  }

  /** POST /refresh: re-read the platform dataset and both provider balances. */
  async function refresh(request) {
    if (request.method !== 'POST') throw new UsageError('invalid_query', 'refresh requires POST')
    const session = await readSession()
    if (session === null) throw new UsageError('signed_out')
    try {
      await ensureData(request, true)
    } catch (error) {
      throw error instanceof UsageError ? error : new UsageError('internal', error instanceof Error ? error.message : String(error))
    }
    // Force the next status read to re-query both wallet balances as well.
    accountCache = null
    localUsage.invalidate()
    const ulm = await readUlmBalance(true)
    return {
      ok: true,
      lastSync: lastSync === null ? null : lastSync.at,
      keys: dataset === null ? [] : dataset.keys,
      models: dataset === null ? [] : dataset.models,
      firstDate: dataset === null ? null : dataset.firstDate,
      lastDate: dataset === null ? null : dataset.lastDate,
      balances: { deepseek: null, ulm: ulmSummary(ulm) },
    }
  }

  /** Read the Host-only platform grant, or null while signed out. */
  async function readSession() {
    try {
      return await ctx.deepseekAccount.getPlatformSession()
    } catch (error) {
      console.error('[deepseek-usage] account session read failed:', error && (error.message || error))
      return null
    }
  }

  /** Read and cache the account profile and wallet balance. */
  async function readAccount(request) {
    const now = Date.now()
    if (accountCache !== null && now - accountCache.at < ACCOUNT_TTL_MS) return accountCache
    const meta = {
      version: ACCOUNT_CLIENT_VERSION,
      locale: request !== undefined && typeof request.headers['accept-language'] === 'string' ? request.headers['accept-language'] : 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }
    const [profile, balance] = await Promise.allSettled([
      ctx.deepseekAccount.getProfile(meta),
      ctx.deepseekAccount.getBalance(meta),
    ])
    const account = profile.status === 'fulfilled' && profile.value !== null && profile.value !== undefined && profile.value.status === 'ready'
      ? { name: profile.value.value.name, avatarUrl: profile.value.value.avatarUrl ?? null }
      : null
    let wallet = null
    if (balance.status === 'fulfilled' && balance.value !== null && balance.value !== undefined && balance.value.status === 'ready') {
      const normal = Array.isArray(balance.value.value) ? balance.value.value : []
      const bonus = Array.isArray(balance.value.bonusWallets) ? balance.value.bonusWallets : []
      const currency = normal[0]?.currency ?? bonus[0]?.currency ?? CURRENCY_FALLBACK
      wallet = {
        currency,
        total: normal.filter((entry) => entry.currency === currency).reduce((sum, entry) => sum + toNumber(entry.balance), 0).toFixed(2),
        bonus: bonus.filter((entry) => entry.currency === currency).reduce((sum, entry) => sum + toNumber(entry.balance), 0).toFixed(2),
      }
    }
    accountCache = { at: now, account, balance: wallet }
    return accountCache
  }

  /**
   * Read the UncensoredLLM prepaid balance through the relay's OpenAI-compatible
   * billing endpoint. The API key stays Host-side; a failed read keeps the last
   * good figure and reports a stable error code. Cache TTL is two hours, matching
   * the scheduled refresh cadence.
   */
  async function readUlmBalance(force) {
    const now = Date.now()
    if (force !== true && ulmCache !== null && now - ulmCache.at < BALANCE_TTL_MS) return ulmCache
    if (ulmPending !== null) return ulmPending
    ulmPending = (async () => {
      let value = null
      let error = null
      try {
        const resolved = await ctx.credentials.resolve(ULM_CREDENTIAL_REF)
        const key = resolved === undefined || resolved === null
          ? null
          : typeof resolved === 'string' ? resolved : resolved.value
        if (typeof key !== 'string' || key === '') throw new UsageError('ulm_missing_key')
        const response = await fetch(ULM_SUBSCRIPTION_URL, {
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
          signal: AbortSignal.timeout(ULM_TIMEOUT_MS),
        })
        const text = await response.text()
        if (response.status === 401 || response.status === 403) throw new UsageError('ulm_auth')
        if (!response.ok) throw new UsageError('ulm_http', `status ${response.status}`)
        let parsed = null
        try { parsed = JSON.parse(text) } catch { parsed = null }
        if (parsed === null || typeof parsed.hard_limit_usd !== 'number' || !Number.isFinite(parsed.hard_limit_usd)) {
          throw new UsageError('ulm_payload')
        }
        const available = roundMoney(parsed.hard_limit_usd)
        value = {
          currency: 'USD',
          available,
          low: available < ULM_LOW_BALANCE_USD,
          hasPaymentMethod: parsed.has_payment_method === true,
        }
      } catch (caught) {
        if (caught instanceof UsageError) {
          error = caught.code === 'ulm_missing_key' || caught.code === 'ulm_auth' || caught.code === 'ulm_payload' || caught.code === 'ulm_http'
            ? caught
            : new UsageError('ulm_network', caught.message)
        } else if (caught && (caught.name === 'TimeoutError' || caught.name === 'AbortError')) {
          error = new UsageError('ulm_timeout')
        } else {
          error = new UsageError('ulm_network', caught && caught.message)
        }
        console.error('[deepseek-usage] uncensoredllm balance read failed:', error.message)
      }
      // Keep showing the last known balance when a refresh fails.
      const previousValue = ulmCache === null ? null : ulmCache.value
      ulmCache = {
        at: Date.now(),
        value: value === null ? previousValue : value,
        error: error === null ? null : { code: error.code },
      }
      return ulmCache
    })().finally(() => { ulmPending = null })
    return ulmPending
  }

  /** Refresh both provider balances; the two-hour scheduler calls this. */
  async function refreshBalances() {
    accountCache = null
    const ulm = await readUlmBalance(true)
    return { deepseek: null, ulm: ulmSummary(ulm) }
  }

  /** Fetch every month that is missing or still incomplete, then rebuild the dataset. */
  async function ensureData(request, force) {
    if (syncing !== null) return syncing
    const now = Date.now()
    if (!force && lastSync !== null && now - lastSync.at < DATA_TTL_MS) return
    if (force && lastSync !== null && now - lastSync.at < MIN_FORCE_REFRESH_MS) return
    syncing = (async () => {
      const session = await readSession()
      if (session === null) {
        lastError = new UsageError('signed_out')
        throw lastError
      }
      const targets = monthTargets()
      const failures = []
      let succeeded = 0
      let authFailure = null
      await mapLimit(targets, SYNC_CONCURRENCY, async (target) => {
        if (authFailure !== null) return
        try {
          const data = await fetchMonth(session, target.year, target.month)
          months.set(target.key, data)
          succeeded += 1
        } catch (error) {
          if (error instanceof UsageError && error.code === 'signed_out') authFailure = error
          else failures.push(error)
        }
      })
      if (authFailure !== null) {
        lastError = authFailure
        throw authFailure
      }
      if (targets.length > 0 && succeeded === 0) {
        lastError = failures[0] instanceof UsageError ? failures[0] : new UsageError('platform', failures[0] instanceof Error ? failures[0].message : String(failures[0]))
        throw lastError
      }
      dataset = rebuildDataset(months)
      lastSync = {
        at: Date.now(),
        error: failures.length === 0 ? null : { code: failures[0] instanceof UsageError ? failures[0].code : 'platform' },
      }
      lastError = failures.length === 0 ? null : lastSync.error
    })().finally(() => { syncing = null })
    return syncing
  }

  /** Months to (re)read: everything from the floor to the current UTC month. */
  function monthTargets() {
    const now = new Date()
    const currentKey = monthKey(now.getUTCFullYear(), now.getUTCMonth() + 1)
    const targets = []
    for (const item of monthRange(FLOOR_YEAR, FLOOR_MONTH, now.getUTCFullYear(), now.getUTCMonth() + 1)) {
      const cached = months.get(item.key)
      const isCurrent = item.key === currentKey
      if (cached === undefined || isCurrent || cached.complete === false) targets.push(item)
    }
    // Newest first: the current month is usually what the user looks at.
    targets.sort((left, right) => (left.key < right.key ? 1 : left.key > right.key ? -1 : 0))
    return targets
  }

  /** Filter and aggregate the compact dataset for one query. */
  function aggregate(query) {
    return aggregateDataset(dataset, query)
  }
}

/** Accumulate one usage row into a map bucket. */
function addInto(map, name, row) {
  let target = map.get(name)
  if (target === undefined) {
    target = { tokens: 0, cost: 0, requests: 0 }
    map.set(name, target)
  }
  target.tokens += row.tokens
  target.cost += row.cost
  target.requests += row.requests
}

/**
 * Client-facing summary of one cached UncensoredLLM balance read.
 * @param cache - Host cache record, or null before the first attempt.
 * @returns the balance block embedded in the status payload.
 */
function ulmSummary(cache) {
  if (cache === null) {
    return {
      ok: false, currency: 'USD', available: null, low: false, hasPaymentMethod: null,
      updatedAt: null, autoRefreshMs: BALANCE_REFRESH_INTERVAL_MS, error: { code: 'ulm_pending' },
    }
  }
  const value = cache.value
  return {
    ok: value !== null,
    currency: 'USD',
    available: value === null ? null : value.available,
    low: value === null ? false : value.low,
    hasPaymentMethod: value === null ? null : value.hasPaymentMethod,
    updatedAt: cache.at,
    autoRefreshMs: BALANCE_REFRESH_INTERVAL_MS,
    error: cache.error === null ? null : { code: cache.error.code },
  }
}

/** Magic bytes that start one zstd frame. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Decode every zstd frame in an append-only `.jsonl.zstd` Session log. */
function decodeSessionLog(buffer) {
  if (buffer.length < 4) return ''
  const frames = []
  let index = buffer.indexOf(ZSTD_MAGIC)
  while (index !== -1) {
    frames.push(index)
    index = buffer.indexOf(ZSTD_MAGIC, index + 4)
  }
  if (frames.length === 0) return buffer.toString('utf8')
  let text = ''
  for (let i = 0; i < frames.length; i += 1) {
    const start = frames[i]
    const end = i + 1 < frames.length ? frames[i + 1] : buffer.length
    try {
      text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
    } catch (error) {
      void error
    }
  }
  return text
}

/**
 * Fold one decoded Session log into per-day/per-model UncensoredLLM rows.
 * Every model reply stores the provider, model and token usage in its
 * `assistant/message` event; only that relay's rows are kept.
 */
function extractLocalUsageRows(text) {
  const rows = new Map()
  for (const line of text.split('\n')) {
    if (line.indexOf('assistant/message') === -1) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    const message = data.message
    const source = message !== null && typeof message === 'object' ? message.source : null
    if (source === null || typeof source !== 'object' || source.provider !== ULM_PROVIDER) continue
    const usage = data.usage
    if (usage === null || typeof usage !== 'object' || typeof event.time !== 'number') continue
    const model = typeof source.model === 'string' && source.model !== '' ? source.model : 'unknown'
    const date = new Date(event.time).toISOString().slice(0, 10)
    const key = date + '\u0000' + model
    let row = rows.get(key)
    if (row === undefined) {
      row = { date, model, tokens: 0, input: 0, output: 0, cache: 0, requests: 0 }
      rows.set(key, row)
    }
    row.tokens += Math.max(0, Number(usage.totalTokens) || 0)
    row.input += Math.max(0, Number(usage.inputTokens) || 0)
    row.output += Math.max(0, Number(usage.outputTokens) || 0)
    row.cache += Math.max(0, Number(usage.cacheReadTokens) || 0)
    row.requests += 1
  }
  return [...rows.values()]
}

/**
 * Session-log backed UncensoredLLM usage. One scan walks every Session
 * directory once, decodes only logs whose size or mtime changed, and caches the
 * compact per-file rows; the merged aggregate is cheap to recompute.
 */
function createLocalUsageStore() {
  /** @type {Map<string, {mtime: number, size: number, rows: Array<object>}>} */
  const files = new Map()
  /** @type {null | {at: number, rows: Array<object>, files: number, sessions: number}} */
  let cache = null
  /** @type {null | Promise<object>} */
  let pending = null

  return { read, invalidate }

  function invalidate() {
    cache = null
  }

  async function read(force) {
    if (force !== true && cache !== null && Date.now() - cache.at < SESSION_SCAN_TTL_MS) return cache
    if (pending !== null) return pending
    pending = (async () => {
      const snapshot = scan()
      cache = { at: Date.now(), rows: snapshot.rows, files: snapshot.files, sessions: snapshot.sessions }
      return cache
    })().finally(() => { pending = null })
    return pending
  }

  function scan() {
    const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
    let workspaces = []
    try {
      workspaces = readdirSync(root)
    } catch (error) {
      void error
    }
    const seen = new Set()
    let fileCount = 0
    let sessionCount = 0
    for (const workspace of workspaces) {
      const base = join(root, workspace)
      let sessions = []
      try {
        sessions = readdirSync(base)
      } catch (error) {
        void error
        continue
      }
      for (const session of sessions) {
        const child = join(base, session)
        let names
        try {
          if (!statSync(child).isDirectory()) continue
          names = readdirSync(child)
        } catch (error) {
          void error
          continue
        }
        for (const name of names) {
          if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.zstd')) continue
          const file = join(child, name)
          let info
          try {
            info = statSync(file)
          } catch (error) {
            void error
            continue
          }
          fileCount += 1
          seen.add(file)
          const previous = files.get(file)
          if (previous !== undefined && previous.mtime === info.mtimeMs && previous.size === info.size) {
            if (previous.rows.length > 0) sessionCount += 1
            continue
          }
          let buffer
          try {
            buffer = readFileSync(file)
          } catch (error) {
            void error
            continue
          }
          let text = ''
          try {
            text = name.endsWith('.zstd') ? decodeSessionLog(buffer) : buffer.toString('utf8')
          } catch (error) {
            void error
          }
          const rows = text === '' ? [] : extractLocalUsageRows(text)
          files.set(file, { mtime: info.mtimeMs, size: info.size, rows })
          if (rows.length > 0) sessionCount += 1
        }
      }
    }
    for (const file of [...files.keys()]) if (!seen.has(file)) files.delete(file)
    const merged = new Map()
    for (const record of files.values()) {
      for (const row of record.rows) {
        const key = row.date + '\u0000' + row.model
        const target = merged.get(key)
        if (target === undefined) {
          merged.set(key, Object.assign({}, row))
        } else {
          target.tokens += row.tokens
          target.input += row.input
          target.output += row.output
          target.cache += row.cache
          target.requests += row.requests
        }
      }
    }
    return { rows: [...merged.values()], files: fileCount, sessions: sessionCount }
  }
}

/** Filter and aggregate the local UncensoredLLM rows for one query. */
function summarizeLocalUsage(data, query) {
  const from = query.from === undefined ? null : query.from
  const to = query.to === undefined ? null : query.to
  const model = query.model === undefined ? null : query.model
  const totals = { tokens: 0, input: 0, output: 0, cache: 0, requests: 0 }
  const byDay = new Map()
  const byModel = new Map()
  let firstDate = null
  let lastDate = null
  for (const row of data.rows) {
    if (from !== null && row.date < from) continue
    if (to !== null && row.date > to) continue
    if (model !== null && row.model !== model) continue
    totals.tokens += row.tokens
    totals.input += row.input
    totals.output += row.output
    totals.cache += row.cache
    totals.requests += row.requests
    if (firstDate === null || row.date < firstDate) firstDate = row.date
    if (lastDate === null || row.date > lastDate) lastDate = row.date
    const day = byDay.get(row.date)
    if (day === undefined) {
      byDay.set(row.date, { date: row.date, tokens: row.tokens, requests: row.requests })
    } else {
      day.tokens += row.tokens
      day.requests += row.requests
    }
    const entry = byModel.get(row.model)
    if (entry === undefined) {
      byModel.set(row.model, {
        model: row.model, tokens: row.tokens, input: row.input,
        output: row.output, cache: row.cache, requests: row.requests,
      })
    } else {
      entry.tokens += row.tokens
      entry.input += row.input
      entry.output += row.output
      entry.cache += row.cache
      entry.requests += row.requests
    }
  }
  return {
    provider: ULM_PROVIDER,
    source: 'session-log',
    firstDate,
    lastDate,
    totals,
    byDay: [...byDay.values()].sort((left, right) => (left.date < right.date ? -1 : 1)),
    byModel: [...byModel.values()].sort((left, right) => right.tokens - left.tokens),
    scannedAt: data.at,
    sessions: data.sessions,
  }
}

/** Parse and validate the overview query string. */
function parseQuery(url) {
  const from = parseDate(url.searchParams.get('from'))
  const to = parseDate(url.searchParams.get('to'))
  if (from !== null && to !== null && from > to) throw new UsageError('invalid_query', 'from is after to')
  const key = url.searchParams.get('key')
  const model = url.searchParams.get('model')
  return {
    ...from === null ? {} : { from },
    ...to === null ? {} : { to },
    ...key === null || key === '' ? {} : { key },
    ...model === null || model === '' ? {} : { model },
    refresh: url.searchParams.get('refresh') === '1',
  }
}

/** Accept a real `YYYY-MM-DD` date string, else null. */
function parseDate(value) {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new UsageError('invalid_query', `invalid date ${value}`)
  return value
}

/**
 * Export windows accepted for one month. The platform export endpoint accepts
 * at most 31 days aligned to UTC midnights (or at most 24 hours), so the
 * current month must end on the next UTC midnight instead of "now". A
 * fallback that drops the partial current day is kept for platform changes.
 * @returns {{start: number, ends: number[]}} epoch-second window candidates.
 */
function monthWindow(year, month, isCurrent, now) {
  const start = Math.floor(Date.UTC(year, month - 1, 1) / 1000)
  if (!isCurrent) return { start, ends: [Math.floor(Date.UTC(year, month, 1) / 1000)] }
  const todayStart = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000)
  const ends = [todayStart + 86_400]
  if (todayStart > start) ends.push(todayStart)
  return { start, ends }
}

/** Request one export zip for an exact epoch-second window. */
async function requestMonthExport(session, start, end) {
  const url = `${session.origin}/api/v0/usage/export?start=${start}&end=${end}&tz=0`
  let response
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/octet-stream',
        'x-dsh-auth-token': session.token,
        'user-agent': USER_AGENT,
        ...(session.requestHeaders ?? {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    })
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new UsageError('timeout')
    throw new UsageError('network')
  }
  let buffer
  try {
    buffer = Buffer.from(await response.arrayBuffer())
  } catch {
    throw new UsageError('network')
  }
  if (buffer.length > MAX_ZIP_BYTES) throw new UsageError('platform', 'export too large')
  if (response.status === 401) throw new UsageError('auth_expired')
  if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    const text = buffer.toString('utf8')
    if (text.includes('40003') || text.includes('Authorization')) throw new UsageError('auth_expired')
    throw new UsageError('platform', `export status ${response.status}: ${text.slice(0, 200)}`)
  }
  return extractZip(buffer)
}

/** Fetch one month of usage export and aggregate its CSVs. */
async function fetchMonth(session, year, month) {
  const now = new Date()
  const isCurrent = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1
  const { start, ends } = monthWindow(year, month, isCurrent, now)
  let files = null
  let lastError = null
  for (const end of ends) {
    try {
      files = await requestMonthExport(session, start, end)
      lastError = null
      break
    } catch (error) {
      lastError = error
      // An expired grant or a transport failure is not fixed by a smaller window.
      if (!(error instanceof UsageError) || error.code === 'auth_expired' || error.code === 'network' || error.code === 'timeout') break
    }
  }
  if (files === null) throw lastError ?? new UsageError('platform', 'export failed')
  const result = {
    key: monthKey(year, month),
    complete: !isCurrent,
    currency: CURRENCY_FALLBACK,
    rows: [],
    walletByDate: new Map(),
    maskedKeys: new Map(),
    syncedAt: Date.now(),
  }
  loadExportFiles(files, result)
  return result
}

/** Parse the zip's amount and cost CSVs into compact usage rows. */
function loadExportFiles(files, result) {
  const rowMap = new Map()
  for (const name of Object.keys(files)) {
    const lower = name.toLowerCase()
    if (!lower.endsWith('.csv')) continue
    const content = files[name]
    if (content.length > MAX_CSV_BYTES) continue
    const text = content.toString('utf8')
    const rows = parseUsageCsv(text)
    if (lower.startsWith('amount')) {
      for (const row of rows) {
        const date = normalizeDate(row.utc_date)
        if (date === null) continue
        const type = row.type ?? ''
        const amount = toNumber(row.amount)
        const price = toNumber(row.price)
        const apiKeyName = row.api_key_name === undefined || row.api_key_name === '' ? '(未命名 Key)' : row.api_key_name
        const apiKeyMasked = row.api_key ?? ''
        if (apiKeyMasked !== '' && !result.maskedKeys.has(apiKeyName)) result.maskedKeys.set(apiKeyName, apiKeyMasked)
        const model = row.model === undefined ? '' : row.model
        const bucketKey = `${date}\u0000${apiKeyName}\u0000${model}`
        let bucket = rowMap.get(bucketKey)
        if (bucket === undefined) {
          bucket = { date, key: apiKeyName, model, tokens: 0, requests: 0, cost: 0 }
          rowMap.set(bucketKey, bucket)
        }
        if (TOKEN_TYPES.has(type)) bucket.tokens += amount
        else if (type === 'request_count') bucket.requests += amount
        // Every priced row contributes money: token types and tool function calls
        // both carry a unit price, and request_count rows do not.
        if (price > 0) bucket.cost += amount * price
      }
    } else if (lower.startsWith('cost')) {
      for (const row of rows) {
        const date = normalizeDate(row.utc_date)
        if (date === null) continue
        if (typeof row.currency === 'string' && row.currency !== '') result.currency = row.currency
        const wallet = row.wallet_type ?? ''
        let bucket = result.walletByDate.get(date)
        if (bucket === undefined) {
          bucket = { paid: 0, granted: 0 }
          result.walletByDate.set(date, bucket)
        }
        const cost = toNumber(row.cost)
        if (wallet === 'Granted') bucket.granted += cost
        else bucket.paid += cost
      }
    }
  }
  result.rows = [...rowMap.values()]
}

/** Rebuild the cross-month dataset from the cached month entries. */
function rebuildDataset(monthMap) {
  const rows = []
  const keys = new Set()
  const models = new Set()
  const maskedKeys = new Map()
  const walletByDate = new Map()
  let currency = CURRENCY_FALLBACK
  let firstDate = null
  let lastDate = null
  for (const month of [...monthMap.values()].sort((left, right) => (left.key < right.key ? -1 : 1))) {
    currency = month.currency ?? currency
    for (const row of month.rows) {
      rows.push(row)
      keys.add(row.key)
      models.add(row.model === '' ? 'tool' : row.model)
      if (firstDate === null || row.date < firstDate) firstDate = row.date
      if (lastDate === null || row.date > lastDate) lastDate = row.date
    }
    for (const [key, value] of month.maskedKeys) if (!maskedKeys.has(key)) maskedKeys.set(key, value)
    for (const [date, value] of month.walletByDate) {
      const target = walletByDate.get(date) ?? { paid: 0, granted: 0 }
      target.paid += value.paid
      target.granted += value.granted
      walletByDate.set(date, target)
    }
  }
  rows.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))
  return {
    rows,
    keys: [...keys].sort((left, right) => left.localeCompare(right)),
    models: [...models].sort((left, right) => left.localeCompare(right)),
    maskedKeys,
    walletByDate,
    currency,
    firstDate,
    lastDate,
  }
}

/** Filter and aggregate the compact dataset for one query. */
function aggregateDataset(dataset, query) {
  const from = query.from ?? dataset.firstDate
  const to = query.to ?? dataset.lastDate
  const empty = {
    from: from ?? null, to: to ?? null, currency: dataset.currency, allTime: from === null || query.from === undefined,
    totals: { tokens: 0, cost: 0, requests: 0 }, byDay: [], byKey: [], byModel: [],
    firstDate: dataset.firstDate, lastDate: dataset.lastDate,
  }
  if (from === null || to === null || from > to) return empty
  // Tool/function-call fees are exported with an empty model; the overview
  // exposes that bucket under the stable pseudo-model name `tool`.
  const modelFilter = query.model === 'tool' ? '' : query.model
  const rows = dataset.rows.filter((row) => row.date >= from && row.date <= to
    && (query.key === undefined || row.key === query.key)
    && (modelFilter === undefined || row.model === modelFilter))
  const totals = { tokens: 0, cost: 0, requests: 0 }
  const dayMap = new Map()
  const keyMap = new Map()
  const modelMap = new Map()
  for (const row of rows) {
    totals.tokens += row.tokens
    totals.cost += row.cost
    totals.requests += row.requests
    addInto(dayMap, row.date, row)
    addInto(keyMap, row.key, row)
    addInto(modelMap, row.model === '' ? 'tool' : row.model, row)
  }
  const byDay = fillDays(from, to, dayMap)
  const byKey = [...keyMap.entries()]
    .map(([key, value]) => ({ key, maskedKey: dataset.maskedKeys.get(key) ?? '', tokens: value.tokens, cost: roundMoney(value.cost), requests: value.requests }))
    .sort((left, right) => right.cost - left.cost || right.tokens - left.tokens)
  const byModel = [...modelMap.entries()]
    .map(([model, value]) => ({ model, tokens: value.tokens, cost: roundMoney(value.cost), requests: value.requests }))
    .sort((left, right) => right.cost - left.cost || right.tokens - left.tokens)
  const wallet = query.key === undefined && query.model === undefined ? walletTotals(dataset, from, to) : null
  return {
    from, to, currency: dataset.currency, allTime: query.from === undefined,
    totals: { tokens: totals.tokens, cost: roundMoney(totals.cost), requests: totals.requests },
    ...wallet === null ? {} : { wallet },
    byDay, byKey, byModel,
    firstDate: dataset.firstDate, lastDate: dataset.lastDate,
  }
}

/** Sum the platform wallet split (paid vs granted) over one UTC day range. */
function walletTotals(dataset, from, to) {
  const totals = { currency: dataset.currency, paid: 0, granted: 0 }
  for (const [date, value] of dataset.walletByDate) {
    if (date < from || date > to) continue
    totals.paid += value.paid
    totals.granted += value.granted
  }
  totals.paid = roundMoney(totals.paid)
  totals.granted = roundMoney(totals.granted)
  return totals
}

/** Expand one range into every UTC day, filling days without usage with zeros. */
function fillDays(from, to, dayMap) {
  const days = []
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10)
    const value = dayMap.get(date)
    days.push({ date, tokens: value?.tokens ?? 0, cost: roundMoney(value?.cost ?? 0), requests: value?.requests ?? 0 })
  }
  return days
}

/** Build the inclusive `YYYY-MM` target list between two months. */
function monthRange(fromYear, fromMonth, toYear, toMonth) {
  const list = []
  let year = fromYear
  let month = fromMonth
  while (year < toYear || (year === toYear && month <= toMonth)) {
    list.push({ key: monthKey(year, month), year, month })
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return list
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** `20261001` / `2026-10-01` / ISO timestamps → `2026-10-01`; null when unusable. */
function normalizeDate(value) {
  if (typeof value !== 'string' || value === '') return null
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`
}

function toNumber(value) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round(value * 1e6) / 1e6
}

/** Run an async mapper over items with a bounded concurrency. */
async function mapLimit(items, limit, mapper) {
  const queue = items.slice()
  const workers = []
  const count = Math.max(1, Math.min(limit, queue.length))
  for (let index = 0; index < count; index++) {
    workers.push((async () => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) return
        await mapper(item)
      }
    })())
  }
  await Promise.all(workers)
}

/** Minimal zip reader for the two CSV entries of one usage export. */
function extractZip(buffer) {
  let eocd = -1
  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer[index] === 0x50 && buffer[index + 1] === 0x4b && buffer[index + 2] === 0x05 && buffer[index + 3] === 0x06) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new UsageError('platform', 'export zip has no central directory')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const files = {}
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new UsageError('platform', 'export zip central directory is corrupt')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (localOffset + 30 > buffer.length) throw new UsageError('platform', 'export zip local header is corrupt')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart > buffer.length || compressedSize > buffer.length - dataStart) throw new UsageError('platform', 'export zip entry is corrupt')
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let data
    try {
      data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(uncompressedSize, 1024) + 1024 })
    } catch {
      throw new UsageError('platform', 'export zip entry cannot be inflated')
    }
    files[name] = data
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { current += '"'; index++ } else if (character === '"') quoted = false
      else current += character
    } else if (character === '"') quoted = true
    else if (character === ',') { result.push(current); current = '' }
    else current += character
  }
  result.push(current)
  return result
}

function parseUsageCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0].replace(/\r+$/, ''))
  if (headers.length === 1 && headers[0] === '') return []
  const rows = []
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].replace(/\r+$/, '')
    if (line.trim() === '') continue
    const values = parseCsvLine(line)
    const row = {}
    headers.forEach((header, column) => { row[header] = column < values.length ? values[column] : '' })
    rows.push(row)
  }
  return rows
}
