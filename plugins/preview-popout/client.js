/**
 * Browser half of the preview pop-out bundle.
 *
 * The right-side document preview is a dockkit tab strip inside the
 * `@deepseek-ai/dsh-client-ui-sidebar-right` docking surface. This module adds
 * one gesture and one menu action on top of it without touching the preview
 * renderer:
 *
 *  - dragging a file tab chip out of the preview panel (release outside the
 *    panel) asks the Host to spawn the dedicated native preview window and
 *    shows the file's preview in it; the tab's context menu offers the same;
 *  - the window opened that way reads the pop-out payload from its URL
 *    fragment, selects the Session, reopens the same resource, and stretches
 *    the right panel over the whole window.
 *
 * On the Desktop the Host launches its own minimal Electron shell, so no system
 * browser is involved. A pure-Web deployment falls back to a regular popup
 * window, and a blocked popup leaves the in-app floating pane as the fallback.
 *
 * The tab itself stays in the sidebar, so the original preview keeps working
 * and the user can close it whenever they like.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-preview-popout',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** Locale namespace owned by this plugin. */
    const NS = 'previewPopout'
    /** Host route that mints one authenticated pop-out URL (pure-Web deployment). */
    const ROUTE = 'dsh-preview-popout/open'
    /** Host route that spawns the dedicated native preview window (Desktop deployment). */
    const NATIVE_ROUTE = 'dsh-preview-popout/native'
    /** Host route that records this pop-out window's restore outcome. */
    const READY_ROUTE = 'dsh-preview-popout/ready'
    /** URL fragment prefix that marks the pop-out window. */
    const HASH_PREFIX = '#dsh-preview-popout='
    /** URL fragment prefix of the parked warm window. */
    const WARM_HASH_PREFIX = '#dsh-preview-popout-warm='
    /** Title handshake prefix; the native shell decodes the title that follows it. */
    const READY_PREFIX = '__DSH_PREVIEW_WINDOW_READY__'
    /** Only file resources can be previewed in a separate window. */
    const RESOURCE_PREFIX = 'dsh-resource://file/'
    /** Distance the pointer must travel before the gesture becomes a drag. */
    const DRAG_THRESHOLD = 10
    /** How far beyond the panel edge the pointer must travel to count as a detach drag. */
    const DRAG_OUTSIDE_MARGIN = 24
    /** How long the restored float pane may take to appear before it is docked back. */
    const RESTORE_DELAYS = [260, 900, 1800]
    /** Minimum gap between two warm-window requests while the pointer moves across tabs. */
    const WARM_REQUEST_GAP_MS = 4000
    /** Simplified Chinese copy; the key set is the source of truth. */
    const zh = {
      'menu.openWindow': '在独立窗口中打开',
      'hint.dragOut': '松开以在独立窗口中打开',
      'popout.blocked': '浏览器阻止了新窗口，请点击下面的链接打开。',
      'popout.openLink': '在新窗口中打开',
      'popout.close': '关闭',
      'popout.title': '文件预览',
      'popout.failed': '无法在独立窗口中打开该文件。',
    }
    /** English copy; every key mirrors `zh`. */
    const en = {
      'menu.openWindow': 'Open in separate window',
      'hint.dragOut': 'Release to open in a separate window',
      'popout.blocked': 'The browser blocked the new window. Use the link below.',
      'popout.openLink': 'Open in a new window',
      'popout.close': 'Close',
      'popout.title': 'File preview',
      'popout.failed': 'The file could not be opened in a separate window.',
    }
    /** Remaining shipped locales use the English copy until they are translated. */
    const ja = {
      'menu.openWindow': '独立したウィンドウで開く',
      'hint.dragOut': '離すと独立したウィンドウで開きます',
      'popout.blocked': 'ブラウザが新しいウィンドウをブロックしました。下のリンクを使用してください。',
      'popout.openLink': '新しいウィンドウで開く',
      'popout.close': '閉じる',
      'popout.title': 'ファイルプレビュー',
      'popout.failed': 'このファイルを独立したウィンドウで開けませんでした。',
    }
    const es = {
      'menu.openWindow': 'Abrir en una ventana separada',
      'hint.dragOut': 'Suelte para abrir en una ventana separada',
      'popout.blocked': 'El navegador bloqueó la nueva ventana. Use el enlace de abajo.',
      'popout.openLink': 'Abrir en una ventana nueva',
      'popout.close': 'Cerrar',
      'popout.title': 'Vista previa del archivo',
      'popout.failed': 'No se pudo abrir el archivo en una ventana separada.',
    }
    const fr = {
      'menu.openWindow': 'Ouvrir dans une fenêtre séparée',
      'hint.dragOut': 'Relâchez pour ouvrir dans une fenêtre séparée',
      'popout.blocked': 'Le navigateur a bloqué la nouvelle fenêtre. Utilisez le lien ci-dessous.',
      'popout.openLink': 'Ouvrir dans une nouvelle fenêtre',
      'popout.close': 'Fermer',
      'popout.title': 'Aperçu du fichier',
      'popout.failed': "Le fichier n'a pas pu être ouvert dans une fenêtre séparée.",
    }
    const de = {
      'menu.openWindow': 'In separatem Fenster öffnen',
      'hint.dragOut': 'Loslassen, um in einem separaten Fenster zu öffnen',
      'popout.blocked': 'Der Browser hat das neue Fenster blockiert. Verwenden Sie den Link unten.',
      'popout.openLink': 'In neuem Fenster öffnen',
      'popout.close': 'Schließen',
      'popout.title': 'Dateivorschau',
      'popout.failed': 'Die Datei konnte nicht in einem separaten Fenster geöffnet werden.',
    }
    const ru = {
      'menu.openWindow': 'Открыть в отдельном окне',
      'hint.dragOut': 'Отпустите, чтобы открыть в отдельном окне',
      'popout.blocked': 'Браузер заблокировал новое окно. Используйте ссылку ниже.',
      'popout.openLink': 'Открыть в новом окне',
      'popout.close': 'Закрыть',
      'popout.title': 'Просмотр файла',
      'popout.failed': 'Не удалось открыть файл в отдельном окне.',
    }
    const pt = {
      'menu.openWindow': 'Abrir em uma janela separada',
      'hint.dragOut': 'Solte para abrir em uma janela separada',
      'popout.blocked': 'O navegador bloqueou a nova janela. Use o link abaixo.',
      'popout.openLink': 'Abrir em uma nova janela',
      'popout.close': 'Fechar',
      'popout.title': 'Pré-visualização do arquivo',
      'popout.failed': 'Não foi possível abrir o arquivo em uma janela separada.',
    }
    /** Captured before the application boots so the hash survives any rewrites. */
    const initialHash = typeof window === 'object' && window !== null && typeof window.location === 'object'
      ? String(window.location.hash || '')
      : ''
    /** Lightweight counters exposed for diagnostics and the verification probe. */
    const stats = { downs: 0, drags: 0, outs: 0, urls: 0, opened: 0, failed: 0, warm: 0 }
    /** Last time this page asked the Host for a parked warm window. */
    let warmRequestedAt = 0

    /** Resolve after a delay. */
    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Park a warm native window before the user starts dragging. The page is
     * transparent and mouse-ignoring, so it is invisible and inert until a
     * detach hands it a payload.
     * @param hint - optional `{ sessionId, address, title }` the parked window
     *   may preview ahead of time (usually the tab under the pointer).
     */
    function ensureWarmWindow(hint) {
      const now = Date.now()
      if (now - warmRequestedAt < WARM_REQUEST_GAP_MS) return
      warmRequestedAt = now
      stats.warm += 1
      const body = hint === undefined ? {} : {
        sessionId: hint.sessionId,
        address: hint.address,
        title: typeof hint.title === 'string' ? hint.title : '',
      }
      postJson('dsh-preview-popout/warm', body).catch(() => {})
    }

    /**
     * From inside a warm window: report readiness, optionally prepare the
     * hovered tab's preview, then poll for the payload a drag assigns. A claim
     * that matches the prepared tab only has to reveal the window; any other
     * claim falls back to the full restore path.
     * @param ctx - this plugin's Client context.
     * @param t - namespace-bound translate.
     * @param id - warm window id minted by the Host.
     * @param hint - optional `{ sessionId, address, title }` from the hover.
     */
    async function runWarmWindow(ctx, t, id, hint) {
      try {
        await postJson('dsh-preview-popout/warm-ready', { id })
      } catch {
        // The Host closes an unused warm window on its own.
      }
      let prepared
      if (hint !== undefined) {
        try {
          prepared = await prepareWarmPreview(ctx, hint)
        } catch {
          prepared = undefined
        }
        if (prepared !== undefined) postJson('dsh-preview-popout/warm-prepared', { id }).catch(() => {})
      }
      const started = Date.now()
      while (Date.now() - started < 180000) {
        await delay(120)
        let claim
        try {
          claim = await postJson('dsh-preview-popout/claim', { id })
        } catch {
          continue
        }
        const payload = claim.payload
        if (payload === null || typeof payload !== 'object'
          || typeof payload.sessionId !== 'string' || typeof payload.address !== 'string') continue
        if (prepared !== undefined && prepared.address === payload.address && prepared.sessionId === payload.sessionId) {
          // Already painted behind the transparent window: reveal immediately.
          signalPopoutReady(t, typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : prepared.title)
          reportOutcome(true, payload)
          try {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
          } catch {
            // A replaceState refusal only leaves the payload in the fragment.
          }
          return
        }
        await runPopout(ctx, t, payload)
        return
      }
    }

    /** Read one service without assuming it is present yet. */
    function service(ctx, name) {
      try {
        return ctx.get(name)
      } catch {
        return undefined
      }
    }

    /** Wait until `read` returns a truthy value, or time out. */
    async function waitFor(read, timeoutMs) {
      const start = Date.now()
      for (;;) {
        const value = read()
        if (value !== undefined && value !== null) return value
        if (Date.now() - start >= timeoutMs) return undefined
        await delay(120)
      }
    }

    /** Whether a value is a detachable file resource address. */
    function isFileAddress(value) {
      return typeof value === 'string' && value.length > RESOURCE_PREFIX.length && value.startsWith(RESOURCE_PREFIX)
    }

    /** The application base URL used for document-relative routes. */
    function baseUrl() {
      if (typeof document === 'object' && document !== null && typeof document.baseURI === 'string') return document.baseURI
      return String(window.location.href)
    }

    /** Whether this page runs inside the Desktop shell (which owns native windows). */
    function isDesktop() {
      try {
        const platform = document.documentElement.dataset.platform
        return platform === 'win32' || platform === 'darwin' || platform === 'linux'
      } catch {
        return false
      }
    }

    /** POST one small JSON object and read the JSON answer. */
    async function postJson(route, payload) {
      const response = await window.fetch(new URL(route, baseUrl()), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body === null || body.ok !== true) throw new Error(`${route} failed`)
      return body
    }

    /** Ask the Host for the dedicated native preview window (or its parked warm one). */
    async function requestNativeWindow(sessionId, address, title) {
      const body = await postJson(NATIVE_ROUTE, {
        sessionId,
        address,
        title: typeof title === 'string' ? title : '',
      })
      return body
    }

    /** Ask the Host for the authenticated pop-out URL of one resource (pure Web). */
    async function requestPopout(sessionId, address, title) {
      const body = await postJson(ROUTE, {
        sessionId,
        address,
        title: typeof title === 'string' ? title : '',
      })
      if (typeof body.url !== 'string') throw new Error('the pop-out route did not return a URL')
      return body.url
    }

    /** Read one committed tab record of a Session through the public sidebar face. */
    function tabRecord(ctx, sessionId, tabId) {
      const sidebar = service(ctx, 'sidebarRight')
      if (sidebar === undefined || sidebar === null || typeof sidebar.tabsIn !== 'function') return undefined
      try {
        const tabs = sidebar.tabsIn(sessionId)
        return Array.isArray(tabs) ? tabs.find(tab => tab !== null && tab !== undefined && tab.id === tabId) : undefined
      } catch {
        return undefined
      }
    }

    /** Open one detached preview window from an already minted URL (pure Web only). */
    function openDetachedWindow(url) {
      let popup = null
      try {
        popup = window.open(url, '_blank', 'popup=yes,width=1180,height=820,left=160,top=100')
      } catch {
        popup = null
      }
      if (popup !== null && popup !== undefined) return true
      showBlockedNotice(url)
      return false
    }

    /** Offer a plain link when a browser popup blocker refused the window. */
    function showBlockedNotice(url) {
      const previous = document.querySelector('[data-dsh-preview-popout-notice]')
      if (previous !== null) previous.remove()
      const box = document.createElement('div')
      box.setAttribute('data-dsh-preview-popout-notice', '')
      box.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:360px;padding:14px 16px;border-radius:10px;background:var(--dsw-alias-bg-elevated,#1f2329);color:var(--dsw-alias-label-primary,#e8eaed);font:13px/1.5 var(--dsw-font,sans-serif);box-shadow:0 8px 28px rgba(0,0,0,.35);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16))'
      const text = document.createElement('p')
      text.style.cssText = 'margin:0 0 8px'
      text.textContent = en['popout.blocked']
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = en['popout.openLink']
      link.style.cssText = 'color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4a90c2);font-weight:600;text-decoration:none'
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = en['popout.close']
      close.style.cssText = 'margin-left:12px;background:none;border:0;color:inherit;opacity:.75;cursor:pointer;font:inherit'
      close.addEventListener('click', () => box.remove(), { once: true })
      const actions = document.createElement('div')
      actions.append(link, close)
      box.append(text, actions)
      document.body.appendChild(box)
      setTimeout(() => box.remove(), 30000)
    }

    /** Return a tab that dockkit floated on release back to the docked column. */
    function restoreDocked(ctx, tabId) {
      try {
        const selector = `[data-dockkit-float] [data-dockkit-tab="${tabId.replace(/["\\]/g, '\\$&')}"], [data-dockkit-float] [data-sidebar-right-tab="${tabId.replace(/["\\]/g, '\\$&')}"]`
        const marker = document.querySelector(selector)
        if (marker === null) return
        const pane = marker.closest('[data-dockkit-float]')
        const paneId = pane === null ? null : pane.getAttribute('data-dockkit-float')
        if (paneId === null || paneId === '') return
        const sidebar = service(ctx, 'sidebarRight')
        if (sidebar !== undefined && sidebar !== null && typeof sidebar.dock === 'function') sidebar.dock(paneId)
      } catch {
        // A detached window already opened; a failed restore only leaves the in-app float.
      }
    }

    /** Detach one tab into an independent window; the tab itself stays open. */
    async function detachTab(ctx, sessionId, tabId, options) {
      const settings = options === undefined ? {} : options
      const tab = settings.tab !== undefined ? settings.tab : tabRecord(ctx, sessionId, tabId)
      if (tab === undefined || !isFileAddress(tab.contentId)) return false
      const title = typeof tab.title === 'string' ? tab.title : ''
      stats.urls += 1
      const fallback = () => {
        stats.failed += 1
        // Without any window the in-app floating pane is still a usable detached window.
        if (settings.fallbackFloat === true) {
          const sidebar = service(ctx, 'sidebarRight')
          if (sidebar !== undefined && sidebar !== null && typeof sidebar.float === 'function') sidebar.float(tabId)
        }
        return false
      }
      if (isDesktop()) {
        // The Desktop shell owns native windows; the Host spawns its dedicated Electron shell.
        try {
          await requestNativeWindow(sessionId, tab.contentId, title)
        } catch {
          return fallback()
        }
        stats.opened += 1
        for (const ms of RESTORE_DELAYS) setTimeout(() => restoreDocked(ctx, tabId), ms)
        return true
      }
      // Pure Web deployment: ask for an authenticated URL and open a popup window.
      let url
      try {
        url = await requestPopout(sessionId, tab.contentId, title)
      } catch {
        return fallback()
      }
      const opened = openDetachedWindow(url)
      if (opened) {
        stats.opened += 1
        for (const ms of RESTORE_DELAYS) setTimeout(() => restoreDocked(ctx, tabId), ms)
      } else {
        stats.failed += 1
      }
      return opened
    }

    /** Create the drag hint that follows the pointer while a chip is outside the panel. */
    function createHint(t) {
      const hint = document.createElement('div')
      hint.setAttribute('data-dsh-preview-popout-hint', '')
      hint.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:7px 11px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#1f2329);color:var(--dsw-alias-label-primary,#e8eaed);font:12px/1.4 var(--dsw-font,sans-serif);box-shadow:0 6px 20px rgba(0,0,0,.32);border:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4a90c2);opacity:0;transform:translate3d(0,0,0);transition:opacity .12s ease'
      hint.textContent = t('hint.dragOut')
      document.body.appendChild(hint)
      return hint
    }

    /** Install the pointer gesture on the right-sidebar tab strip. */
    function installDragGesture(ctx, t) {
      let drag = null
      let hint = null
      /** True while replaying a settling pointerup for dockkit; our own listener must step aside. */
      let replaying = false
      const moveHint = (x, y) => {
        if (hint === null) return
        hint.style.left = `${Math.round(x + 16)}px`
        hint.style.top = `${Math.round(y + 16)}px`
      }
      const disposeHint = () => {
        if (hint !== null) hint.remove()
        hint = null
      }
      /**
       * Hand dockkit a release at the chip's original position so its drag ends
       * where it started: the tab stays put instead of flashing out as a float.
       * @param chip - the chip the drag started on.
       * @param x - original pointer x.
       * @param y - original pointer y.
       */
      const settleDockkitDrag = (chip, x, y) => {
        const event = new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        })
        replaying = true
        try {
          if (chip !== null && chip.isConnected) chip.dispatchEvent(event)
          else window.dispatchEvent(event)
        } finally {
          replaying = false
        }
      }
      const onPointerDown = (event) => {
        if (event.button !== 0 || event.isPrimary === false) return
        const target = event.target
        if (!(target instanceof Element)) return
        const chip = target.closest('[data-dockkit-tab]')
        if (chip === null) return
        const owner = chip.closest('[data-sidebar-right-session]')
        const panel = chip.closest('[data-sidebar-right-panel]')
        if (owner === null || panel === null) return
        const sessionId = owner.getAttribute('data-sidebar-right-session')
        const tabId = chip.getAttribute('data-dockkit-tab')
        if (sessionId === null || sessionId === '' || tabId === null || tabId === '') return
        const tab = tabRecord(ctx, sessionId, tabId)
        if (tab === undefined || !isFileAddress(tab.contentId)) return
        stats.downs += 1
        ensureWarmWindow({ sessionId, address: tab.contentId, title: tab.title })
        drag = {
          chip,
          panel,
          sessionId,
          tabId,
          tab,
          outside: false,
          startX: event.clientX,
          startY: event.clientY,
        }
      }
      const onPointerMove = (event) => {
        if (drag === null) return
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
        if (!drag.outside) {
          if (moved < DRAG_THRESHOLD) return
          const box = drag.panel.getBoundingClientRect()
          const outside = event.clientX < box.left - DRAG_OUTSIDE_MARGIN
            || event.clientY < box.top - DRAG_OUTSIDE_MARGIN
            || event.clientY > box.bottom + DRAG_OUTSIDE_MARGIN
            || event.clientX > box.right + DRAG_OUTSIDE_MARGIN
          if (!outside) return
          drag.outside = true
          stats.outs += 1
          hint = createHint(t)
          hint.style.opacity = '1'
        }
        moveHint(event.clientX, event.clientY)
      }
      const onPointerUp = (event) => {
        if (replaying || drag === null) return
        const current = drag
        drag = null
        disposeHint()
        if (!current.outside) return
        stats.drags += 1
        // This release belongs to the detach gesture: stop dockkit from turning the
        // tab into an in-app float, then settle its drag at the original position.
        event.stopImmediatePropagation()
        event.preventDefault()
        settleDockkitDrag(current.chip, current.startX, current.startY)
        void detachTab(ctx, current.sessionId, current.tabId, { tab: current.tab, fallbackFloat: false })
      }
      const onPointerCancel = () => {
        drag = null
        disposeHint()
      }
      const onPointerOver = (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const chip = target.closest('[data-dockkit-tab]')
        if (chip === null) return
        const owner = chip.closest('[data-sidebar-right-session]')
        if (owner === null) return
        const sessionId = owner.getAttribute('data-sidebar-right-session')
        const tabId = chip.getAttribute('data-dockkit-tab')
        if (sessionId === null || sessionId === '' || tabId === null || tabId === '') return
        const tab = tabRecord(ctx, sessionId, tabId)
        if (tab !== undefined && isFileAddress(tab.contentId)) {
          ensureWarmWindow({ sessionId, address: tab.contentId, title: tab.title })
        }
      }
      const passive = { capture: true, passive: true }
      window.addEventListener('pointerdown', onPointerDown, passive)
      window.addEventListener('pointermove', onPointerMove, passive)
      window.addEventListener('pointerover', onPointerOver, passive)
      window.addEventListener('pointerup', onPointerUp, { capture: true })
      window.addEventListener('pointercancel', onPointerCancel, passive)
      return () => {
        drag = null
        disposeHint()
        window.removeEventListener('pointerdown', onPointerDown, passive)
        window.removeEventListener('pointermove', onPointerMove, passive)
        window.removeEventListener('pointerover', onPointerOver, passive)
        window.removeEventListener('pointerup', onPointerUp, { capture: true })
        window.removeEventListener('pointercancel', onPointerCancel, passive)
      }
    }

    /**
     * Decode one Base64URL UTF-8 JSON payload.
     * @param raw - Base64URL text without padding.
     * @returns the parsed value, or undefined.
     */
    function decodePayload(raw) {
      if (typeof raw !== 'string' || raw === '') return undefined
      try {
        const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
        const binary = window.atob(padded)
        // The payload is UTF-8 JSON; atob yields one Latin-1 code unit per byte,
        // so decode the bytes as UTF-8 or non-ASCII titles (e.g. Chinese file
        // names) would arrive as mojibake.
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        return JSON.parse(new TextDecoder('utf-8').decode(bytes))
      } catch {
        return undefined
      }
    }

    /** Read the pop-out payload out of the initial URL fragment. */
    function readPayload(hash) {
      if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return undefined
      const parsed = decodePayload(hash.slice(HASH_PREFIX.length))
      if (parsed !== null && typeof parsed === 'object' && parsed.v === 1
        && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
        && typeof parsed.address === 'string' && parsed.address.startsWith('dsh-resource://')) {
        return parsed
      }
      return undefined
    }

    /**
     * Parse a warm URL fragment: `<warm id>` plus an optional `.`-separated
     * Base64URL hint payload the parked window can preview ahead of time.
     * @param hash - current fragment.
     * @returns the id and optional hint, or undefined.
     */
    function readWarmHash(hash) {
      if (typeof hash !== 'string' || !hash.startsWith(WARM_HASH_PREFIX)) return undefined
      const raw = hash.slice(WARM_HASH_PREFIX.length)
      const dot = raw.indexOf('.')
      const id = dot === -1 ? raw : raw.slice(0, dot)
      if (id === '') return undefined
      const hint = dot === -1 ? undefined : decodePayload(raw.slice(dot + 1))
      return {
        id: decodeURIComponent(id),
        hint: hint !== null && typeof hint === 'object' && typeof hint.sessionId === 'string' && typeof hint.address === 'string' ? hint : undefined,
      }
    }

    /**
     * Encode the reveal handshake: a fixed prefix plus the UTF-8 title in
     * Base64URL. The native shell decodes the title and sets it on the window,
     * so Chinese file names survive the page-title channel.
     * @param title - window title.
     * @returns the marker title.
     */
    function encodeReadyTitle(title) {
      const bytes = new TextEncoder().encode(typeof title === 'string' ? title : '')
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return `${READY_PREFIX}${window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')}`
    }

    /** Apply the whole-window presentation stylesheet once. */
    function applyPopoutStyle() {
      if (document.documentElement.hasAttribute('data-dsh-preview-popout')) return
      const style = document.createElement('style')
      style.setAttribute('data-dsh-preview-popout-style', '')
      style.textContent = `
html[data-dsh-preview-popout] #root { visibility: hidden; }
html[data-dsh-preview-popout] body { overflow: hidden; }
html[data-dsh-preview-popout] [data-sidebar-right-panel] {
  visibility: visible !important;
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  max-width: none !important;
  height: 100vh !important;
  transform: none !important;
  z-index: 2147483000 !important;
  background: var(--dsw-alias-bg-base, var(--dsw-static-neutral-00, #ffffff));
}
html[data-dsh-preview-popout] [data-sidebar-right-panel] * { visibility: visible !important; }
html[data-dsh-preview-popout] [data-sidebar-right-panel] [data-dockkit-strip],
html[data-dsh-preview-popout] [data-sidebar-right-panel] [data-dockkit-float],
html[data-dsh-preview-popout] [data-sidebar-right-panel] [data-dockkit-empty],
html[data-dsh-preview-popout] [data-sidebar-right-panel] [data-dockkit-divider] { display: none !important; }
`
      document.head.appendChild(style)
      document.documentElement.setAttribute('data-dsh-preview-popout', '')
    }

    /** Signal the native shell to reveal this window, carrying the UTF-8 title. */
    function signalPopoutReady(t, title) {
      const name = typeof title === 'string' && title.length > 0 ? title : t('popout.title')
      // The native shell moves the window into view only after this marker, so
      // give the presentation two painted frames first: the first visible frame
      // is the preview instead of the full application shell.
      const markReady = () => {
        document.title = encodeReadyTitle(name)
        setTimeout(() => { document.title = name }, 350)
        setTimeout(() => { document.title = name }, 1600)
      }
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setTimeout(markReady, 80)))
      } else {
        setTimeout(markReady, 160)
      }
    }

    /** Stretch the right panel over this window and reveal it on the native shell. */
    function enterPopoutPresentation(t, title) {
      applyPopoutStyle()
      signalPopoutReady(t, title)
    }

    /** Warn on the standalone page when the preview could not be restored. */
    function showPopoutFailure(t) {
      const banner = document.createElement('div')
      banner.setAttribute('data-dsh-preview-popout-failure', '')
      banner.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:8px;background:#b3261e;color:#fff;font:13px/1.4 var(--dsw-font,sans-serif)'
      banner.textContent = t('popout.failed')
      document.body.appendChild(banner)
      // Reveal the native window even on failure so the application (and the notice) is visible.
      document.title = encodeReadyTitle('')
    }

    /** The Session the right sidebar is currently showing, if any. */
    function mountedSession(sidebar) {
      try {
        return sidebar.mounted === undefined || sidebar.mounted === null ? undefined : sidebar.mounted.getSnapshot()
      } catch {
        return undefined
      }
    }

    /** Whether the committed tabs already contain the detached resource. */
    function previewTabOpen(sidebar, address) {
      const sessionId = mountedSession(sidebar)
      if (typeof sessionId !== 'string') return false
      try {
        const tabs = sidebar.tabsIn(sessionId)
        return Array.isArray(tabs) && tabs.some(tab => tab !== null && tab !== undefined && tab.contentId === address)
      } catch {
        return false
      }
    }

    /** Record the restore outcome of this pop-out window with the Host. */
    function reportOutcome(ok, payload) {
      try {
        void window.fetch(new URL(READY_ROUTE, baseUrl()), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok, sessionId: payload.sessionId, address: payload.address }),
        }).catch(() => undefined)
      } catch {
        // Diagnostics must never break the window restore.
      }
    }

    /**
     * Select the Session and reopen the previewed resource in this window.
     * Shared by the reveal path and the parked-window preparation path.
     * @returns whether the preview tab is committed.
     */
    async function restorePreview(ctx, payload) {
      const sidebar = await waitFor(() => service(ctx, 'sidebarRight'), 25000)
      const workspace = await waitFor(() => service(ctx, 'uiWorkspace'), 25000)
      if (sidebar === undefined || sidebar === null || workspace === undefined || workspace === null) return false
      const started = Date.now()
      let selected = false
      while (Date.now() - started < 30000) {
        if (!selected && mountedSession(sidebar) !== payload.sessionId) {
          try {
            workspace.openSession(payload.sessionId)
          } catch {
            // A later attempt may still open the preview through the address' own Session.
          }
          selected = true
          await delay(150)
          continue
        }
        try {
          sidebar.openResource(payload.address)
        } catch {
          await delay(120)
          continue
        }
        // Poll right after the open instead of sleeping fixed mounts: the tab is
        // usually committed within a few frames.
        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (previewTabOpen(sidebar, payload.address)) return true
          await delay(50)
        }
        await delay(100)
      }
      return false
    }

    /** Restore the Session and reopen the file in this pop-out window, then reveal it. */
    async function runPopout(ctx, t, payload) {
      const opened = await restorePreview(ctx, payload)
      if (!opened) {
        showPopoutFailure(t)
        reportOutcome(false, payload)
        return
      }
      await delay(350)
      enterPopoutPresentation(t, payload.title)
      // A presentation without a drawn panel would hide everything; verify and back out.
      setTimeout(() => {
        if (document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') === null) {
          document.documentElement.removeAttribute('data-dsh-preview-popout')
          showPopoutFailure(t)
          reportOutcome(false, payload)
        }
      }, 1800)
      reportOutcome(true, payload)
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      } catch {
        // A replaceState refusal only leaves the payload in the fragment.
      }
    }

    /**
     * In a parked warm window, restore the hovered tab's preview ahead of time
     * while the window stays transparent; a later claim only has to reveal it.
     *
     * The resource address carries its own Session, so the fast path opens it in
     * whatever Session the freshly booted window already shows; only when that
     * has no surface does it fall back to the full Session-selection path.
     * @returns the prepared identity, or undefined when the preview did not open.
     */
    async function prepareWarmPreview(ctx, hint) {
      const sidebar = await waitFor(() => service(ctx, 'sidebarRight'), 25000)
      if (sidebar === undefined || sidebar === null) return undefined
      let opened = false
      let requested = false
      try {
        sidebar.openResource(hint.address)
        requested = true
      } catch {
        // No adopted Session surface yet: fall through to the selecting path.
      }
      if (requested) {
        for (let attempt = 0; attempt < 10 && !opened; attempt += 1) {
          opened = previewTabOpen(sidebar, hint.address)
          if (!opened) await delay(40)
        }
      }
      if (!opened) {
        opened = await restorePreview(ctx, hint)
      }
      if (!opened) return undefined
      await delay(80)
      applyPopoutStyle()
      return {
        sessionId: hint.sessionId,
        address: hint.address,
        title: typeof hint.title === 'string' ? hint.title : '',
      }
    }

    return {
      inject: ['locale', 'contextMenus'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'preview-popout: dictionaries')
        // The tab menu row mirrors the sidebar's own tab actions.
        ctx.effect(() => ctx.contextMenus.register({
          id: 'preview-popout',
          target: 'tab',
          order: 60,
          resolve: ({ sessionId, tab }) => {
            if (sessionId === undefined || tab === undefined || tab === null || !isFileAddress(tab.contentId)) return []
            return [{
              id: 'open-in-window',
              label: t('menu.openWindow'),
              run: () => { void detachTab(ctx, sessionId, tab.id, { tab, fallbackFloat: true }) },
            }]
          },
        }), 'preview-popout: tab actions')
        ctx.effect(() => installDragGesture(ctx, t), 'preview-popout: tab drag gesture')
        const warm = readWarmHash(initialHash)
        if (warm !== undefined) {
          // Parked window: prepare the hinted preview, stay transparent until claimed.
          document.documentElement.setAttribute('data-dsh-preview-popout-warm', '')
          void runWarmWindow(ctx, t, warm.id, warm.hint)
        }
        const payload = readPayload(initialHash)
        if (payload !== undefined) {
          document.documentElement.setAttribute('data-dsh-preview-popout-pending', '')
          void runPopout(ctx, t, payload)
        }
        document.documentElement.setAttribute('data-dsh-preview-popout-ready', '1')
        // Small public face so the gesture and the window restore are observable and reusable.
        window.__dshPreviewPopout = {
          version: '1.0.0',
          detach: (tabId) => {
            const sidebar = service(ctx, 'sidebarRight')
            const sessionId = sidebar !== undefined && sidebar !== null && sidebar.mounted !== undefined
              ? sidebar.mounted.getSnapshot()
              : undefined
            if (typeof sessionId !== 'string') return Promise.resolve(false)
            return detachTab(ctx, sessionId, tabId, { fallbackFloat: true })
          },
          detachTab: (sessionId, tabId) => detachTab(ctx, sessionId, tabId, { fallbackFloat: true }),
          isPopoutWindow: () => document.documentElement.hasAttribute('data-dsh-preview-popout'),
          isReady: () => true,
          stats,
        }
      },
    }
  },
})
