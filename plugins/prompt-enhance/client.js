window.__ModuleLoader__.load({
  id: 'dsh-plugin-prompt-enhance',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'promptEnhance'
    const PACKAGE_ID = 'dsh-plugin-prompt-enhance'
    const ENDPOINT_PATH = 'dsh-prompt-enhance/enhance'
    const STYLE_TAG_ID = PACKAGE_ID + '/prompt-enhance.css'
    /** Client-side ceiling; the Host route owns the authoritative timeout. */
    const CLIENT_TIMEOUT_MS = 75000
    /** How long a notice stays on the button. */
    const NOTICE_MS = 2600

    /** Visible copy owned by this plugin. */
    const zh = {
      'action.enhance': '增强提示词',
      'action.enhancing': '正在增强提示词',
      'hint': '用默认模型把草稿改写为更清晰的提示词',
      'empty': '先输入内容，再使用提示词增强',
      'notice.changed': '草稿已变化，增强结果未替换',
      'notice.refs': '草稿包含引用，已保留原草稿',
      'error.failed': '提示词增强失败，请重试',
      'error.timeout': '提示词增强超时，请重试',
      'error.invalid': '当前草稿无法增强',
      'error.tooLong': '草稿过长，无法增强',
      'error.noModel': '未配置默认模型，无法增强',
      'error.emptyResult': '模型没有返回可用内容，请重试',
      'error.unauthorized': '当前页面无权调用提示词增强',
      'error.network': '无法连接到本地服务',
      'error.unavailable': '提示词增强暂不可用',
      'error.cancelled': '提示词增强已取消',
    }

    const en = {
      'action.enhance': 'Enhance prompt',
      'action.enhancing': 'Enhancing prompt',
      'hint': 'Rewrite the draft into a clearer prompt with the default model',
      'empty': 'Type a draft first',
      'notice.changed': 'The draft changed, so the enhanced prompt was discarded',
      'notice.refs': 'The draft has references, so the original draft was kept',
      'error.failed': 'Prompt enhancement failed. Try again.',
      'error.timeout': 'Prompt enhancement timed out. Try again.',
      'error.invalid': 'This draft cannot be enhanced',
      'error.tooLong': 'The draft is too long to enhance',
      'error.noModel': 'No default model is configured',
      'error.emptyResult': 'The model returned no usable text',
      'error.unauthorized': 'This page is not allowed to enhance prompts',
      'error.network': 'Could not reach the local service',
      'error.unavailable': 'Prompt enhancement is unavailable',
      'error.cancelled': 'Prompt enhancement was cancelled',
    }

    /**
     * Control geometry mirrors the shipped send circle (`.primary` in
     * InputBar.module.css): a 34px round 34px control that keeps the same
     * -2px seat inside the composer's trailing group. Orange is this
     * button's own accent because the theme exposes no warning-orange alias.
     */
    const STYLES = [
      '.dshPromptEnhance_button{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;',
      'border:none;border-radius:999px;corner-shape:round;background:#f97316;color:#fff;cursor:pointer;',
      'transition:background-color 100ms ease,box-shadow 100ms ease;transform:translateY(-2px)}',
      '@media (hover:hover){.dshPromptEnhance_button:hover:not(:disabled){background:#ea6a0a}}',
      '.dshPromptEnhance_button:active:not(:disabled){background:#d95f06}',
      '.dshPromptEnhance_button:disabled{opacity:.4;cursor:default}',
      '.dshPromptEnhance_button.dshPromptEnhance_busy:disabled{opacity:1;cursor:progress}',
      '.dshPromptEnhance_button.dshPromptEnhance_error{background:var(--dsw-alias-state-error-primary)}',
      '.dshPromptEnhance_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshPromptEnhance_spinner{width:16px;height:16px;border-radius:50%;box-sizing:border-box;',
      'border:2px solid rgba(255,255,255,.35);border-top-color:#fff;',
      'animation:dshPromptEnhance_spin 800ms linear infinite}',
      '@media (prefers-reduced-motion:reduce){.dshPromptEnhance_spinner{animation-duration:2400ms}}',
      '@keyframes dshPromptEnhance_spin{to{transform:rotate(360deg)}}',
    ].join('')

    /** Host failure code to localized notice key. */
    const NOTICE_BY_CODE = {
      'empty-draft': 'error.invalid',
      'bad-request': 'error.invalid',
      'method-not-allowed': 'error.invalid',
      'draft-too-long': 'error.tooLong',
      'enhance/no-model': 'error.noModel',
      'enhance/timeout': 'error.timeout',
      'enhance/cancelled': 'error.cancelled',
      'enhance/empty-result': 'error.emptyResult',
      'enhance/failed': 'error.failed',
      'unauthorized': 'error.unauthorized',
      'network': 'error.network',
      'unavailable': 'error.unavailable',
      'internal': 'error.failed',
    }

    /** Error carrying a stable code so visible copy can be localized. */
    class EnhanceRequestError extends Error {
      constructor(code, message) {
        super(message === undefined ? code : message)
        this.name = 'EnhanceRequestError'
        this.code = code
      }
    }

    /**
     * Ask the Host plugin route to rewrite one draft.
     * @param text - draft text to enhance.
     * @param signal - caller cancellation.
     * @returns the Host success payload.
     */
    async function requestHostEnhance(text, signal) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        throw new EnhanceRequestError('unavailable')
      }
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : window.location.href
      const url = new URL(ENDPOINT_PATH, base)
      let response
      try {
        response = await window.fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal,
        })
      } catch (error) {
        throw new EnhanceRequestError('network', error instanceof Error ? error.message : undefined)
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (response.status === 401 || response.status === 403) throw new EnhanceRequestError('unauthorized')
      if (!response.ok || payload === null || payload.ok !== true) {
        const code = payload !== null && typeof payload.code === 'string' ? payload.code : 'http-' + response.status
        const message = payload !== null && typeof payload.message === 'string' ? payload.message : undefined
        throw new EnhanceRequestError(code, message)
      }
      if (typeof payload.text !== 'string' || payload.text.trim() === '') {
        throw new EnhanceRequestError('enhance/empty-result')
      }
      return payload
    }

    /** Sparkles artwork marking the enhance action; inherits `currentColor`. */
    function SparkleIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 17,
        height: 17,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M11.1 3.1l1.75 5.05 5.05 1.75-5.05 1.75-1.75 5.05-1.75-5.05-5.05-1.75 5.05-1.75 1.75-5.05z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M18.1 13.4l1.05 3.05 3.05 1.05-3.05 1.05-1.05 3.05-1.05-3.05-3.05-1.05 3.05-1.05 1.05-3.05z',
          fill: 'currentColor',
          fillOpacity: 0.9,
        }),
      )
    }

    /**
     * The composer's orange enhance circle, rendered before the submit action.
     * @param props - the slot's input hooks plus this plugin's locale seat.
     * @returns one round button.
     */
    function PromptEnhanceButton(props) {
      const { useInput, inputActions, t } = props
      const draft = useInput((state) => state.draft)
      const referenceCount = useInput((state) => (
        state !== null && typeof state === 'object' && Array.isArray(state.occurrences) ? state.occurrences.length : 0
      ))
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const alive = React.useRef(true)
      const busyRef = React.useRef(false)
      const draftRef = React.useRef(draft)
      const referenceCountRef = React.useRef(referenceCount)
      const noticeSeq = React.useRef(0)
      draftRef.current = draft
      referenceCountRef.current = referenceCount

      React.useEffect(() => () => { alive.current = false }, [])

      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => {
          if (alive.current) setNotice(null)
        }, NOTICE_MS)
        return () => { window.clearTimeout(timer) }
      }, [notice])

      const showNotice = (key) => {
        noticeSeq.current += 1
        setNotice({ key, seq: noticeSeq.current })
      }

      const onClick = () => {
        if (busyRef.current) return
        const snapshot = draftRef.current
        if (snapshot.trim() === '') return
        busyRef.current = true
        setBusy(true)
        setNotice(null)
        const controller = new AbortController()
        const timer = window.setTimeout(() => { controller.abort() }, CLIENT_TIMEOUT_MS)
        requestHostEnhance(snapshot, controller.signal).then((payload) => {
          if (!alive.current) return
          if (draftRef.current !== snapshot) {
            showNotice('notice.changed')
            return
          }
          if (referenceCountRef.current > 0) {
            showNotice('notice.refs')
            return
          }
          inputActions.setDraft(payload.text)
        }).catch((error) => {
          if (!alive.current) return
          if (controller.signal.aborted) {
            showNotice('error.timeout')
            return
          }
          const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
          showNotice(NOTICE_BY_CODE[code] || 'error.failed')
          console.warn('[prompt-enhance] enhancement failed:', error)
        }).finally(() => {
          window.clearTimeout(timer)
          busyRef.current = false
          if (alive.current) setBusy(false)
        })
      }

      const hasDraft = draft.trim() !== ''
      const noticeText = notice === null ? null : t(notice.key)
      const label = busy ? t('action.enhancing') : t('action.enhance')
      const title = noticeText !== null
        ? noticeText
        : busy
          ? t('action.enhancing')
          : hasDraft
            ? t('hint')
            : t('empty')
      const className = 'dshPromptEnhance_button'
        + (busy ? ' dshPromptEnhance_busy' : '')
        + (notice !== null ? ' dshPromptEnhance_error' : '')

      return h('button', {
        type: 'button',
        className,
        'aria-label': label,
        title,
        'aria-busy': busy ? 'true' : undefined,
        disabled: !hasDraft || busy,
        onClick,
      }, busy ? h('span', { className: 'dshPromptEnhance_spinner', 'aria-hidden': true }) : h(SparkleIcon))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_TAG_ID) + ']')
          if (existing !== null) return () => {}
          const tag = document.createElement('style')
          tag.dataset.plugin = PACKAGE_ID
          tag.dataset.pluginCss = STYLE_TAG_ID
          tag.textContent = STYLES
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'prompt-enhance: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-enhance: dictionaries')

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'prompt-enhance',
          order: 100,
          locale: NS,
          inject: () => ({ t }),
        }, PromptEnhanceButton))
      },
    }
  },
})
