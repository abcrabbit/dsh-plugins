/**
 * Browser half of the deliverable hover-menu bundle.
 *
 * The same four-action floating menu is attached to two surfaces:
 *
 *  1. The shipped `@deepseek-ai/dsh-client-ui-deliverables` plugin renders every
 *     `present`ed file as a card and declares the `deliverables.file.actions`
 *     list slot inside that card. This plugin registers one cell in that slot:
 *     an invisible anchor, used only to reach the enclosing card element, and a
 *     hover/focus menu portalled to `document.body`.
 *  2. Conversation file links — the blue `[name](path)` Markdown links and
 *     inline file references the shipped markdown renderer draws as `<button>`
 *     elements — have no plugin slot. A second cell in the session-scoped
 *     `conversation.composer.dock` slot watches the document for a link hover
 *     and shows the same menu anchored to that link.
 *
 * The links' and cards' own left-click preview is untouched: this plugin adds
 * no overlay above them and never calls preventDefault on their gesture.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-deliverable-menu',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin's visible copy. */
    const NS = 'deliverableMenu'
    /** This module's identity; also the style tag owner and the slot cell ids. */
    const PACKAGE_ID = '@local/dsh-plugin-deliverable-menu'
    /** Host route copying the addressed delivered file or its full path. */
    const COPY_ROUTE = 'dsh-deliverable-menu/copy'
    /** Host route acting on one conversation file link's resolved path. */
    const LINK_ROUTE = 'dsh-deliverable-menu/link'
    /** Preview-popout host route opening a file in its native standalone window. */
    const POPOUT_NATIVE_ROUTE = 'dsh-preview-popout/native'
    /** Preview-popout host route keeping one pre-booted warm window ready. */
    const POPOUT_WARM_ROUTE = 'dsh-preview-popout/warm'
    /** Style tag identity so repeated activation never stacks duplicates. */
    const STYLE_TAG_ID = PACKAGE_ID + '/deliverable-menu.css'
    /** The delivery card's shipped attribute; used to scope hover to exactly one card. */
    const CARD_SELECTOR = '[data-presented-file]'
    /** The markdown renderer's container class prefix, present in every build. */
    const MARKDOWN_ANCESTOR_SELECTOR = '[class*="markdown"]'
    /**
     * Stable prefix of the markdown renderer's CSS-module class for clickable
     * file references. The hash segment after `_fileMention_` changes between
     * DSH builds (e.g. `_fileMention_1ypvv_85` in 0.2.1-rc.5,
     * `_fileMention_rve47_92` in 0.2.2-rc.1), so match the prefix, not one build.
     */
    const FILE_MENTION_CLASS_PREFIX = '_fileMention_'
    /** Hover intent: open after a short dwell, close after the pointer has left. */
    const OPEN_DELAY_MS = 140
    const CLOSE_DELAY_MS = 180
    /** The floating menu's fixed geometry; border-box height also counts its two 1px borders. */
    const MENU_WIDTH = 224
    const MENU_ITEM_HEIGHT = 30
    const MENU_PADDING = 4
    const MENU_BORDER = 2
    const MENU_HEIGHT = MENU_ITEM_HEIGHT * 5 + MENU_PADDING * 2 + MENU_BORDER
    /** Minimum distance kept from the viewport edges. */
    const VIEWPORT_GAP = 6
    /** How long one copy result notice stays on screen. */
    const TOAST_VISIBLE_MS = 4200

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'menu.label': '交付物操作',
      'menu.open': '用系统默认程序打开',
      'menu.reveal': '打开所在文件夹',
      'menu.popout': '在独立窗口中打开',
      'menu.popoutUnavailable': '无法定位这个文件的路径',
      'menu.copyFile': '复制这个文件',
      'menu.copyPath': '复制完整路径',
      'menu.desktopUnavailable': '当前主机没有可用的桌面，无法用外部程序打开',
      'toast.fileCopied': '已复制文件，可以粘贴到文件夹中',
      'toast.pathCopied': '已复制完整路径',
      'toast.openRequested': '已请求用默认程序打开',
      'toast.revealRequested': '已请求打开所在文件夹',
      'toast.popoutOpened': '已在独立窗口中打开',
      'error.unauthorized': '当前页面无权执行此操作',
      'error.clipboardFailed': '无法写入系统剪贴板',
      'error.unsupported': '当前系统不支持此复制方式',
      'error.fileUnavailable': '找不到这个文件',
      'error.desktopUnavailable': '当前主机没有可用的桌面，无法用外部程序打开',
      'error.actionFailed': '操作失败，请重试',
      'error.popoutMissing': '未安装「预览独立窗口」插件，无法在独立窗口中打开',
      'error.popoutShellMissing': '独立窗口组件不可用（原生组件运行时缺失）',
      'error.popoutTooMany': '独立窗口数量已达上限，请先关闭一些窗口',
      'error.popoutFailed': '独立窗口打开失败，请重试',
      'error.invalid': '请求无效',
      'error.network': '无法连接到本地服务',
      'error.timeout': '操作超时，请重试',
      'error.unknown': '操作失败，请重试',
    }

    /** English dictionary, key-identical to the Chinese source of truth. */
    const en = {
      'menu.label': 'Deliverable actions',
      'menu.open': 'Open with default program',
      'menu.reveal': 'Open containing folder',
      'menu.popout': 'Open in separate window',
      'menu.popoutUnavailable': 'The path of this file could not be resolved',
      'menu.copyFile': 'Copy this file',
      'menu.copyPath': 'Copy full path',
      'menu.desktopUnavailable': 'This Host has no desktop available to open files in external apps',
      'toast.fileCopied': 'File copied; paste it into a folder',
      'toast.pathCopied': 'Full path copied',
      'toast.openRequested': 'Requested opening with the default program',
      'toast.revealRequested': 'Requested opening the containing folder',
      'toast.popoutOpened': 'Opened in a separate window',
      'error.unauthorized': 'This page is not allowed to perform this action',
      'error.clipboardFailed': 'Could not write to the system clipboard',
      'error.unsupported': 'This copy mode is not supported on this system',
      'error.fileUnavailable': 'The file could not be found',
      'error.desktopUnavailable': 'This Host has no desktop available to open files in external apps',
      'error.actionFailed': 'The action failed. Try again.',
      'error.popoutMissing': 'The preview pop-out plugin is not installed',
      'error.popoutShellMissing': 'The native preview shell is unavailable',
      'error.popoutTooMany': 'Too many preview windows are open; close some first',
      'error.popoutFailed': 'Could not open the separate window. Try again.',
      'error.invalid': 'The request was invalid',
      'error.network': 'Could not reach the local service',
      'error.timeout': 'The action timed out. Try again.',
      'error.unknown': 'The action failed. Try again.',
    }

    /** Stable failure codes the Host routes can answer with. */
    const FAILURE_COPY_KEY = {
      unauthorized: 'error.unauthorized',
      'clipboard-failed': 'error.clipboardFailed',
      'unsupported-platform': 'error.unsupported',
      'file-unavailable': 'error.fileUnavailable',
      'not-found': 'error.fileUnavailable',
      'desktop-unavailable': 'error.desktopUnavailable',
      'open-failed': 'error.actionFailed',
      'reveal-failed': 'error.actionFailed',
      'bad-request': 'error.invalid',
      'method-not-allowed': 'error.invalid',
      'native-shell-missing': 'error.popoutShellMissing',
      'too-many-windows': 'error.popoutTooMany',
      'http-400': 'error.popoutFailed',
      'http-404': 'error.popoutMissing',
      'http-405': 'error.popoutMissing',
      'http-500': 'error.popoutFailed',
      'http-503': 'error.popoutShellMissing',
      internal: 'error.unknown',
      unavailable: 'error.unknown',
      timeout: 'error.timeout',
      network: 'error.network',
    }

    /** Every visible or theme-aware rule this plugin adds. */
    const STYLES = [
      '.dshDeliverableMenu_anchor{display:none}',
      '.dshDeliverableMenu_menu{position:fixed;z-index:1100;box-sizing:border-box;width:' + MENU_WIDTH + 'px;',
      'padding:' + MENU_PADDING + 'px;display:flex;flex-direction:column;',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);',
      'font-family:var(--dsw-font-family,system-ui);animation:dshDeliverableMenu_fade .1s ease-out}',
      '.dshDeliverableMenu_item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;',
      'height:' + MENU_ITEM_HEIGHT + 'px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,6px);',
      'background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}',
      '.dshDeliverableMenu_item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshDeliverableMenu_item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshDeliverableMenu_item:disabled{opacity:.45;cursor:default}',
      '.dshDeliverableMenu_icon{display:inline-flex;flex:none;width:14px;height:14px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dshDeliverableMenu_item:disabled .dshDeliverableMenu_icon{color:inherit}',
      '.dshDeliverableMenu_icon svg{display:block;width:14px;height:14px}',
      '.dshDeliverableMenu_label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '@keyframes dshDeliverableMenu_fade{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.dshDeliverableMenu_menu{animation:none}}',
      '.dshDeliverableMenu_toastLayer{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1200;',
      'display:flex;justify-content:center;max-width:min(520px,calc(100vw - 32px));pointer-events:none}',
      '.dshDeliverableMenu_toast{display:flex;align-items:center;gap:8px;padding:10px 14px;max-width:100%;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:18px;overflow-wrap:anywhere;',
      'box-shadow:0 6px 20px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)}',
      '.dshDeliverableMenu_toastError{border-color:var(--dsw-alias-state-error-primary)}',
      '.dshDeliverableMenu_toastIcon{flex:none;font-weight:600}',
      '.dshDeliverableMenu_toastError .dshDeliverableMenu_toastIcon{color:var(--dsw-alias-state-error-primary)}',
      '.dshDeliverableMenu_toastText{min-width:0}',
    ].join('')

    /** One icon: a 14px stroke glyph matching the card controls' visual weight. */
    function glyph(paths) {
      return function Glyph() {
        return h('svg', {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        }, paths.map((d, index) => h('path', { key: index, d })))
      }
    }

    /** Open the file in the system's default program. */
    const OpenIcon = glyph([
      'M9.5 3.5H13v3.5',
      'M13 3.5 8 8.5',
      'M12.5 9.2v3.3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H7',
    ])
    /** Show the file in the system file manager. */
    const FolderIcon = glyph([
      'M2.5 5.5A1.5 1.5 0 0 1 4 4h2.6l1.5 1.75H12A1.5 1.5 0 0 1 13.5 7.25v4.25A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z',
      'M2.6 7.4h10.8',
    ])
    /** Put the file itself on the OS clipboard. */
    const CopyFileIcon = glyph([
      'M6 2.8h4.9c.6 0 1 .4 1 1v7.4c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1V3.8c0-.6.4-1 1-1z',
      'M3.2 5.4v6.9c0 .6.4 1 1 1h5.3',
    ])
    /** Put the file's absolute path on the OS clipboard. */
    const CopyPathIcon = glyph([
      'M6.7 9.3l2.6-2.6',
      'M7.5 5.4l1.1-1.1a2.2 2.2 0 0 1 3.1 3.1l-1.1 1.1',
      'M8.5 10.6l-1.1 1.1a2.2 2.2 0 0 1-3.1-3.1l1.1-1.1',
    ])
    /** Open the file in its own standalone preview window. */
    const PopoutIcon = glyph([
      'M8.5 2.5h5v5',
      'M13.5 2.5 8 8',
      'M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3',
    ])

    /** Failure carrying a stable code so visible copy can be localized. */
    class CopyRequestError extends Error {
      constructor(code, message) {
        super(message === undefined ? code : message)
        this.name = 'CopyRequestError'
        this.code = code
      }
    }

    /**
     * Ask one Host action route to perform one operation for the browser.
     * @param route - browser-relative route path.
     * @param payload - JSON request body.
     * @returns a promise settled after the Host acknowledged the operation.
     */
    async function requestHostAction(route, payload) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        throw new CopyRequestError('unsupported-platform')
      }
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : window.location.href
      const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(15000)
        : undefined
      let response
      try {
        response = await window.fetch(new URL(route, base), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          ...timeoutSignal === undefined ? {} : { signal: timeoutSignal },
        })
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        throw new CopyRequestError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', error instanceof Error ? error.message : undefined)
      }
      let body = null
      try {
        body = await response.json()
      } catch (error) {
        body = null
      }
      if (response.status === 401 || response.status === 403) throw new CopyRequestError('unauthorized')
      if (!response.ok || body === null || body.ok !== true) {
        const code = body !== null && typeof body.code === 'string' ? body.code : 'http-' + response.status
        throw new CopyRequestError(code, body !== null && typeof body.message === 'string' ? body.message : undefined)
      }
      return body
    }

    /**
     * Ask the Host route to copy one delivered file or its full path.
     * @param actionUrl - the card's authenticated `present.open` coordinates.
     * @param action - `copyFile` or `copyPath`.
     * @returns a promise settled after the Host acknowledged the copy.
     */
    function requestHostCopy(actionUrl, action) {
      return requestHostAction(COPY_ROUTE, { actionUrl, action })
    }

    /**
     * Ask the Host route to act on one conversation file link's path.
     * @param request - raw linked path, optional session workspace root, and action.
     * @returns a promise settled after the Host acknowledged the action.
     */
    function requestHostLinkAction(request) {
      return requestHostAction(LINK_ROUTE, request)
    }

    /** Encode one resource-address segment, keeping `:` literal for drive letters. */
    function encodeAddressSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    /** Encode a '/'-separated path for a `dsh-resource://file/` address. */
    function encodeAddressPath(path) {
      return path.split('/').map(encodeAddressSegment).join('/')
    }

    /** Whether a path is absolute in either Windows or POSIX spelling. */
    function isAbsoluteAddressPath(path) {
      return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('//')
    }

    /**
     * Build the file resource address of `path` as read through `sessionId`.
     *
     * Mirrors the shipped `fileAddressFor`: a workspace-relative path stays
     * relative, an absolute path inside the session workspace becomes relative,
     * and any other absolute path keeps its absolute spelling inside the
     * session address.
     * @param sessionId - Session owning the file.
     * @param cwd - Session workspace root, when known.
     * @param path - absolute or workspace-relative path in either separator spelling.
     * @returns the `dsh-resource://file/session/…` address.
     */
    function fileAddressFor(sessionId, cwd, path) {
      const normalized = String(path).replace(/\\/g, '/')
      const prefix = 'dsh-resource://file/session/' + encodeAddressSegment(sessionId) + '/'
      if (!isAbsoluteAddressPath(normalized)) return prefix + encodeAddressPath(normalized.replace(/^(?:\.\/)+/, ''))
      const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      if (root !== '' && normalized === root) return prefix
      if (root !== '' && normalized.startsWith(root + '/')) return prefix + encodeAddressPath(normalized.slice(root.length + 1))
      return prefix + encodeAddressPath(normalized)
    }

    /** Trailing path segment, used as the pop-out window title. */
    function basenameOf(path) {
      const value = String(path)
      const at = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
      return at === -1 ? value : value.slice(at + 1)
    }

    /**
     * Build the preview-popout request payload for one file path.
     * @param sessionId - Session that owns the file.
     * @param cwd - Session workspace root, when known.
     * @param path - absolute or linked path.
     * @returns `{sessionId, address, title}`, or null when it cannot be addressed.
     */
    function popoutTargetFor(sessionId, cwd, path) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const trimmed = typeof path === 'string' ? path.trim() : ''
      if (trimmed === '') return null
      return { sessionId, address: fileAddressFor(sessionId, cwd, trimmed), title: basenameOf(trimmed) }
    }

    /** Read the Session id out of one `present.open` action URL. */
    function sessionIdFromActionUrl(actionUrl) {
      if (typeof actionUrl !== 'string' || actionUrl === '') return undefined
      try {
        const id = new URL(actionUrl, 'http://localhost').searchParams.get('sessionId')
        return typeof id === 'string' && id !== '' ? id : undefined
      } catch (error) {
        return undefined
      }
    }

    /** The file path behind one delivered-file card, from its shipped preview button. */
    function cardFilePath(card) {
      if (card === null || card === undefined || typeof card.querySelector !== 'function') return null
      // The shipped card renders its full-card preview button as the card's own
      // direct child; scan direct children so action buttons inside the card can
      // never be mistaken for the file link.
      let button = null
      if (typeof card.children !== 'undefined' && card.children !== null) {
        for (const child of card.children) {
          if (child !== null && typeof child.tagName === 'string' && child.tagName === 'BUTTON' && typeof child.getAttribute === 'function') {
            button = child
            break
          }
        }
      }
      if (button === null) button = card.querySelector('button[title]')
      const raw = button === null ? '' : button.getAttribute('title')
      const path = typeof raw === 'string' ? raw.trim() : ''
      return path === '' ? null : path
    }

    /** Whether a value is a requestable file resource address. */
    function isFileResourceAddress(value) {
      return typeof value === 'string' && value.startsWith('dsh-resource://file/')
    }

    /** One row of the floating menu. */
    function MenuItem({ label, icon, disabled, title, onClick }) {
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dshDeliverableMenu_item',
        title: typeof title === 'string' && title !== '' ? title : label,
        disabled,
        onClick,
      },
        h('span', { className: 'dshDeliverableMenu_icon', 'aria-hidden': true }, h(icon)),
        h('span', { className: 'dshDeliverableMenu_label' }, label),
      )
    }

    /**
     * Place the fixed menu against an anchor rectangle inside the viewport.
     * Preference: below, then above, then beside, so the menu avoids covering
     * its anchor unless the viewport has room for neither.
     * @param rect - the anchor's viewport rectangle.
     * @param align - which anchor edge the menu's left edge follows.
     * @returns fixed top/left coordinates that keep the menu on screen.
     */
    function placeFloatingMenu(rect, align) {
      const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP)
      const maxTop = Math.max(VIEWPORT_GAP, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP)
      const clamp = (value, max) => Math.max(VIEWPORT_GAP, Math.min(max, value))
      const left = clamp(align === 'right' ? rect.right - MENU_WIDTH : rect.left, maxLeft)
      const below = rect.bottom + VIEWPORT_GAP
      if (below <= maxTop) return { top: below, left }
      const above = rect.top - MENU_HEIGHT - VIEWPORT_GAP
      if (above >= VIEWPORT_GAP) return { top: above, left }
      const sideTop = clamp(rect.top, maxTop)
      const rightSide = rect.right + VIEWPORT_GAP
      if (rightSide + MENU_WIDTH <= window.innerWidth - VIEWPORT_GAP) return { top: sideTop, left: rightSide }
      const leftSide = rect.left - MENU_WIDTH - VIEWPORT_GAP
      if (leftSide >= VIEWPORT_GAP) return { top: sideTop, left: leftSide }
      return { top: clamp(below, maxTop), left }
    }

    /**
     * The shared floating menu surface: one fixed panel portalled to the page
     * body, used by both delivered-file cards and conversation file links.
     * @param props - geometry, localized copy, disabled state, and menu callbacks.
     * @returns the portal element.
     */
    function MenuSurface({ menuRef, position, t, openDisabled, popoutDisabled, onSelect, onPointerEnter, onPointerLeave, onKeyDown }) {
      return ReactDOM.createPortal(h('div', {
        ref: menuRef,
        role: 'menu',
        'aria-label': t('menu.label'),
        className: 'dshDeliverableMenu_menu',
        style: { top: position.top + 'px', left: position.left + 'px' },
        onPointerEnter,
        onPointerLeave,
        onKeyDown,
      },
        h(MenuItem, {
          label: t('menu.open'),
          icon: OpenIcon,
          disabled: openDisabled,
          title: openDisabled ? t('menu.desktopUnavailable') : undefined,
          onClick: () => onSelect('open'),
        }),
        h(MenuItem, {
          label: t('menu.reveal'),
          icon: FolderIcon,
          disabled: openDisabled,
          title: openDisabled ? t('menu.desktopUnavailable') : undefined,
          onClick: () => onSelect('reveal'),
        }),
        h(MenuItem, {
          label: t('menu.popout'),
          icon: PopoutIcon,
          disabled: popoutDisabled,
          title: popoutDisabled ? t('menu.popoutUnavailable') : undefined,
          onClick: () => onSelect('popout'),
        }),
        h(MenuItem, {
          label: t('menu.copyFile'),
          icon: CopyFileIcon,
          disabled: false,
          onClick: () => onSelect('copyFile'),
        }),
        h(MenuItem, {
          label: t('menu.copyPath'),
          icon: CopyPathIcon,
          disabled: false,
          onClick: () => onSelect('copyPath'),
        }),
      ), document.body)
    }

    /**
     * Whether a rendered link title plausibly names a file path rather than a
     * tooltip sentence. Used only as a fallback when the renderer's class hash
     * changes between builds.
     * @param value - one `title` attribute value.
     * @returns whether it contains a path separator or a file extension.
     */
    function looksLikePath(value) {
      return /[/\\]/.test(value) || /\.[A-Za-z0-9]{1,10}$/.test(value)
    }

    /**
     * Whether one element carries the markdown renderer's file-reference class.
     * @param classList - the element's `classList`.
     * @returns whether any class name starts with the stable renderer prefix.
     */
    function hasFileMentionClass(classList) {
      if (classList === null || typeof classList !== 'object' || typeof classList.length !== 'number') return false
      for (let index = 0; index < classList.length; index += 1) {
        const name = classList[index]
        if (typeof name === 'string' && name.startsWith(FILE_MENTION_CLASS_PREFIX)) return true
      }
      return false
    }

    /**
     * Resolve a hovered/focused node to one conversation file link.
     *
     * The shipped markdown renderer draws both `[name](path)` links and inline
     * file references as buttons carrying the base path in `title`. Composer
     * reference chips reuse similar classes but are not conversation links, and
     * delivered-file cards have their own hover menu; both are excluded.
     * @param node - the pointer or focus target.
     * @returns the link element and its linked path, or null.
     */
    function findFileLink(node) {
      if (node === null || typeof node !== 'object' || typeof node.closest !== 'function') return null
      const button = node.closest('button')
      if (button === null || typeof button.closest !== 'function') return null
      if (button.closest(CARD_SELECTOR) !== null || button.closest('[data-ref-chip]') !== null) return null
      const raw = button.getAttribute('title')
      const path = typeof raw === 'string' ? raw.trim() : ''
      if (path === '') return null
      const inMarkdown = button.closest(MARKDOWN_ANCESTOR_SELECTOR) !== null
      const marked = hasFileMentionClass(button.classList)
      if (!inMarkdown || !(marked || looksLikePath(path))) return null
      return { element: button, path }
    }

    /**
     * The delivered-file card around one action cell.
     *
     * The shipped deliverables plugin renders this cell inside a card carrying
     * `data-presented-file`. That attribute is the intended hover scope; when it
     * is missing (a future rename) fall back to the three structural ancestors
     * the slot cell always has: actions row → file body → file card.
     * @param anchor - this component's own hidden cell element.
     * @returns the card element, or null when the slot has no such ancestor yet.
     */
    function resolveCard(anchor) {
      if (anchor !== null && typeof anchor.closest === 'function') {
        const matched = anchor.closest(CARD_SELECTOR)
        if (matched !== null) return matched
      }
      let element = anchor
      for (let depth = 0; depth < 3 && element !== null; depth += 1) element = element.parentElement
      if (element !== null && typeof element.getBoundingClientRect === 'function') {
        console.warn('[deliverable-hover-menu] delivered-file card attribute missing; using structural fallback')
        return element
      }
      return null
    }

    /**
     * Focus one enabled menu row.
     * @param menu - the menu element, when open.
     * @param index - row position among enabled rows.
     * @returns whether a row was focused.
     */
    function focusMenuItem(menu, index) {
      if (menu === null) return false
      const items = menu.querySelectorAll('button:not([disabled])')
      const item = items[index]
      if (item === undefined) return false
      item.focus()
      return true
    }

    /**
     * One delivered-file card's hover menu.
     *
     * The visible control is a frame-wide portal. The card itself stays the
     * click target for the shipped Sidebar preview: this component only listens
     * to pointer/focus/keyboard events on the card, never covers it.
     *
     * @param props - the slot owner's file-action inputs plus localized copy.
     * @returns the invisible anchor and, while hovered, the floating menu.
     */
    function DeliverableHoverMenu(props) {
      const { actionUrl, available, pending, onAction, t, copyDeliverable, menuCoordinator, openPopout, warmPopout } = props
      const anchorRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const latest = React.useRef(props)
      React.useEffect(() => {
        latest.current = props
      })
      const timers = React.useRef({ open: 0, close: 0 })
      const [open, setOpen] = React.useState(false)
      const openRef = React.useRef(false)
      React.useEffect(() => {
        openRef.current = open
      }, [open])
      const [position, setPosition] = React.useState(null)
      const [popoutTarget, setPopoutTarget] = React.useState(null)

      const clearTimer = React.useCallback((name) => {
        const id = timers.current[name]
        if (id !== 0) {
          window.clearTimeout(id)
          timers.current[name] = 0
        }
      }, [])

      /**
       * Place the fixed menu against the card's current viewport rectangle.
       * @returns fixed top/left coordinates, or null when the card has no box.
       */
      const measure = React.useCallback(() => {
        const card = cardRef.current
        if (card === null || typeof window === 'undefined') return null
        const rect = card.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return null
        return placeFloatingMenu(rect, 'right')
      }, [])

      const closeNow = React.useCallback(() => {
        clearTimer('open')
        clearTimer('close')
        if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.deactivate === 'function') {
          menuCoordinator.deactivate(closeNow)
        }
        setOpen(false)
      }, [clearTimer, menuCoordinator])

      const openNow = React.useCallback(() => {
        // Re-entering the same card while its menu is already open keeps the
        // current menu; re-measuring here would also repeat the warm request.
        if (openRef.current === true) return
        const next = measure()
        if (next === null) return
        clearTimer('close')
        clearTimer('open')
        if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.activate === 'function') {
          menuCoordinator.activate(closeNow)
        }
        const current = latest.current
        const path = cardFilePath(cardRef.current)
        const sessionId = typeof current.sessionId === 'string' && current.sessionId !== ''
          ? current.sessionId
          : sessionIdFromActionUrl(current.actionUrl)
        const cwd = typeof current.sessionCwd === 'function' ? current.sessionCwd(sessionId) : undefined
        const target = path === null ? null : popoutTargetFor(sessionId, cwd, path)
        setPopoutTarget(target)
        if (target !== null && typeof current.warmPopout === 'function') current.warmPopout(target)
        setPosition({ top: next.top, left: next.left })
        setOpen(true)
      }, [clearTimer, measure, menuCoordinator, closeNow])

      const scheduleOpen = React.useCallback(() => {
        clearTimer('close')
        clearTimer('open')
        timers.current.open = window.setTimeout(() => {
          timers.current.open = 0
          openNow()
        }, OPEN_DELAY_MS)
      }, [clearTimer, openNow])

      const scheduleClose = React.useCallback(() => {
        clearTimer('open')
        clearTimer('close')
        timers.current.close = window.setTimeout(() => {
          timers.current.close = 0
          closeNow()
        }, CLOSE_DELAY_MS)
      }, [clearTimer, closeNow])

      React.useEffect(() => {
        const anchor = anchorRef.current
        if (anchor === null || typeof window === 'undefined') return undefined
        const card = resolveCard(anchor)
        if (card === null) return undefined
        cardRef.current = card
        /** Hover intent: a mouse or pen entering the card asks for the menu. */
        const onPointerEnter = (event) => {
          if (event.pointerType === 'touch') return
          scheduleOpen()
        }
        /** Leaving the card starts the grace period that moving onto the menu cancels. */
        const onPointerLeave = () => {
          scheduleClose()
        }
        /** Any press on the card is the shipped preview gesture; never keep a menu up through it. */
        const onPointerDown = () => {
          closeNow()
        }
        /** Keyboard focus on the card's own preview button also reveals the menu. */
        const onFocusIn = (event) => {
          const target = event.target
          if (target !== null && typeof target === 'object' && typeof target.matches === 'function') {
            let keyboard = false
            try {
              keyboard = target.matches(':focus-visible')
            } catch (error) {
              keyboard = false
            }
            if (keyboard) {
              openNow()
              return
            }
          }
          closeNow()
        }
        const onFocusOut = (event) => {
          const next = event.relatedTarget
          if (next !== null && next !== undefined) {
            if (card.contains(next) || (menuRef.current !== null && menuRef.current.contains(next))) return
          }
          closeNow()
        }
        /** Keyboard path: with the menu open, ArrowDown moves focus into its first row. */
        const onCardKeyDown = (event) => {
          if (event.key !== 'ArrowDown' || openRef.current !== true) return
          if (focusMenuItem(menuRef.current, 0)) event.preventDefault()
        }
        card.addEventListener('pointerenter', onPointerEnter)
        card.addEventListener('pointerleave', onPointerLeave)
        card.addEventListener('pointerdown', onPointerDown)
        card.addEventListener('focusin', onFocusIn)
        card.addEventListener('focusout', onFocusOut)
        card.addEventListener('keydown', onCardKeyDown)
        return () => {
          clearTimer('open')
          clearTimer('close')
          if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.deactivate === 'function') {
            menuCoordinator.deactivate(closeNow)
          }
          card.removeEventListener('pointerenter', onPointerEnter)
          card.removeEventListener('pointerleave', onPointerLeave)
          card.removeEventListener('pointerdown', onPointerDown)
          card.removeEventListener('focusin', onFocusIn)
          card.removeEventListener('focusout', onFocusOut)
          card.removeEventListener('keydown', onCardKeyDown)
          cardRef.current = null
        }
      }, [clearTimer, closeNow, menuCoordinator, openNow, scheduleClose, scheduleOpen])

      React.useEffect(() => {
        if (!open || typeof window === 'undefined') return undefined
        /** A scrolling transcript moves the card away; the fixed menu would detach, so dismiss it. */
        const onScroll = (event) => {
          const target = event.target
          if (target !== null && target !== undefined && menuRef.current !== null
            && typeof menuRef.current.contains === 'function' && menuRef.current.contains(target)) return
          closeNow()
        }
        const onResize = () => {
          closeNow()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') closeNow()
        }
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onResize)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [open, closeNow])

      /** Cancel the close grace period while the pointer is over the menu itself. */
      const onMenuPointerEnter = React.useCallback(() => {
        clearTimer('close')
      }, [clearTimer])

      /** Arrow keys move between rows; Escape dismisses the menu. */
      const onMenuKeyDown = React.useCallback((event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeNow()
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const menu = menuRef.current
        if (menu === null) return
        const items = Array.from(menu.querySelectorAll('button:not([disabled])'))
        if (items.length === 0) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement)
        const next = event.key === 'ArrowDown'
          ? Math.min(items.length - 1, current + 1)
          : Math.max(0, current - 1)
        items[next].focus()
      }, [closeNow])

      /** Run one menu action against the latest slot inputs, then dismiss the menu. */
      const activate = React.useCallback((kind) => {
        const current = latest.current
        closeNow()
        if (kind === 'open' || kind === 'reveal') {
          if (!current.available || current.pending) return
          try {
            Promise.resolve(current.onAction(kind)).catch((error) => {
              console.warn('[deliverable-hover-menu] open gesture rejected:', error)
            })
          } catch (error) {
            console.warn('[deliverable-hover-menu] open gesture failed:', error)
          }
          return
        }
        if (kind === 'popout') {
          if (popoutTarget !== null && typeof openPopout === 'function') {
            Promise.resolve(openPopout(popoutTarget)).catch((error) => {
              console.warn('[deliverable-hover-menu] pop-out gesture rejected:', error)
            })
          }
          return
        }
        Promise.resolve(copyDeliverable(current.actionUrl, kind)).catch((error) => {
          console.warn('[deliverable-hover-menu] copy gesture rejected:', error)
        })
      }, [closeNow, copyDeliverable, openPopout, popoutTarget])

      const openDisabled = !available || pending === true
      const menu = open && position !== null && typeof document !== 'undefined'
        ? h(MenuSurface, {
          menuRef,
          position,
          t,
          openDisabled,
          popoutDisabled: popoutTarget === null,
          onSelect: activate,
          onPointerEnter: onMenuPointerEnter,
          onPointerLeave: scheduleClose,
          onKeyDown: onMenuKeyDown,
        })
        : null

      return h(React.Fragment, null,
        h('span', {
          ref: anchorRef,
          className: 'dshDeliverableMenu_anchor',
          'aria-hidden': true,
        }),
        menu,
      )
    }

    /**
     * Session-wide hover menu for file links rendered by the markdown renderer.
     *
     * Mounted once per Session in `conversation.composer.dock`. It renders no
     * content while closed and only observes the document for a pointer/focus
     * landing on a rendered file link, then portals the shared menu surface to
     * the page body next to that link. The link's own click keeps opening the
     * Sidebar preview.
     *
     * @param props - session identity, selector hooks, and injected actions.
     * @returns the floating menu while a link is hovered, otherwise nothing.
     */
    function FileLinkHoverMenu(props) {
      const { sessionId, useSessions, t, menuCoordinator, performLinkAction, openPopout, warmPopout, sessionCwd } = props
      const cwd = useSessions((state) => {
        if (state === null || typeof state !== 'object' || state.byId === undefined || state.byId === null) return undefined
        const session = state.byId[sessionId]
        return session === null || session === undefined ? undefined : session.cwd
      })
      const cwdRef = React.useRef(cwd)
      React.useEffect(() => {
        cwdRef.current = cwd
      }, [cwd])
      const menuRef = React.useRef(null)
      const openInfoRef = React.useRef(null)
      const hoveredRef = React.useRef(null)
      const timers = React.useRef({ open: 0, close: 0 })
      const [open, setOpen] = React.useState(false)
      const [position, setPosition] = React.useState(null)
      const [popoutTarget, setPopoutTarget] = React.useState(null)
      const openRef = React.useRef(false)
      React.useEffect(() => {
        openRef.current = open
      }, [open])

      const clearTimer = React.useCallback((name) => {
        const id = timers.current[name]
        if (id !== 0) {
          window.clearTimeout(id)
          timers.current[name] = 0
        }
      }, [])

      const closeNow = React.useCallback(() => {
        clearTimer('open')
        clearTimer('close')
        if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.deactivate === 'function') {
          menuCoordinator.deactivate(closeNow)
        }
        openInfoRef.current = null
        setOpen(false)
      }, [clearTimer, menuCoordinator])

      const openNow = React.useCallback((link) => {
        if (link === null || link.element === null || typeof link.element.getBoundingClientRect !== 'function') return
        const rect = link.element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return
        clearTimer('open')
        clearTimer('close')
        if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.activate === 'function') {
          menuCoordinator.activate(closeNow)
        }
        hoveredRef.current = link.element
        openInfoRef.current = { element: link.element, path: link.path }
        const cwd = typeof cwdRef.current === 'string' && cwdRef.current !== ''
          ? cwdRef.current
          : (typeof sessionCwd === 'function' ? sessionCwd(sessionId) : undefined)
        const target = popoutTargetFor(sessionId, cwd, link.path)
        setPopoutTarget(target)
        if (target !== null && typeof warmPopout === 'function') warmPopout(target)
        setPosition(placeFloatingMenu(rect, 'left'))
        setOpen(true)
      }, [clearTimer, closeNow, menuCoordinator, sessionCwd, sessionId, warmPopout])

      const scheduleOpen = React.useCallback((link) => {
        clearTimer('open')
        clearTimer('close')
        timers.current.open = window.setTimeout(() => {
          timers.current.open = 0
          openNow(link)
        }, OPEN_DELAY_MS)
      }, [clearTimer, openNow])

      const scheduleClose = React.useCallback(() => {
        clearTimer('open')
        clearTimer('close')
        timers.current.close = window.setTimeout(() => {
          timers.current.close = 0
          closeNow()
        }, CLOSE_DELAY_MS)
      }, [clearTimer, closeNow])

      /** Cancel the close grace period while the pointer is over the menu itself. */
      const onMenuPointerEnter = React.useCallback(() => {
        clearTimer('close')
      }, [clearTimer])

      /** Arrow keys move between rows; Escape dismisses the menu. */
      const onMenuKeyDown = React.useCallback((event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeNow()
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const menu = menuRef.current
        if (menu === null) return
        const items = Array.from(menu.querySelectorAll('button:not([disabled])'))
        if (items.length === 0) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement)
        const next = event.key === 'ArrowDown'
          ? Math.min(items.length - 1, current + 1)
          : Math.max(0, current - 1)
        items[next].focus()
      }, [closeNow])

      /** Run one menu action against the link captured when the menu opened. */
      const runLinkAction = React.useCallback((kind) => {
        const info = openInfoRef.current
        const sessionCwd = cwdRef.current
        closeNow()
        if (kind === 'popout') {
          if (popoutTarget !== null && typeof openPopout === 'function') {
            Promise.resolve(openPopout(popoutTarget)).catch((error) => {
              console.warn('[deliverable-hover-menu] pop-out gesture rejected:', error)
            })
          }
          return
        }
        if (info === null) return
        Promise.resolve(performLinkAction({
          path: info.path,
          cwd: typeof sessionCwd === 'string' && sessionCwd !== '' ? sessionCwd : undefined,
          action: kind,
        })).catch((error) => {
          console.warn('[deliverable-hover-menu] link action rejected:', error)
        })
      }, [closeNow, openPopout, performLinkAction, popoutTarget])

      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const insideMenu = (node) => {
          const menu = menuRef.current
          return menu !== null && node !== null && node !== undefined
            && typeof menu.contains === 'function' && menu.contains(node)
        }
        const onPointerOver = (event) => {
          if (event.pointerType === 'touch') return
          if (insideMenu(event.target)) {
            clearTimer('close')
            return
          }
          const link = findFileLink(event.target)
          if (link === null) {
            hoveredRef.current = null
            scheduleClose()
            return
          }
          if (hoveredRef.current === link.element) {
            clearTimer('close')
            return
          }
          hoveredRef.current = link.element
          scheduleOpen(link)
        }
        const onPointerOut = (event) => {
          if (event.relatedTarget !== null && event.relatedTarget !== undefined) return
          if (insideMenu(event.target)) return
          hoveredRef.current = null
          scheduleClose()
        }
        const onPointerDown = (event) => {
          if (insideMenu(event.target)) return
          closeNow()
        }
        const onFocusIn = (event) => {
          const link = findFileLink(event.target)
          if (link === null) return
          const target = event.target
          let keyboard = false
          try {
            keyboard = typeof target.matches === 'function' && target.matches(':focus-visible')
          } catch (error) {
            keyboard = false
          }
          if (!keyboard) return
          hoveredRef.current = link.element
          openNow(link)
        }
        const onFocusOut = (event) => {
          const next = event.relatedTarget
          if (next !== null && next !== undefined) {
            if (insideMenu(next) || findFileLink(next) !== null) return
          }
          closeNow()
        }
        const onKeyDown = (event) => {
          if (openRef.current !== true) return
          if (event.key === 'Escape') {
            closeNow()
            return
          }
          const info = openInfoRef.current
          if (event.key === 'ArrowDown' && info !== null && event.target === info.element) {
            if (focusMenuItem(menuRef.current, 0)) event.preventDefault()
          }
        }
        document.addEventListener('pointerover', onPointerOver, true)
        document.addEventListener('pointerout', onPointerOut, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('focusin', onFocusIn, true)
        document.addEventListener('focusout', onFocusOut, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          clearTimer('open')
          clearTimer('close')
          if (menuCoordinator !== null && typeof menuCoordinator === 'object' && typeof menuCoordinator.deactivate === 'function') {
            menuCoordinator.deactivate(closeNow)
          }
          document.removeEventListener('pointerover', onPointerOver, true)
          document.removeEventListener('pointerout', onPointerOut, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('focusin', onFocusIn, true)
          document.removeEventListener('focusout', onFocusOut, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [clearTimer, closeNow, menuCoordinator, openNow, scheduleClose, scheduleOpen])

      React.useEffect(() => {
        if (!open || typeof window === 'undefined') return undefined
        /** A scrolling transcript moves the link away; the fixed menu would detach, so dismiss it. */
        const onScroll = (event) => {
          const menu = menuRef.current
          if (menu !== null && event.target instanceof Node && typeof menu.contains === 'function' && menu.contains(event.target)) return
          closeNow()
        }
        const onResize = () => {
          closeNow()
        }
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onResize)
        return () => {
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onResize)
        }
      }, [open, closeNow])

      return open && position !== null && typeof document !== 'undefined'
        ? h(MenuSurface, {
          menuRef,
          position,
          t,
          openDisabled: false,
          popoutDisabled: popoutTarget === null,
          onSelect: runLinkAction,
          onPointerEnter: onMenuPointerEnter,
          onPointerLeave: scheduleClose,
          onKeyDown: onMenuKeyDown,
        })
        : null
    }

    /** Frame-wide, self-dismissing notice for the last copy outcome. */
    function DeliverableMenuToast({ useToast, dismissToast }) {
      const notice = useToast((value) => value)
      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => {
          dismissToast(notice.seq)
        }, TOAST_VISIBLE_MS)
        return () => {
          window.clearTimeout(timer)
        }
      }, [notice, dismissToast])
      if (notice === null) return null
      const failed = notice.kind === 'error'
      return h('div', { className: 'dshDeliverableMenu_toastLayer' },
        h('div', {
          className: failed
            ? 'dshDeliverableMenu_toast dshDeliverableMenu_toastError'
            : 'dshDeliverableMenu_toast',
          role: failed ? 'alert' : 'status',
        },
          h('span', { className: 'dshDeliverableMenu_toastIcon', 'aria-hidden': true }, failed ? '!' : '\u2713'),
          h('span', { className: 'dshDeliverableMenu_toastText' }, notice.text),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
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
          return () => {
            tag.remove()
          }
        }, 'deliverable-hover-menu: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deliverable-hover-menu: dictionaries')

        const t = ctx.locale.bind(NS)
        /** One floating menu at a time across every delivered-file card. */
        const menuCoordinator = {
          active: null,
          activate(close) {
            const previous = this.active
            this.active = close
            if (previous !== null && previous !== close) {
              try {
                previous()
              } catch (error) {
                console.warn('[deliverable-hover-menu] closing the previous menu failed:', error)
              }
            }
          },
          deactivate(close) {
            if (this.active === close) this.active = null
          },
          close() {
            const active = this.active
            this.active = null
            if (active !== null) {
              try {
                active()
              } catch (error) {
                console.warn('[deliverable-hover-menu] closing the menu failed:', error)
              }
            }
          },
        }
        let notice = null
        let noticeSeq = 0
        const listeners = new Set()
        const publish = () => {
          for (const listener of listeners) listener()
        }
        const showToast = (kind, text) => {
          notice = { kind, text, seq: ++noticeSeq }
          publish()
        }
        const dismissToast = (seq) => {
          if (notice !== null && notice.seq === seq) {
            notice = null
            publish()
          }
        }
        const noticeSource = {
          getSnapshot: () => notice,
          subscribe: (listener) => {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          },
        }

        /** Localize one Host action failure without surfacing a raw Host message. */
        const describeActionFailure = (error) => {
          const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
          const key = FAILURE_COPY_KEY[code]
          return t(typeof key === 'string' ? key : 'error.unknown')
        }

        /** Copy the file or its path through the Host route, then announce the outcome. */
        const copyDeliverable = (actionUrl, action) => {
          if (typeof actionUrl !== 'string' || actionUrl === '') {
            showToast('error', t('error.invalid'))
            return Promise.resolve()
          }
          return requestHostCopy(actionUrl, action).then(() => {
            showToast('success', action === 'copyFile' ? t('toast.fileCopied') : t('toast.pathCopied'))
          }, (error) => {
            showToast('error', describeActionFailure(error))
          })
        }

        /** Open, reveal, or copy one conversation file link through the Host. */
        const performLinkAction = (request) => {
          const path = request !== null && typeof request === 'object' && typeof request.path === 'string'
            ? request.path.trim()
            : ''
          if (path === '') {
            showToast('error', t('error.invalid'))
            return Promise.resolve()
          }
          const cwd = request !== null && typeof request === 'object' && typeof request.cwd === 'string' && request.cwd !== ''
            ? request.cwd
            : undefined
          const action = request !== null && typeof request === 'object' ? request.action : undefined
          return requestHostLinkAction({
            path,
            ...cwd === undefined ? {} : { cwd },
            action,
          }).then(() => {
            if (action === 'copyFile') showToast('success', t('toast.fileCopied'))
            else if (action === 'copyPath') showToast('success', t('toast.pathCopied'))
            else if (action === 'reveal') showToast('success', t('toast.revealRequested'))
            else showToast('success', t('toast.openRequested'))
          }, (error) => {
            showToast('error', describeActionFailure(error))
          })
        }

        /** The current Session workspace root, when the session store knows it. */
        const sessionCwd = (sessionId) => {
          try {
            const snapshot = ctx.sessions.list.getSnapshot()
            const row = snapshot !== null && typeof snapshot === 'object' && snapshot.byId !== undefined && sessionId !== undefined
              ? snapshot.byId[sessionId]
              : undefined
            return row !== null && row !== undefined && typeof row.cwd === 'string' && row.cwd !== '' ? row.cwd : undefined
          } catch (error) {
            return undefined
          }
        }

        /** Open one file in the preview-popout plugin's native standalone window. */
        const openPopout = (target) => {
          const sessionId = target !== null && typeof target === 'object' ? target.sessionId : undefined
          const address = target !== null && typeof target === 'object' ? target.address : undefined
          if (typeof sessionId !== 'string' || sessionId === '' || !isFileResourceAddress(address)) {
            showToast('error', t('error.invalid'))
            return Promise.resolve()
          }
          return requestHostAction(POPOUT_NATIVE_ROUTE, {
            sessionId,
            address,
            title: typeof target.title === 'string' ? target.title : '',
          }).then(() => {
            showToast('success', t('toast.popoutOpened'))
          }, (error) => {
            showToast('error', describeActionFailure(error))
          })
        }

        /** Best-effort pre-boot of the pop-out window while a menu is open. */
        const warmPopout = (target) => {
          if (target === null || typeof target !== 'object') return
          if (typeof target.sessionId !== 'string' || target.sessionId === '' || !isFileResourceAddress(target.address)) return
          requestHostAction(POPOUT_WARM_ROUTE, {
            sessionId: target.sessionId,
            address: target.address,
            title: typeof target.title === 'string' ? target.title : '',
          }).catch(() => {})
        }

        /** A replaced connection may reach a Host that no longer serves these files. */
        ctx.on('connection/reset', () => {
          menuCoordinator.close()
          if (notice !== null) {
            notice = null
            publish()
          }
        })

        ctx.slots.inject('deliverables.file.actions', () => ctx.slots.register({
          name: 'deliverables.file.actions',
          id: 'deliverable-hover-menu',
          order: 40,
          locale: NS,
          inject: () => ({ copyDeliverable, menuCoordinator, openPopout, warmPopout, sessionCwd }),
        }, DeliverableHoverMenu))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'deliverable-hover-menu.toast',
          order: 1002,
          inject: () => ({
            hooks: { toast: noticeSource },
            dismissToast,
          }),
        }, DeliverableMenuToast))

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'deliverable-hover-menu.link',
          order: 100,
          locale: NS,
          inject: () => ({ performLinkAction, menuCoordinator, openPopout, warmPopout, sessionCwd }),
        }, FileLinkHoverMenu))
      },
    }
  },
})
