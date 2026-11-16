window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-session-delete-v3',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sessionDeleteQueue'
    const PACKAGE_ID = '@local/dsh-plugin-session-delete-v3'
    const ENDPOINT = 'dsh-session-delete-v3'
    const PENDING_URL = ENDPOINT + '/pending'
    const DELETE_URL = ENDPOINT + '/delete'
    const CANCEL_URL = ENDPOINT + '/cancel'
    const CACHE_KEY = 'dsh.sessionDelete.pending.v3'
    const STYLE_TAG_ID = PACKAGE_ID + '/session-delete.css'

    /** Visible copy owned by this plugin. */
    const zh = {
      'action.delete': '删除会话',
      'action.deleting': '正在加入删除队列',
      'action.cancelDelete': '取消删除',
      'action.canceling': '正在取消删除',
      'confirm.delete': '将会话“{title}”加入删除队列？\n\n该会话会立即标记为待删除（红色删除线），重启 DeepSeek Harness 后会永久清理本地记录；重启前可以点击“取消删除”。',
      'untitled': '未命名',
      'pendingMark': '待删除：重启 DeepSeek Harness 后自动清理，重启前可取消',
      'toast.queued': '已加入删除队列；重启后自动清理，重启前可取消',
      'toast.canceled': '已取消删除',
      'toast.failed': '操作失败：{message}',
      'error.unavailable': '删除功能暂时不可用，请重启应用后重试',
      'error.unauthorized': '当前页面无权修改删除队列',
      'error.badRequest': '请求无效',
      'error.network': '无法连接到本地服务',
      'error.unknown': '未知错误',
    }

    const en = {
      'action.delete': 'Delete session',
      'action.deleting': 'Adding to delete queue',
      'action.cancelDelete': 'Cancel delete',
      'action.canceling': 'Canceling delete',
      'confirm.delete': 'Add session “{title}” to the delete queue?\n\nIt is marked as pending (red strikethrough) and its local record is permanently removed on the next DeepSeek Harness start. You can cancel before restarting.',
      'untitled': 'Untitled',
      'pendingMark': 'Pending deletion: removed on the next DeepSeek Harness start; cancel any time before that',
      'toast.queued': 'Added to the delete queue; cleanup runs on the next start, cancel before restarting',
      'toast.canceled': 'Deletion canceled',
      'toast.failed': 'Operation failed: {message}',
      'error.unavailable': 'Delete is unavailable right now. Restart the app and try again.',
      'error.unauthorized': 'This page may not modify the delete queue.',
      'error.badRequest': 'The request was invalid.',
      'error.network': 'Could not reach the local service.',
      'error.unknown': 'Unknown error',
    }

    const STYLES = [
      '.dshSessionDelete_iconButton{border-radius:var(--dsw-radius-xs,4px);cursor:pointer;width:16px;height:16px;',
      'color:var(--dsw-alias-label-tertiary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;',
      'padding:0;display:inline-flex}',
      '.dshSessionDelete_iconButton:hover{color:var(--dsw-alias-label-primary)}',
      '.dshSessionDelete_iconButton:disabled{opacity:.4;cursor:default}',
      '.dshSessionDelete_iconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshSessionDelete_pendingButton{color:var(--dsw-alias-state-error-primary)}',
      '.dshSessionDelete_pendingButton:hover{color:var(--dsw-alias-state-error-primary)}',
      '.dshSessionDelete_pendingMark{display:inline-flex;align-items:center;justify-content:center;flex:none;',
      'margin-inline-start:4px;color:var(--dsw-alias-state-error-primary)}',
      '.dshSessionDelete_toastLayer{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;',
      'display:flex;justify-content:center;max-width:min(680px,calc(100vw - 32px));pointer-events:none}',
      '.dshSessionDelete_toast{display:flex;align-items:center;gap:8px;padding:10px 14px;max-width:100%;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:18px;overflow-wrap:anywhere}',
      '.dshSessionDelete_toastError{border-color:var(--dsw-alias-state-error-primary)}',
      '.dshSessionDelete_toastIcon{flex:none;font-weight:600}',
      '.dshSessionDelete_toastError .dshSessionDelete_toastIcon{color:var(--dsw-alias-state-error-primary)}',
      '.dshSessionDelete_toastText{min-width:0}',
      // Pending-deletion rows: red strikethrough on the session title, while
      // the title keeps its normal text color. The row carries
      // data-row-key="session:<id>" and the marker lives inside it, so :has()
      // can target the title without touching other rows.
      '[data-row-key^="session:"]:has([data-dsh-session-delete-pending]) [class*="_title"]{',
      'text-decoration:line-through!important;',
      'text-decoration-color:var(--dsw-alias-state-error-primary)!important}',
    ].join('')

    /** Error carrying a stable code so visible copy can be localized. */
    class DeleteRequestError extends Error {
      constructor(code, message) {
        super(message === undefined ? code : message)
        this.name = 'DeleteRequestError'
        this.code = code
      }
    }

    /** Base URL for this app page (same-origin, mount aware). */
    function endpointUrl(path) {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : window.location.href
      return new URL(path, base)
    }

    /** POST one small JSON command to the Host queue routes. */
    async function postJson(path, body) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        throw new DeleteRequestError('delete-unavailable')
      }
      let response
      try {
        response = await window.fetch(endpointUrl(path), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (error) {
        throw new DeleteRequestError('network', error instanceof Error ? error.message : undefined)
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (response.status === 401 || response.status === 403) throw new DeleteRequestError('unauthorized')
      if (!response.ok || payload === null || payload.ok !== true) {
        const code = payload !== null && typeof payload.code === 'string' ? payload.code : 'http-' + response.status
        const message = payload !== null && typeof payload.message === 'string' ? payload.message : undefined
        throw new DeleteRequestError(code, message)
      }
      return payload
    }

    /** Read the pending queue from the Host (best effort). */
    async function fetchPendingIds() {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null
      try {
        const response = await window.fetch(endpointUrl(PENDING_URL), {
          method: 'GET',
          credentials: 'same-origin',
        })
        if (!response.ok) return null
        const payload = await response.json()
        if (payload !== null && typeof payload === 'object' && payload.ok === true && Array.isArray(payload.ids)) {
          return payload.ids.filter((id) => typeof id === 'string' && id !== '')
        }
        return null
      } catch (error) {
        return null
      }
    }

    /** Localize one failure without leaking a raw English Host message. */
    function describeError(t, error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      const known = {
        'queue-failed': 'error.unavailable',
        'persistence-unavailable': 'error.unavailable',
        'root-unavailable': 'error.unavailable',
        'root-unreadable': 'error.unavailable',
        'stat-failed': 'error.unavailable',
        'delete-unavailable': 'error.unavailable',
        'unauthorized': 'error.unauthorized',
        'bad-request': 'error.badRequest',
        'network': 'error.network',
      }
      if (typeof known[code] === 'string') return t(known[code])
      return t('error.unknown')
    }

    /** Trash glyph (delete action). */
    function TrashIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M2.75 4.25h10.5' }),
        h('path', { d: 'M6 4.25V2.9h4v1.35' }),
        h('path', { d: 'M4.1 4.25l.55 8.2a1.1 1.1 0 0 0 1.1 1.02h4.5a1.1 1.1 0 0 0 1.1-1.02l.55-8.2' }),
        h('path', { d: 'M6.6 7.1v3.9M9.4 7.1v3.9' }),
      )
    }

    /** Counter-clockwise arrow glyph (cancel delete). */
    function UndoIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M3.2 5.1A5.2 5.2 0 1 1 2.8 9.6' }),
        h('path', { d: 'M3.2 2.4v2.7h2.7' }),
      )
    }

    /** Small pending marker glyph (clock). */
    function PendingIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        h('circle', { cx: 8, cy: 8, r: 5.6 }),
        h('path', { d: 'M8 4.9v3.4l2.3 1.4' }),
      )
    }

    /**
     * Hover button of one Session row: delete when normal, cancel when the
     * Session is already queued for deletion.
     * @param props - owner row share, both callbacks, pending hook, locale seat.
     * @returns one icon button.
     */
    function SessionDeleteRowButton({ sessionId, displayTitle, requestDelete, requestCancel, usePendingDelete, t }) {
      const pending = usePendingDelete((ids) => ids.has(sessionId))
      const [busy, setBusy] = React.useState(false)
      const onActivate = React.useCallback(() => {
        if (busy) return
        setBusy(true)
        if (pending) {
          Promise.resolve(requestCancel(sessionId, displayTitle)).catch((error) => {
            console.warn('[session-delete] cancel rejected:', error)
          }).finally(() => { setBusy(false) })
          return
        }
        const title = typeof displayTitle === 'string' && displayTitle !== '' ? displayTitle : t('untitled')
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('confirm.delete', { title }))
          : true
        if (!confirmed) {
          setBusy(false)
          return
        }
        Promise.resolve(requestDelete(sessionId, displayTitle)).catch((error) => {
          console.warn('[session-delete] enqueue rejected:', error)
        }).finally(() => { setBusy(false) })
      }, [busy, displayTitle, pending, requestCancel, requestDelete, sessionId, t])
      const label = pending
        ? (busy ? t('action.canceling') : t('action.cancelDelete'))
        : (busy ? t('action.deleting') : t('action.delete'))
      return h('button', {
        type: 'button',
        className: pending ? 'dshSessionDelete_iconButton dshSessionDelete_pendingButton' : 'dshSessionDelete_iconButton',
        'aria-label': label,
        title: label,
        'aria-busy': busy ? 'true' : undefined,
        'data-dsh-session-delete-pending': pending ? 'true' : undefined,
        disabled: busy,
        onClick: onActivate,
      }, pending ? h(UndoIcon) : h(TrashIcon))
    }

    /**
     * Non-interactive trailing marker that keeps the pending state visible
     * without hovering the row.
     * @param props - owner share, pending hook, locale seat.
     * @returns the marker, or nothing.
     */
    function SessionPendingDeleteMark({ sessionId, usePendingDelete, t }) {
      const pending = usePendingDelete((ids) => ids.has(sessionId))
      if (!pending) return null
      return h('span', {
        className: 'dshSessionDelete_pendingMark',
        'data-dsh-session-delete-pending': 'true',
        role: 'img',
        'aria-label': t('pendingMark'),
        title: t('pendingMark'),
      }, h(PendingIcon))
    }

    /**
     * Frame-wide notice for the last queue outcome; disappears on its own.
     * @param props - the notice source hook and its dismissal callback.
     * @returns one notice, or nothing.
     */
    function SessionDeleteToast({ useToast, dismissToast }) {
      const notice = useToast((value) => value)
      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => { dismissToast(notice.seq) }, notice.kind === 'success' ? 6000 : 5000)
        return () => { window.clearTimeout(timer) }
      }, [notice, dismissToast])
      if (notice === null) return null
      const failed = notice.kind === 'error'
      return h('div', { className: 'dshSessionDelete_toastLayer' },
        h('div', {
          className: failed ? 'dshSessionDelete_toast dshSessionDelete_toastError' : 'dshSessionDelete_toast',
          role: failed ? 'alert' : 'status',
        },
          h('span', { className: 'dshSessionDelete_toastIcon', 'aria-hidden': true }, failed ? '!' : '✓'),
          h('span', { className: 'dshSessionDelete_toastText' }, notice.message),
        ),
      )
    }

    /**
     * When the queued Session is the one open in the main view, move the view
     * away so it cannot be restored (and re-locked) on the next start.
     * @param ctx - Client plugin Context.
     * @param sessionId - Session just queued for deletion.
     */
    function leaveCurrentSession(ctx, sessionId) {
      const sessions = ctx.get('sessions')
      const uiWorkspace = ctx.get('uiWorkspace')
      if (sessions === undefined || uiWorkspace === undefined) return
      try {
        const list = typeof sessions.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
        if (list === undefined || list.byId === undefined) return
        const row = list.byId[sessionId]
        if (row === undefined || (row.retainedBy?.mainView ?? 0) <= 0) return
        const archived = new Set(
          ctx.get('workspaces')?.list?.getSnapshot?.()?.archivedSessionIds ?? [],
        )
        const ids = Array.isArray(list.ids) ? list.ids : Object.keys(list.byId)
        const next = ids.find((id) => id !== sessionId && list.byId[id] !== undefined && list.byId[id].blank !== true && !archived.has(id))
        if (next !== undefined && typeof uiWorkspace.openSession === 'function') {
          uiWorkspace.openSession(next)
          return
        }
        const workspaces = ctx.get('workspaces')
        const items = workspaces?.list?.getSnapshot?.()?.items ?? []
        const workspaceId = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))?.workspaceId
        if (typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession(workspaceId)
      } catch (error) {
        console.warn('[session-delete] could not move the main view away from the queued session:', error)
      }
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
        }, 'session-delete-v3: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-delete-v3: dictionaries')

        const t = ctx.locale.bind(NS)

        // Pending-deletion set: Host queue is the source of truth; localStorage
        // caches it only for a flicker-free first render.
        let pendingIds = readCachedPending()
        const pendingListeners = new Set()
        const pendingSource = {
          getSnapshot: () => pendingIds,
          subscribe: (listener) => {
            pendingListeners.add(listener)
            return () => { pendingListeners.delete(listener) }
          },
        }
        const publishPending = (ids) => {
          pendingIds = ids
          writeCachedPending(ids)
          for (const listener of pendingListeners) listener()
        }
        const refreshPending = async () => {
          const ids = await fetchPendingIds()
          if (ids !== null) publishPending(new Set(ids))
        }

        let notice = null
        let noticeSeq = 0
        const toastListeners = new Set()
        const publish = () => { for (const listener of toastListeners) listener() }
        const showToast = (next) => {
          notice = { ...next, seq: ++noticeSeq }
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
            toastListeners.add(listener)
            return () => { toastListeners.delete(listener) }
          },
        }

        /** Queue one Session for deletion (no file is removed while the app runs). */
        const requestDelete = async (sessionId, displayTitle) => {
          const title = typeof displayTitle === 'string' && displayTitle !== '' ? displayTitle : t('untitled')
          try {
            const payload = await postJson(DELETE_URL, { sessionId })
            if (payload.pending === true) {
              publishPending(new Set([...pendingIds, sessionId]))
              showToast({ kind: 'success', message: t('toast.queued', { title }) })
              leaveCurrentSession(ctx, sessionId)
            } else {
              // The Host reported the session is no longer stored: keep the UI honest.
              showToast({ kind: 'success', message: t('toast.canceled') })
            }
            await refreshPending()
          } catch (error) {
            showToast({ kind: 'error', message: t('toast.failed', { message: describeError(t, error) }) })
            throw error
          }
        }

        /** Cancel a pending deletion. */
        const requestCancel = async (sessionId) => {
          try {
            await postJson(CANCEL_URL, { sessionId })
            const next = new Set(pendingIds)
            next.delete(sessionId)
            publishPending(next)
            showToast({ kind: 'success', message: t('toast.canceled') })
            await refreshPending()
          } catch (error) {
            showToast({ kind: 'error', message: t('toast.failed', { message: describeError(t, error) }) })
            throw error
          }
        }

        void refreshPending()
        ctx.effect(() => {
          const timer = setTimeout(() => { void refreshPending() }, 1500)
          return () => { clearTimeout(timer) }
        }, 'session-delete-v3: pending refresh')

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'session-delete-v3',
          order: 300,
          locale: NS,
          inject: () => ({
            hooks: { pendingDelete: pendingSource },
            requestDelete,
            requestCancel,
          }),
        }, SessionDeleteRowButton))

        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'session-delete-v3.pending-mark',
          order: 100,
          locale: NS,
          inject: () => ({ hooks: { pendingDelete: pendingSource } }),
        }, SessionPendingDeleteMark))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete-v3.toast',
          order: 1000,
          inject: () => ({
            hooks: { toast: noticeSource },
            dismissToast,
          }),
        }, SessionDeleteToast))
      },
    }
  },
})

/** Read the localStorage pending-id cache (best effort). */
function readCachedPending() {
  try {
    if (typeof localStorage === 'undefined') return new Set()
    const raw = localStorage.getItem('dsh.sessionDelete.pending.v3')
    const parsed = raw === null ? [] : JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value !== '') : [])
  } catch (error) {
    return new Set()
  }
}

/** Write the localStorage pending-id cache (best effort). */
function writeCachedPending(ids) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem('dsh.sessionDelete.pending.v3', JSON.stringify([...ids]))
  } catch (error) {
    // The Host queue remains authoritative.
  }
}
