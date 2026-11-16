/**
 * Host half of the prompt-enhance bundle.
 *
 * The Web client renders an orange round button beside the composer's send
 * action. A click posts the current draft to this plugin's one authenticated
 * exact route; the route rewrites the draft with the profile's default model
 * and answers the improved prompt. Connection's Host/Origin checks and signed
 * browser-cookie admission guard the route exactly like `/api`.
 */

/** The one route this plugin owns. Keep it in sync with `client.js`. */
const ROUTE_PATH = '/dsh-prompt-enhance/enhance'
/** One draft is one small JSON object; cap the body generously but finitely. */
const MAX_BODY_BYTES = 131072
/** Longest draft the button will send for enhancement. */
const MAX_DRAFT_CHARS = 20000
/** Output cap for the rewrite; prompt rewrites are bounded by the input. */
const MAX_OUTPUT_TOKENS = 2048
/** End-to-end budget for one model call. */
const CALL_TIMEOUT_MS = 60000

/** Instruction the model receives for every rewrite. */
const SYSTEM_PROMPT = [
  "You improve a user's draft message for an AI coding agent.",
  '',
  'The user message is the raw draft; it may be written in any language. Return only the improved prompt and nothing else.',
  '',
  'Rules:',
  '- Write the improved prompt in the same language as the draft.',
  '- Preserve every concrete detail: file paths, names, commands, versions, numbers, and constraints.',
  '- State the goal and the expected outcome explicitly.',
  '- Add only context the draft already implies; never invent requirements, and never answer the request.',
  '- Structure multi-part requests as short paragraphs or a short list.',
  '- Resolve ambiguity only when the intent is clear; otherwise keep the wording the user chose.',
  '- No preamble, no explanation, no surrounding quotes, and no code fences.',
  '- If the draft is already clear, polish it lightly instead of padding it.',
].join('\n')

/** Services the Host half needs before it can register the route. */
export const inject = ['webServer', 'connection', 'llm', 'agentDefaultModel']

/** Failure carrying a stable code so the Client can localize it. */
class EnhanceError extends Error {
  /**
   * @param code - stable failure code placed in the JSON response.
   * @param message - Host-side detail, never shown verbatim to the user.
   * @param cause - underlying failure, when there is one.
   */
  constructor(code, message, cause) {
    super(message === undefined ? code : message)
    this.name = 'EnhanceError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * Register the enhance route for as long as this plugin is mounted.
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
    'prompt-enhance: enhance route',
  )
}

/**
 * Answer one rewrite request.
 * @param ctx - Host plugin Context.
 * @param connection - Host Connection service (route trust + browser auth).
 * @param request - Incoming HTTP request.
 * @param response - Incoming HTTP response.
 */
async function handleRequest(ctx, connection, request, response) {
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
      sendJson(response, 400, { ok: false, code: 'bad-request', message: 'request body is not a JSON object' })
      return
    }
    const draft = body !== null && typeof body === 'object' && typeof body.text === 'string' ? body.text : ''
    if (draft.trim() === '') {
      sendJson(response, 400, { ok: false, code: 'empty-draft', message: 'the draft is empty' })
      return
    }
    if (draft.length > MAX_DRAFT_CHARS) {
      sendJson(response, 413, { ok: false, code: 'draft-too-long', message: `the draft exceeds ${MAX_DRAFT_CHARS} characters` })
      return
    }

    const controller = new AbortController()
    const abort = () => { controller.abort() }
    request.on('aborted', abort)
    // `ServerResponse` emits 'close' after a normal end too; only an unfinished
    // response means the browser cancelled the fetch.
    const abortIfUnfinished = () => {
      if (!response.writableEnded) controller.abort()
    }
    response.on('close', abortIfUnfinished)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, CALL_TIMEOUT_MS)

    try {
      const enhanced = await rewriteDraft(ctx, draft, controller.signal)
      if (enhanced === '') {
        sendJson(response, 502, { ok: false, code: 'enhance/empty-result', message: 'the model returned no text' })
        return
      }
      sendJson(response, 200, { ok: true, text: enhanced })
    } catch (error) {
      if (response.writableEnded || response.destroyed) return
      if (timedOut) {
        sendJson(response, 504, { ok: false, code: 'enhance/timeout', message: 'the enhancement call timed out' })
        return
      }
      if (controller.signal.aborted) {
        sendJson(response, 499, { ok: false, code: 'enhance/cancelled', message: 'the enhancement call was cancelled' })
        return
      }
      const code = error instanceof EnhanceError ? error.code : 'enhance/failed'
      const status = code === 'enhance/no-model' ? 503 : 502
      sendJson(response, status, { ok: false, code, message: describe(error) })
    } finally {
      clearTimeout(timer)
      request.removeListener('aborted', abort)
      response.removeListener('close', abortIfUnfinished)
    }
  } catch (error) {
    sendJson(response, 500, { ok: false, code: 'internal', message: describe(error) })
  }
}

/**
 * Rewrite one draft with the profile's default model.
 * @param ctx - Host plugin Context.
 * @param draft - raw draft text.
 * @param signal - cancellation for this call.
 * @returns the improved prompt, trimmed.
 */
async function rewriteDraft(ctx, draft, signal) {
  const selection = ctx.agentDefaultModel.currentSelection()
  if (selection === undefined || selection === null || typeof selection.provider !== 'string' || selection.provider === '' || typeof selection.model !== 'string' || selection.model === '') {
    throw new EnhanceError('enhance/no-model', 'no default model selection is configured')
  }

  let output = ''
  let finish
  let stream
  try {
    stream = ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: draft }] }],
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    })
  } catch (error) {
    throw new EnhanceError('enhance/failed', describe(error), error)
  }

  try {
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    throw new EnhanceError('enhance/failed', describe(error), error)
  }

  if (finish !== undefined && finish !== null) {
    if (finish.kind === 'error') {
      const message = finish.failure !== undefined && finish.failure !== null && typeof finish.failure.message === 'string'
        ? finish.failure.message
        : 'the model call failed'
      throw new EnhanceError('enhance/failed', message)
    }
    if (finish.kind === 'aborted') throw new EnhanceError('enhance/cancelled', 'the model call was aborted')
  }
  return output.trim()
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
        settle(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')))
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
