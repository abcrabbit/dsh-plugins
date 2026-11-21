// Client half of the @local/dsh-plugin-deepseek-usage bundle: a sidebar-foot
// "Balance/Token" entry plus the global "Balance / Token" main panel page.
// Hand-written browser module (no build step); `react` is the only importable
// specifier. All copy goes through the 'deepseek-usage' locale namespace.
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-deepseek-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useMemo, useRef, useEffect, useLayoutEffect } = React

    /** Locale namespace owned by this plugin (also its dictionary id). */
    const NS = 'deepseek-usage'
    /** Key of the global main-panel cell this plugin occupies. */
    const PANEL_ID = 'deepseek-usage'
    /** Same-origin Host routes implemented by the Node half of the bundle. */
    const ROUTES = {
      status: '/deepseek-usage/v1/status',
      overview: '/deepseek-usage/v1/overview',
      localUsage: '/deepseek-usage/v1/local-usage',
      refresh: '/deepseek-usage/v1/refresh',
    }
    /** First-sync poll cadence and ceiling (1.5s x 200 is about five minutes). */
    const SYNC_POLL_MS = 1500
    const SYNC_POLL_MAX = 200
    /** Both provider balances refresh about every two hours. */
    const BALANCES_AUTO_REFRESH_MS = 2 * 60 * 60 * 1000
    /** UncensoredLLM prepaid balance (USD) below which the entry warns. */
    const ULM_LOW_BALANCE_USD = 2
    /** Platform model row naming tool/function-call fees. */
    const MODEL_TOOL = 'tool'
    /** Time-range presets; order is the select order. */
    const PRESETS = [
      { id: 'all', labelKey: 'preset.all' },
      { id: '7d', labelKey: 'preset.7d' },
      { id: '30d', labelKey: 'preset.30d' },
      { id: 'this-month', labelKey: 'preset.thisMonth' },
      { id: 'last-month', labelKey: 'preset.lastMonth' },
      { id: 'custom', labelKey: 'preset.custom' },
    ]
    /** Stable test hooks for automated verification of the panel. */
    const TID = {
      root: 'usage-root',
      back: 'usage-back',
      refresh: 'usage-refresh',
      preset: 'usage-preset',
      rangeFrom: 'usage-range-from',
      rangeTo: 'usage-range-to',
      applyRange: 'usage-apply-range',
      keySelect: 'usage-key-select',
      modelSelect: 'usage-model-select',
      summary: 'usage-summary',
      chart: 'usage-chart',
      keyTable: 'usage-key-table',
      modelTable: 'usage-model-table',
      dailyTable: 'usage-daily-table',
    }

    /**
     * Visible copy. Simplified Chinese is the key-set source of truth; the
     * English dictionary carries the exact same keys. The same dictionaries
     * are mirrored into locale/zh.json and locale/en.json for Plugin Manager
     * display metadata; the Host never reads UI keys from those files.
     */
    const ZH = {
      "footer.label": "余额/Token",
      "footer.aria": "DeepSeek 与 UncensoredLLM 余额",
      "footer.hint": "查看 DeepSeek 与 UncensoredLLM 余额和用量（约每 2 小时自动刷新）",
      "footer.ds": "DS",
      "footer.ulm": "uLlm",
      "footer.loading": "…",
      "footer.balancesHint": "DeepSeek {ds} · UncensoredLLM {ulm}（约每 2 小时自动刷新）",
      "panel.title": "余额 / Token",
      "back": "返回会话",
      "refresh": "刷新",
      "refreshing": "同步中…",
      "loading": "加载中…",
      "syncing.title": "正在同步 DeepSeek 用量",
      "syncing.hint": "首次全量同步可能需要一点时间，完成后会自动加载。",
      "signedOut.title": "尚未登录 DeepSeek 开放平台",
      "signedOut.hint": "请先在左下角头像菜单登录 DeepSeek 开放平台账号",
      "signedOut.recheck": "重新检查",
      "account.signedInAs": "已登录：{name}",
      "account.generic": "已登录 DeepSeek 账户",
      "updatedAt": "最近同步：{time}",
      "time.never": "尚未同步",
      "status.stalePrefix": "最近一次同步未完成：{message}",
      "error.title": "加载失败",
      "error.retry": "重试",
      "error.signedOut": "登录状态已失效，请重新登录 DeepSeek 开放平台账号",
      "error.notReady": "数据尚未就绪，请稍后重试",
      "error.noData": "暂无用量数据",
      "error.unauthorized": "当前页面无权访问本地用量服务",
      "error.network": "无法连接到本地用量服务",
      "error.internal": "用量服务内部错误，请重试",
      "error.syncTimeout": "同步超时，请稍后重试",
      "error.unknown": "未知错误，请重试",
      "error.rangeRequired": "请选择开始日期和结束日期",
      "error.range": "开始日期不能晚于结束日期",
      "card.balance": "DeepSeek 余额",
      "card.bonus": "赠送余额 {amount}",
      "card.balanceUnavailable": "余额暂不可用",
      "card.ulmBalance": "UncensoredLLM 余额",
      "card.ulmSub": "约每 2 小时自动刷新 · {time}",
      "card.ulmUnavailable": "余额暂不可用",
      "card.ulmPending": "正在同步 UncensoredLLM 余额…",
      "card.ulmLow": "余额偏低，请及时充值",
      "balance.providersNote": "用量明细：DeepSeek 来自开放平台账单；UncensoredLLM 的 Token 用量来自本机会话日志。",
      "local.title": "UncensoredLLM Token 用量（本机记录）",
      "local.hint": "来自 DSH 本机会话日志，按 UTC 日统计；与中转账单可能有差异",
      "local.sessions": "{count} 个会话",
      "chart.dsCost": "DeepSeek 消费",
      "chart.costUnavailable": "本地记录无金额",
      "combined.title": "Token 用量总览（DeepSeek + UncensoredLLM）",
      "combined.hint": "两家合计，随下方时间范围联动",
      "combined.totalTokens": "合计 Token",
      "combined.totalRequests": "合计调用次数",
      "combined.deepseek": "DeepSeek",
      "combined.uncensored": "UncensoredLLM",
      "combined.legend": "柱状图底部为 DeepSeek，顶部为 UncensoredLLM",
      "provider.deepseek": "DeepSeek 用量",
      "provider.deepseekHint": "来自 DeepSeek 开放平台账单",
      "provider.uncensored": "UncensoredLLM 用量（本机记录）",
      "provider.uncensoredHint": "来自 DSH 本机会话日志，可能少于中转账单",
      "column.input": "输入 Token",
      "column.output": "输出 Token",
      "column.cache": "缓存命中 Token",
      "card.totalCost": "累计消费",
      "card.totalTokens": "累计 Token",
      "card.totalRequests": "累计调用次数",
      "wallet.paid": "现金消费 {amount}",
      "wallet.granted": "赠送消费 {amount}",
      "filter.range": "时间范围",
      "filter.key": "API Key",
      "filter.model": "模型",
      "filter.from": "开始日期",
      "filter.to": "结束日期",
      "filter.apply": "应用",
      "filter.all": "全部",
      "filter.utcHint": "按 UTC 日统计",
      "filter.sinceFirst": "自 {date}（UTC）起累计",
      "preset.all": "全部",
      "preset.7d": "近 7 天",
      "preset.30d": "近 30 天",
      "preset.thisMonth": "本月",
      "preset.lastMonth": "上月",
      "preset.custom": "自定义",
      "summary.tokens": "Token",
      "summary.cost": "消费",
      "summary.requests": "调用",
      "summary.period": "统计区间",
      "summary.allTime": "全部历史",
      "unit.times": "{value} 次",
      "chart.title": "每日 Token",
      "chart.empty": "所选范围内暂无数据",
      "chart.dayHint": "{date}：{tokens} tokens",
      "table.byKey": "按 API Key",
      "table.byModel": "按模型",
      "table.byDay": "按日明细",
      "column.key": "API Key",
      "column.model": "模型",
      "column.date": "日期",
      "column.tokens": "Token",
      "column.cost": "金额",
      "column.requests": "调用次数",
      "table.empty": "暂无数据",
      "model.tool": "工具调用"
    }
    const EN = {
      "footer.label": "Balance/Token",
      "footer.aria": "DeepSeek and UncensoredLLM balances",
      "footer.hint": "View DeepSeek and UncensoredLLM balances and usage (auto-refreshes about every 2 hours)",
      "footer.ds": "DS",
      "footer.ulm": "uLlm",
      "footer.loading": "…",
      "footer.balancesHint": "DeepSeek {ds} · UncensoredLLM {ulm} (auto-refreshes about every 2 hours)",
      "panel.title": "Balance / Token",
      "back": "Back to conversation",
      "refresh": "Refresh",
      "refreshing": "Syncing…",
      "loading": "Loading…",
      "syncing.title": "Syncing DeepSeek usage",
      "syncing.hint": "The first full sync can take a moment; the panel loads automatically when it finishes.",
      "signedOut.title": "Not signed in to the DeepSeek platform",
      "signedOut.hint": "Sign in to your DeepSeek platform account from the avatar menu at the bottom left first.",
      "signedOut.recheck": "Check again",
      "account.signedInAs": "Signed in as {name}",
      "account.generic": "Signed in to a DeepSeek account",
      "updatedAt": "Last synced: {time}",
      "time.never": "Not synced yet",
      "status.stalePrefix": "The last sync did not finish: {message}",
      "error.title": "Something went wrong",
      "error.retry": "Try again",
      "error.signedOut": "The sign-in expired. Sign in to the DeepSeek platform account again.",
      "error.notReady": "The usage data is not ready yet. Try again shortly.",
      "error.noData": "No usage data is available",
      "error.unauthorized": "This page is not allowed to use the local usage service",
      "error.network": "Could not reach the local usage service",
      "error.internal": "The usage service failed. Try again.",
      "error.syncTimeout": "The sync timed out. Try again later.",
      "error.unknown": "Unknown error. Try again.",
      "error.rangeRequired": "Choose both a start date and an end date",
      "error.range": "The start date cannot be after the end date",
      "card.balance": "DeepSeek balance",
      "card.bonus": "Granted balance {amount}",
      "card.balanceUnavailable": "Balance unavailable",
      "card.ulmBalance": "UncensoredLLM balance",
      "card.ulmSub": "Auto-refreshes about every 2 hours · {time}",
      "card.ulmUnavailable": "Balance unavailable",
      "card.ulmPending": "Syncing UncensoredLLM balance…",
      "card.ulmLow": "Low balance — top up soon",
      "balance.providersNote": "Usage details: DeepSeek comes from the platform bill; UncensoredLLM token usage comes from local Session logs.",
      "local.title": "UncensoredLLM token usage (local records)",
      "local.hint": "Folded from DSH local Session logs and counted by UTC day; may differ from the relay bill",
      "local.sessions": "{count} sessions",
      "chart.dsCost": "DeepSeek spend",
      "chart.costUnavailable": "No amount in local records",
      "combined.title": "Token usage overview (DeepSeek + UncensoredLLM)",
      "combined.hint": "Both providers combined; follows the date range below",
      "combined.totalTokens": "Total tokens",
      "combined.totalRequests": "Total requests",
      "combined.deepseek": "DeepSeek",
      "combined.uncensored": "UncensoredLLM",
      "combined.legend": "Bars: DeepSeek at the bottom, UncensoredLLM on top",
      "provider.deepseek": "DeepSeek usage",
      "provider.deepseekHint": "From the DeepSeek platform bill",
      "provider.uncensored": "UncensoredLLM usage (local records)",
      "provider.uncensoredHint": "From DSH local Session logs; may be lower than the relay bill",
      "column.input": "Input tokens",
      "column.output": "Output tokens",
      "column.cache": "Cache-hit tokens",
      "card.totalCost": "Total spend",
      "card.totalTokens": "Total tokens",
      "card.totalRequests": "Total requests",
      "wallet.paid": "Paid spend {amount}",
      "wallet.granted": "Granted spend {amount}",
      "filter.range": "Date range",
      "filter.key": "API key",
      "filter.model": "Model",
      "filter.from": "Start date",
      "filter.to": "End date",
      "filter.apply": "Apply",
      "filter.all": "All",
      "filter.utcHint": "Counted by UTC day",
      "filter.sinceFirst": "Since {date} (UTC)",
      "preset.all": "All",
      "preset.7d": "Last 7 days",
      "preset.30d": "Last 30 days",
      "preset.thisMonth": "This month",
      "preset.lastMonth": "Last month",
      "preset.custom": "Custom",
      "summary.tokens": "Tokens",
      "summary.cost": "Spend",
      "summary.requests": "Requests",
      "summary.period": "Period",
      "summary.allTime": "All history",
      "unit.times": "{value}",
      "chart.title": "Daily tokens",
      "chart.empty": "No data in the selected range",
      "chart.dayHint": "{date}: {tokens} tokens",
      "table.byKey": "By API key",
      "table.byModel": "By model",
      "table.byDay": "Daily breakdown",
      "column.key": "API key",
      "column.model": "Model",
      "column.date": "Date",
      "column.tokens": "Tokens",
      "column.cost": "Cost",
      "column.requests": "Requests",
      "table.empty": "No data",
      "model.tool": "Tool calls"
    }

    /** Theme tokens used by this panel (no literal colors in UI chrome). */
    const TOKENS = {
      label: 'var(--dsw-alias-label-primary)',
      label2: 'var(--dsw-alias-label-secondary)',
      label3: 'var(--dsw-alias-label-tertiary)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      cardFill: 'var(--dsw-alias-settings-card-fill)',
      cardStroke: 'var(--dsw-alias-settings-card-stroke)',
      stroke: 'var(--dsw-alias-border-l3)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      sidebarFill: 'var(--dsw-specific-sidebar-fill)',
      brand: 'var(--dsw-alias-brand-primary)',
      danger: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      // Provider accents (their own brand hues, tuned for both themes).
      dsAccent: '#4D6BFE',
      dsAccentSoft: 'rgba(77, 107, 254, 0.14)',
      dsAccentFaint: 'rgba(77, 107, 254, 0.07)',
      dsAccentStroke: 'rgba(77, 107, 254, 0.42)',
      ulmAccent: '#E39A2D',
      ulmAccentSoft: 'rgba(227, 154, 45, 0.18)',
      ulmAccentFaint: 'rgba(227, 154, 45, 0.09)',
      ulmAccentStroke: 'rgba(227, 154, 45, 0.48)',
    }

    /** Number/cost/date formatting shared by every table and card. */
    const integerFormat = (() => {
      try {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
      } catch (error) {
        return null
      }
    })()
    function formatInteger(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '0'
      return integerFormat === null ? String(Math.round(number)) : integerFormat.format(number)
    }
    /** Trim to at most four decimals, then drop trailing zeros: 224.4400 -> 224.44. */
    function formatCost(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '0'
      const text = number.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
      return text === '-0' ? '0' : text
    }
    function currencySymbol(code) {
      if (code === 'USD') return '$'
      if (code === 'CNY' || code === 'RMB') return '¥'
      return code ? code + ' ' : '¥'
    }
    function formatMoney(value, code) {
      return currencySymbol(code) + formatCost(value)
    }
    /** Balance strings keep the Host's two-decimal form (¥0.00 stays ¥0.00). */
    function formatBalance(value, code) {
      const symbol = currencySymbol(code)
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return symbol + value.trim()
      const number = Number(value)
      return Number.isFinite(number) ? symbol + formatCost(number) : '—'
    }
    /** Prepaid USD credit is shown with exactly two decimals: $25.64. */
    function formatUsd(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      try {
        return '$' + new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
      } catch (error) {
        return '$' + number.toFixed(2)
      }
    }
    function formatDateTime(timestamp) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
      try {
        return new Date(timestamp).toLocaleString()
      } catch (error) {
        return null
      }
    }

    /**
     * All Host buckets are UTC days; presets therefore use the UTC calendar.
     * Custom ranges are passed through verbatim (no maximum span).
     */
    function utcDate(date) {
      return date.toISOString().slice(0, 10)
    }
    function utcToday() {
      return utcDate(new Date())
    }
    function addUtcDays(isoDate, delta) {
      const date = new Date(isoDate + 'T00:00:00Z')
      date.setUTCDate(date.getUTCDate() + delta)
      return utcDate(date)
    }
    function utcMonthFirst(isoDate) {
      return isoDate.slice(0, 8) + '01'
    }
    function previousUtcMonth(isoDate) {
      const today = new Date(isoDate + 'T00:00:00Z')
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
      return { from: utcDate(first), to: utcDate(last) }
    }
    /** @returns {{from?: string, to?: string}} empty object means all history. */
    function rangeForPreset(preset, customFrom, customTo) {
      const today = utcToday()
      if (preset === '7d') return { from: addUtcDays(today, -6), to: today }
      if (preset === '30d') return { from: addUtcDays(today, -29), to: today }
      if (preset === 'this-month') return { from: utcMonthFirst(today), to: today }
      if (preset === 'last-month') return previousUtcMonth(today)
      if (preset === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo }
      return {}
    }

    /** Stable error codes: the Host answers `{ok:false,code,message}`. */
    class UsageRequestError extends Error {
      constructor(code, message) {
        super(message === undefined ? code : message)
        this.name = 'UsageRequestError'
        this.code = code
      }
    }
    const ERROR_KEYS = {
      signed_out: 'error.signedOut',
      not_ready: 'error.notReady',
      no_data: 'error.noData',
      unauthorized: 'error.unauthorized',
      network: 'error.network',
      internal: 'error.internal',
      sync_timeout: 'error.syncTimeout',
    }
    /** @returns the locale key describing one failure code. */
    function errorKey(error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      return ERROR_KEYS[code] || 'error.unknown'
    }
    function errorCode(error) {
      return error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
    }
    /** One same-origin JSON request; failures surface as UsageRequestError. */
    async function requestJson(url, init) {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        throw new UsageRequestError('network')
      }
      let response
      try {
        response = await window.fetch(url, Object.assign({ cache: 'no-store', headers: { accept: 'application/json' } }, init))
      } catch (error) {
        throw new UsageRequestError('network')
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        throw new UsageRequestError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'unknown')
      }
      if (payload !== null && typeof payload === 'object' && payload.ok === true) return payload
      const code = payload !== null && typeof payload === 'object' && typeof payload.code === 'string'
        ? payload.code
        : response.status === 401 || response.status === 403 ? 'unauthorized' : 'unknown'
      throw new UsageRequestError(code, payload !== null && typeof payload === 'object' && typeof payload.message === 'string' ? payload.message : undefined)
    }
    function fetchStatus(options) {
      return requestJson(options !== undefined && options !== null && options.light === true
        ? ROUTES.status + '?light=1'
        : ROUTES.status)
    }
    function fetchOverview(filters) {
      const params = new URLSearchParams()
      if (filters.from && filters.to) {
        params.set('from', filters.from)
        params.set('to', filters.to)
      }
      if (filters.key) params.set('key', filters.key)
      if (filters.model) params.set('model', filters.model)
      const query = params.toString()
      return requestJson(ROUTES.overview + (query === '' ? '' : '?' + query))
    }
    /** UncensoredLLM token usage folded from local Session logs. */
    function fetchLocalUsage(filters) {
      const params = new URLSearchParams()
      if (filters.from && filters.to) {
        params.set('from', filters.from)
        params.set('to', filters.to)
      }
      const query = params.toString()
      return requestJson(ROUTES.localUsage + (query === '' ? '' : '?' + query))
    }
    function postRefresh() {
      return requestJson(ROUTES.refresh, { method: 'POST' })
    }
    function delay(milliseconds) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds)
      })
    }
    const noop = () => {}

    /** Square inline SVG icons; stroke follows the surrounding text color. */
    function WalletIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M3.75 8.5A2.75 2.75 0 0 1 6.5 5.75h10.5a2.25 2.25 0 0 1 2.25 2.25v1' }),
        h('path', { d: 'M3.75 8.5v8.25a2.5 2.5 0 0 0 2.5 2.5h11.5a2.5 2.5 0 0 0 2.5-2.5v-5' }),
        h('path', { d: 'M20.25 9.25h-3.4a1.75 1.75 0 0 0 0 3.5h3.4' }),
        h('circle', { cx: '16.85', cy: '11', r: '0.9', fill: 'currentColor', stroke: 'none' }),
      )
    }
    function RefreshIcon({ size, spinning }) {
      const paths = [
        h('path', { key: 'arc', d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
        h('path', { key: 'head', d: 'M20 4v4.5h-4.5' }),
      ]
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('g', null, paths, spinning
        ? h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 12 12', to: '360 12 12', dur: '0.9s', repeatCount: 'indefinite' })
        : null))
    }
    function ChevronLeftIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'M14.5 5.5 8 12l6.5 6.5' }))
    }
    function WarningIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M12 4.75 21 19.5H3L12 4.75Z' }),
        h('path', { d: 'M12 10v4.25' }),
        h('circle', { cx: '12', cy: '17', r: '0.6', fill: 'currentColor', stroke: 'none' }),
      )
    }
    function SpinnerIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('g', null,
        h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 12 12', to: '360 12 12', dur: '0.9s', repeatCount: 'indefinite' })))
    }

    /** Shared inline styles: only theme tokens, no literal colors. */
    const TH_BASE = {
      textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 500, lineHeight: '18px',
      color: TOKENS.label2, borderBottom: '0.5px solid ' + TOKENS.stroke, whiteSpace: 'nowrap',
      background: TOKENS.cardFill, position: 'sticky', top: 0, zIndex: 1,
    }
    const S = {
      page: {
        boxSizing: 'border-box', height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        background: 'var(--dsw-alias-bg-base)', color: TOKENS.label, fontSize: 14, lineHeight: '22px',
      },
      pageInner: { boxSizing: 'border-box', width: '100%', maxWidth: 1120, margin: '0 auto', padding: '0 clamp(16px, 3vw, 24px) 40px' },
      header: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px 16px' },
      headerMain: { minWidth: 0, flex: '1 1 320px' },
      titleRow: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 20, fontWeight: 500, lineHeight: '28px', color: TOKENS.label },
      headerSub: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', marginTop: 4, fontSize: 13, lineHeight: '20px', color: TOKENS.label2 },
      dot: { color: TOKENS.label3 },
      headerActions: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none', paddingTop: 2 },
      banner: {
        boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16,
        padding: '10px 14px', border: '0.5px solid ' + TOKENS.warn, borderRadius: 'var(--dsw-radius-md)',
        background: TOKENS.surface, color: TOKENS.label, fontSize: 13, lineHeight: '20px',
      },
      bannerDanger: { borderColor: TOKENS.danger },
      bannerIcon: { flex: 'none', color: TOKENS.warn, display: 'inline-flex', paddingTop: 1 },
      bannerText: { minWidth: 0, overflowWrap: 'anywhere' },
      cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 20 },
      card: {
        boxSizing: 'border-box', minWidth: 0, padding: '14px 16px', borderRadius: 'var(--dsw-radius-xl)',
        border: '0.5px solid ' + TOKENS.cardStroke, background: TOKENS.cardFill,
      },
      cardLabel: { fontSize: 13, lineHeight: '20px', color: TOKENS.label2 },
      cardValue: { marginTop: 6, fontSize: 22, lineHeight: '30px', fontWeight: 600, color: TOKENS.label, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
      cardSub: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: TOKENS.label3, overflowWrap: 'anywhere' },
      filterBar: {
        boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 16px',
        marginTop: 20, padding: '14px 16px', borderRadius: 'var(--dsw-radius-xl)',
        border: '0.5px solid ' + TOKENS.cardStroke, background: TOKENS.cardFill,
      },
      field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      fieldLabel: { fontSize: 12, lineHeight: '18px', color: TOKENS.label2 },
      control: {
        boxSizing: 'border-box', height: 32, padding: '0 8px', border: '0.5px solid ' + TOKENS.stroke,
        borderRadius: 'var(--dsw-radius-sm)', background: TOKENS.surface, color: TOKENS.label,
        font: 'inherit', fontSize: 13, lineHeight: '20px',
      },
      filterHint: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', width: '100%', fontSize: 12, lineHeight: '18px', color: TOKENS.label3 },
      fieldError: { width: '100%', fontSize: 12, lineHeight: '18px', color: TOKENS.danger },
      summary: {
        boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px 28px',
        marginTop: 20, padding: '12px 16px', borderRadius: 'var(--dsw-radius-xl)',
        border: '0.5px solid ' + TOKENS.cardStroke, background: TOKENS.cardFill,
      },
      summaryStat: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 },
      summaryLabel: { fontSize: 12, lineHeight: '18px', color: TOKENS.label2, whiteSpace: 'nowrap' },
      summaryValue: { fontSize: 15, lineHeight: '22px', fontWeight: 600, color: TOKENS.label, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
      section: { marginTop: 24 },
      sectionHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px', marginBottom: 10 },
      sectionTitle: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '24px', color: TOKENS.label },
      sectionHint: { fontSize: 12, lineHeight: '18px', color: TOKENS.label3 },
      chart: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 140, padding: '0 2px', borderBottom: '1px solid ' + TOKENS.stroke },
      chartBar: { flex: '1 1 0', minWidth: 2, minHeight: 1, background: TOKENS.brand, borderRadius: '2px 2px 0 0' },
      chartAxis: { display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, fontSize: 12, lineHeight: '18px', color: TOKENS.label3 },
      chartTip: {
        position: 'fixed', zIndex: 9999, pointerEvents: 'none', boxSizing: 'border-box',
        minWidth: 178, maxWidth: 280, padding: '9px 11px', borderRadius: 'var(--dsw-radius-md)',
        border: '0.5px solid ' + TOKENS.stroke, background: TOKENS.surface,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)',
        fontSize: 12, lineHeight: '19px', color: TOKENS.label,
      },
      chartTipTitle: { marginBottom: 4, fontWeight: 600, color: TOKENS.label },
      chartTipRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
      chartTipLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, color: TOKENS.label2 },
      chartTipValue: { fontVariantNumeric: 'tabular-nums', color: TOKENS.label, fontWeight: 500 },
      chartTipDot: { width: 8, height: 8, borderRadius: '50%', flex: 'none' },
      chartEmpty: {
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140,
        border: '0.5px dashed ' + TOKENS.stroke, borderRadius: 'var(--dsw-radius-md)', fontSize: 13, lineHeight: '20px', color: TOKENS.label3,
      },
      tableWrap: { boxSizing: 'border-box', border: '0.5px solid ' + TOKENS.cardStroke, borderRadius: 'var(--dsw-radius-lg)', overflow: 'auto' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, lineHeight: '20px', color: TOKENS.label },
      th: TH_BASE,
      thNum: Object.assign({}, TH_BASE, { textAlign: 'right' }),
      td: { padding: '10px 12px', borderBottom: '0.5px solid ' + TOKENS.stroke, verticalAlign: 'top', color: TOKENS.label },
      tdNum: { padding: '10px 12px', borderBottom: '0.5px solid ' + TOKENS.stroke, verticalAlign: 'top', color: TOKENS.label, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      tdEmpty: { padding: '16px 12px', color: TOKENS.label3, textAlign: 'center' },
      cellMain: { overflowWrap: 'anywhere' },
      cellSub: { marginTop: 2, fontSize: 12, lineHeight: '18px', color: TOKENS.label3, fontFamily: 'var(--dsh-font-family-code, monospace)', overflowWrap: 'anywhere' },
      statusPanel: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        maxWidth: 520, margin: '48px auto 0', padding: '28px 24px', borderRadius: 'var(--dsw-radius-xl)',
        border: '0.5px solid ' + TOKENS.cardStroke, background: TOKENS.cardFill, textAlign: 'center',
      },
      statusIcon: { color: TOKENS.label3, display: 'inline-flex' },
      statusIconDanger: { color: TOKENS.danger },
      statusTitle: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '24px', color: TOKENS.label },
      statusHint: { margin: 0, fontSize: 13, lineHeight: '22px', color: TOKENS.label2, overflowWrap: 'anywhere' },
      footerLabel: { minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      footerBalances: {
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch',
        gap: 0, minWidth: 0, flex: '1 1 auto', overflow: 'hidden',
      },
      footerBalanceLine: {
        fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums', color: TOKENS.label2,
      },
      footerBalanceProvider: { color: TOKENS.label3, fontWeight: 600 },
    }

    /** Native-looking button: hover/focus handled with React state (inline styles only). */
    function UiButton(props) {
      const [hovered, setHovered] = useState(false)
      const [focused, setFocused] = useState(false)
      const variant = props.variant || 'outline'
      const disabled = props.disabled === true
      let background = 'transparent'
      let color = TOKENS.label
      let border = '0.5px solid ' + TOKENS.stroke
      if (variant === 'primary') {
        background = hovered && !disabled ? 'var(--dsw-alias-button-primary-hover)' : 'var(--dsw-alias-button-primary-fill)'
        color = 'var(--dsw-alias-label-primary-foreground)'
        border = 'none'
      } else if (variant === 'ghost') {
        background = hovered && !disabled ? TOKENS.hover : 'transparent'
        border = 'none'
      } else if (hovered && !disabled) {
        background = TOKENS.hover
      }
      const style = Object.assign({
        boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 36, padding: variant === 'ghost' ? '0 10px' : variant === 'primary' ? '0 16px' : '0 14px',
        font: 'inherit', fontSize: 14, lineHeight: '22px', fontWeight: variant === 'primary' ? 500 : 400,
        color, background, border, borderRadius: 'var(--dsw-radius-md)',
        cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', flex: 'none',
        opacity: disabled ? 0.5 : 1, outline: 'none',
        boxShadow: focused ? '0 0 0 var(--dsw-focus-ring-width, 2px) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))' : 'none',
      }, props.style)
      return h('button', {
        type: 'button',
        disabled,
        'data-testid': props.testId,
        'aria-label': props.ariaLabel,
        title: props.title,
        onClick: disabled ? undefined : props.onClick,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        style,
      }, props.children)
    }

    function StatCard({ label, value, sub, danger, accent }) {
      const tone = accent === 'ds'
        ? { accent: TOKENS.dsAccent, fill: TOKENS.dsAccentFaint, stroke: TOKENS.dsAccentStroke }
        : accent === 'ulm'
          ? { accent: TOKENS.ulmAccent, fill: TOKENS.ulmAccentFaint, stroke: TOKENS.ulmAccentStroke }
          : null
      const cardStyle = tone === null ? S.card : Object.assign({}, S.card, { background: tone.fill, borderColor: tone.stroke })
      const labelStyle = tone === null ? S.cardLabel : Object.assign({}, S.cardLabel, { color: tone.accent, fontWeight: 600 })
      const valueStyle = danger === true
        ? Object.assign({}, S.cardValue, { color: TOKENS.danger })
        : S.cardValue
      const subStyle = danger === true
        ? Object.assign({}, S.cardSub, { color: TOKENS.danger })
        : S.cardSub
      return h('div', { style: cardStyle },
        h('div', { style: labelStyle }, label),
        h('div', { style: valueStyle }, value),
        sub === undefined || sub === null || sub === '' ? null : h('div', { style: subStyle }, sub))
    }
    function Field({ label, children }) {
      return h('label', { style: S.field },
        h('span', { style: S.fieldLabel }, label),
        children)
    }
    function Section({ title, hint, children, accent }) {
      const dot = accent === 'ds' ? TOKENS.dsAccent : accent === 'ulm' ? TOKENS.ulmAccent : null
      return h('section', { style: S.section },
        h('div', { style: S.sectionHead },
          h('h2', { style: dot === null ? S.sectionTitle : Object.assign({}, S.sectionTitle, { display: 'inline-flex', alignItems: 'center', gap: 8 }) },
            dot === null ? title : [h('span', { key: 'dot', style: { width: 9, height: 9, borderRadius: '50%', background: dot, flex: 'none' } }), title]),
          hint === undefined ? null : h('span', { style: S.sectionHint }, hint)),
        children)
    }
    function StatusPanel({ icon, danger, title, hint, children }) {
      return h('div', { style: S.statusPanel },
        h('span', { style: danger ? S.statusIconDanger : S.statusIcon }, icon),
        h('h2', { style: S.statusTitle }, title),
        hint === undefined ? null : h('p', { style: S.statusHint }, hint),
        children)
    }
    function Spinner() {
      return h('span', { style: S.statusIcon }, h(SpinnerIcon, { size: 22 }))
    }

    /** Find the shell's account launcher button without depending on another
     *  package's class names: the launcher is the one menu button that carries
     *  the accounting row's `data-collapsed` geometry state. */
    function findAccountLauncher() {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null
      const button = document.querySelector('button[aria-haspopup="menu"][data-collapsed]')
      if (!(button instanceof HTMLElement)) return null
      const rect = button.getBoundingClientRect()
      if (rect.width < 120 || rect.height < 32) return null
      return button
    }

    /**
     * The shell row that hosts the account launcher plus any status/update
     * indicators rendered beside it (the row carries a `*_triggerRow` class).
     */
    function findLauncherRow(launcher) {
      let current = launcher
      let guard = 0
      while (current !== null && guard < 10) {
        const className = typeof current.className === 'string' ? current.className : ''
        if (className.indexOf('triggerRow') !== -1) return current
        current = current.parentElement
        guard += 1
      }
      return null
    }

    /**
     * Sidebar-foot entry. In the wide sidebar it is overlaid on the right half of
     * the account launcher row, so the avatar button keeps the left half and the
     * two controls share one row exactly as requested. The geometry is computed
     * synchronously from the live launcher rect (no requestAnimationFrame, which
     * is paused while the app window is occluded) and applied as plain inline
     * styles: the slot row collapses through a negative bottom margin and the
     * button is translated onto the launcher row. In the rail it falls back to
     * the plain 36x36 icon button in the footer-action row.
     */
    function UsageFooterAction(props) {
      const { t, wide } = props
      const [hovered, setHovered] = useState(false)
      const [focused, setFocused] = useState(false)
      const [split, setSplit] = useState(null)
      const buttonRef = useRef(null)
      const splitRef = useRef(null)
      const label = t('footer.label')
      const [balances, setBalances] = useState(null)

      // The entry shows both provider balances even while the panel is closed:
      // fetch once on mount, then about every two hours (and when the page
      // becomes visible again after being in the background for a while).
      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        let alive = true
        let timer = 0
        let retryTimer = 0
        let attempts = 0
        const load = async () => {
          try {
            const next = await fetchStatus({ light: true })
            if (!alive) return
            const value = next !== null && typeof next === 'object' && next.balances !== null && typeof next.balances === 'object'
              ? next.balances
              : null
            setBalances(value)
            attempts = 0
            if (retryTimer !== 0) {
              window.clearTimeout(retryTimer)
              retryTimer = 0
            }
          } catch (error) {
            // The Host may still be registering its routes right after a
            // reload/restart; back off and retry instead of staying blank
            // until the next two-hour tick.
            if (!alive) return
            if (attempts >= 6) {
              // Keep the entry readable even when the local Host is unavailable.
              setBalances({ deepseek: null, ulm: null })
              return
            }
            attempts += 1
            retryTimer = window.setTimeout(() => {
              retryTimer = 0
              void load()
            }, Math.min(15000, Math.round(1500 * Math.pow(1.7, attempts))))
          }
        }
        void load()
        timer = window.setInterval(() => { void load() }, BALANCES_AUTO_REFRESH_MS)
        const onVisible = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') void load()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          window.clearInterval(timer)
          if (retryTimer !== 0) window.clearTimeout(retryTimer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        }
        // Mount-only: the cadence is owned by BALANCES_AUTO_REFRESH_MS.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useLayoutEffect(() => {
        if (!wide || typeof window === 'undefined') {
          splitRef.current = null
          setSplit(null)
          return undefined
        }
        let alive = true
        let timer = 0
        let attempts = 0
        let observer = null
        let mutation = null
        /** Retry the measurement a few times while the shell finishes mounting. */
        const schedule = () => {
          if (!alive || attempts >= 20 || timer !== 0) return
          attempts += 1
          timer = window.setTimeout(() => {
            timer = 0
            compute()
          }, 300)
        }
        /** Measure the launcher row and compute this button's right-side placement. */
        const compute = () => {
          if (!alive) return
          const button = buttonRef.current
          const launcher = findAccountLauncher()
          if (button === null || launcher === null) {
            schedule()
            return
          }
          const launcherRect = launcher.getBoundingClientRect()
          const rect = button.getBoundingClientRect()
          const height = Math.round(launcherRect.height)
          // The account launcher shares its row with the shell's connection and
          // update indicators. Never extend past the launcher's own right edge:
          // when such an indicator mounts, the flex launcher shrinks and this
          // measurement keeps the balance button clear of it.
          const row = findLauncherRow(launcher)
          let rightLimit = launcherRect.right
          if (row !== null) {
            for (const sibling of row.children) {
              if (sibling === launcher || sibling.contains(launcher)) continue
              const siblingRect = sibling.getBoundingClientRect()
              if (siblingRect.width <= 0 || siblingRect.height <= 0) continue
              if (siblingRect.bottom <= launcherRect.top + 1 || siblingRect.top >= launcherRect.bottom - 1) continue
              rightLimit = Math.min(rightLimit, siblingRect.left)
            }
          }
          const available = Math.max(90, rightLimit - launcherRect.left)
          const half = available / 2
          // Prefer the exact half split; keep a readable label by allowing a
          // slightly wider right half when indicators narrow the launcher.
          const width = Math.round(Math.min(Math.max(half, 120), available - 72))
          const compact = width < 134
          if (width < 90 || height < 36) {
            schedule()
            return
          }
          const previous = splitRef.current
          // Undo the already-applied translate so both passes share one origin.
          const baseLeft = previous === null ? rect.left : rect.left - previous.dx
          const baseTop = previous === null ? rect.top : rect.top - previous.dy
          const targetLeft = rightLimit - width
          const targetTop = launcherRect.top
          const dx = Math.round(targetLeft - baseLeft)
          const dy = previous === null
            // First pass: collapsing the slot row moves this row down by its height.
            ? Math.round(targetTop - baseTop - height)
            : Math.round(targetTop - baseTop)
          const next = { width, height, dx, dy, compact }
          if (previous === null || previous.width !== next.width || previous.height !== next.height
            || previous.dx !== next.dx || previous.dy !== next.dy || previous.compact !== next.compact) {
            splitRef.current = next
            setSplit(next)
          }
          schedule()
        }
        compute()
        window.addEventListener('resize', compute)
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(compute)
          const launcher = findAccountLauncher()
          if (launcher !== null) observer.observe(launcher)
          const row = launcher === null ? null : findLauncherRow(launcher)
          if (row !== null) observer.observe(row)
        }
        if (typeof MutationObserver === 'function') {
          const launcher = findAccountLauncher()
          const row = launcher === null ? null : findLauncherRow(launcher)
          const target = row === null ? launcher : row
          if (target !== null) {
            mutation = new MutationObserver(compute)
            mutation.observe(target, { childList: true, subtree: target === row })
          }
        }
        return () => {
          alive = false
          attempts = 99
          clearTimeout(timer)
          window.removeEventListener('resize', compute)
          if (observer !== null) observer.disconnect()
          if (mutation !== null) mutation.disconnect()
        }
      }, [wide])

      const dsBalance = balances !== null && balances.deepseek !== null && typeof balances.deepseek === 'object' ? balances.deepseek : null
      const ulmBalance = balances !== null && balances.ulm !== null && typeof balances.ulm === 'object' ? balances.ulm : null
      const dsText = balances === null
        ? t('footer.loading')
        : dsBalance === null ? '—' : formatBalance(dsBalance.total, dsBalance.currency || 'CNY')
      const ulmText = balances === null
        ? t('footer.loading')
        : ulmBalance === null || ulmBalance.available === null ? '—' : formatUsd(ulmBalance.available)
      const ulmLow = ulmBalance !== null && ulmBalance.low === true
      const balancesHint = balances === null ? t('footer.hint') : t('footer.balancesHint', { ds: dsText, ulm: ulmText })
      const compact = split !== null && split.compact === true
      const rowStyle = split === null ? {} : {
        width: split.width, height: split.height, marginBottom: -split.height,
        flex: '0 0 auto', position: 'relative', zIndex: 2,
        transform: 'translate(' + split.dx + 'px, ' + split.dy + 'px)',
        // Cover the launcher's full-row hover pill: the right half keeps the
        // sidebar surface unless this button itself is hovered, so hovering the
        // avatar only highlights the avatar half and vice versa.
        background: hovered ? TOKENS.hover : TOKENS.sidebarFill,
        borderRadius: '0 var(--dsw-radius-md) var(--dsw-radius-md) 0',
      }
      return h('button', {
        ref: buttonRef,
        type: 'button',
        'data-testid': 'usage-footer-entry',
        'aria-label': balancesHint,
        title: balancesHint,
        onClick: props.onSelect,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: (event) => {
          // Ring only for keyboard focus; a mouse click should not leave one behind.
          let keyboard = true
          try { keyboard = event.target.matches(':focus-visible') } catch { keyboard = true }
          setFocused(keyboard)
        },
        onBlur: () => setFocused(false),
        style: Object.assign({
          boxSizing: 'border-box', display: 'flex', alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: compact ? 6 : 8, width: wide ? '100%' : 36, height: wide ? 44 : 36,
          padding: wide ? (compact ? '6px 6px' : '6px 8px') : 0, margin: 0, minWidth: 0, flex: 'none',
          border: 'none', borderRadius: 'var(--dsw-radius-md)',
          background: hovered ? TOKENS.hover : 'transparent',
          color: TOKENS.label, font: 'inherit', fontSize: compact ? 13 : 14, lineHeight: '22px',
          textAlign: 'left', cursor: 'pointer', outline: 'none',
          boxShadow: focused ? '0 0 0 var(--dsw-focus-ring-width, 2px) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))' : 'none',
        }, rowStyle),
      }, wide ? h('span', {
        style: {
          display: 'flex', alignItems: 'center', gap: compact ? 4 : 6,
          minWidth: 0, flex: '1 1 auto', overflow: 'hidden',
        },
        'aria-hidden': 'true',
      }, [
        // The currency glyph stays visible in both the wide and rail layouts.
        h('span', {
          key: 'glyph',
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: compact ? 12 : 14, flex: 'none',
            fontSize: compact ? 12 : 14, fontWeight: 600, lineHeight: 1, color: TOKENS.label2,
          },
        }, '¥'),
        h('span', { key: 'balances', style: S.footerBalances }, [
          h('span', { key: 'ds', style: S.footerBalanceLine },
            h('span', { style: Object.assign({}, S.footerBalanceProvider, { color: TOKENS.dsAccent }) }, t('footer.ds') + ' '),
            h('span', null, dsText)),
          h('span', {
            key: 'ulm',
            style: ulmLow ? Object.assign({}, S.footerBalanceLine, { color: TOKENS.danger }) : S.footerBalanceLine,
          },
            h('span', { style: Object.assign({}, S.footerBalanceProvider, { color: TOKENS.ulmAccent }) }, t('footer.ulm') + ' '),
            h('span', null, ulmText)),
        ]),
      ]) : h('span', {
        // Rail mode has no room for text; keep the currency glyph.
        'aria-hidden': 'true',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, flex: 'none',
          fontSize: 16, fontWeight: 600, lineHeight: 1,
        },
      }, '¥'))
    }

    /** The global main-panel page: balance cards, filters, summary, chart, tables. */
    function UsagePage(props) {
      const { t } = props
      const back = typeof props.onBack === 'function' ? props.onBack : noop

      const [phase, setPhase] = useState('loading')
      const [status, setStatus] = useState(null)
      const [bootError, setBootError] = useState(null)
      const [staleError, setStaleError] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [refreshError, setRefreshError] = useState(null)
      const [allTime, setAllTime] = useState(null)
      const [localUsage, setLocalUsage] = useState(null)
      const [view, setView] = useState({ data: null, loading: false, error: null })
      const [chartTip, setChartTip] = useState(null)
      const [preset, setPreset] = useState('all')
      const [keyFilter, setKeyFilter] = useState('')
      const [modelFilter, setModelFilter] = useState('')
      const [customFrom, setCustomFrom] = useState('')
      const [customTo, setCustomTo] = useState('')
      const [customError, setCustomError] = useState('')

      const aliveRef = useRef(true)
      const viewSeqRef = useRef(0)
      const refreshBusyRef = useRef(false)
      /** Latest committed filter state, read by async paths that outlive a render. */
      const filtersRef = useRef({ preset: 'all', customFrom: '', customTo: '', keyFilter: '', modelFilter: '' })
      filtersRef.current = { preset, customFrom, customTo, keyFilter, modelFilter }
      /** Latest all-history payload, read by async paths that outlive a render. */
      const allTimeRef = useRef(null)

      // A Darwin transparent titlebar overlays the frame; Windows/Linux pad it.
      // The center column already starts below the titlebar, so keep this modest.
      const headerPaddingTop = useMemo(() => {
        if (typeof document === 'undefined' || typeof document.documentElement.getAttribute !== 'function') return 20
        return document.documentElement.getAttribute('data-platform') === 'darwin'
          ? 'calc(20px + var(--dsh-frame-top-clearance, 0px))'
          : 20
      }, [])

      useEffect(() => {
        aliveRef.current = true
        boot()
        return () => {
          aliveRef.current = false
        }
        // Boot once per mount; the panel unmounts when another main panel is selected.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Keep the balance cards fresh while the panel is open: re-read the status
      // payload about every two hours (the scheduler's cadence) without touching
      // the usage history that stays valid for the cached dataset.
      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        let alive = true
        const refreshBalancesOnly = async () => {
          try {
            const next = await fetchStatus({ light: true })
            if (!alive) return
            setStatus(next)
            setStaleError(next.error || null)
            // Session logs can grow between panel loads; refresh the local fold too.
            void loadLocalUsage()
          } catch (error) {
            void error
          }
        }
        const timer = window.setInterval(() => { void refreshBalancesOnly() }, BALANCES_AUTO_REFRESH_MS)
        const onVisible = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refreshBalancesOnly()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          window.clearInterval(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        }
        // Mount-only cadence; balances-only refresh keeps the history untouched.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      function currentFilters() {
        return Object.assign({}, filtersRef.current)
      }
      async function loadAllTime() {
        const data = await fetchOverview({})
        if (aliveRef.current) {
          allTimeRef.current = data
          setAllTime(data)
        }
        return data
      }
      /** UncensoredLLM token usage from local Session logs for the active range. */
      async function loadLocalUsage(nextFilters) {
        const filters = nextFilters || currentFilters()
        const range = rangeForPreset(filters.preset, filters.customFrom, filters.customTo)
        try {
          const data = await fetchLocalUsage({ from: range.from, to: range.to })
          if (aliveRef.current) setLocalUsage(data)
        } catch (error) {
          if (aliveRef.current) setLocalUsage(null)
        }
      }
      /**
       * Fetch the overview for one filter set. All-time-equivalent requests reuse
       * the already loaded all-history payload instead of hitting the route again.
       */
      async function reloadView(nextFilters) {
        const filters = nextFilters || currentFilters()
        const range = rangeForPreset(filters.preset, filters.customFrom, filters.customTo)
        const isAllTime = !range.from && !filters.keyFilter && !filters.modelFilter
        const sequence = ++viewSeqRef.current
        setChartTip(null)
        setView((previous) => ({ data: previous.data, loading: true, error: null }))
        // The local relay-usage fold is independent of the DeepSeek overview.
        void loadLocalUsage(filters)
        const cachedAllTime = allTimeRef.current
        if (isAllTime && cachedAllTime !== null) {
          if (aliveRef.current && sequence === viewSeqRef.current) {
            setView({ data: cachedAllTime, loading: false, error: null })
          }
          return
        }
        try {
          const data = await fetchOverview({ from: range.from, to: range.to, key: filters.keyFilter, model: filters.modelFilter })
          if (!aliveRef.current || sequence !== viewSeqRef.current) return
          setView({ data, loading: false, error: null })
        } catch (error) {
          if (!aliveRef.current || sequence !== viewSeqRef.current) return
          if (errorCode(error) === 'signed_out') {
            setPhase('signed_out')
            setBootError(error)
            return
          }
          setView({ data: null, loading: false, error })
        }
      }
      /** Poll the status route while the first full sync is running, then load data. */
      async function waitForFirstSync() {
        for (let attempt = 0; attempt < SYNC_POLL_MAX; attempt += 1) {
          await delay(SYNC_POLL_MS)
          if (!aliveRef.current) return
          let next
          try {
            next = await fetchStatus()
          } catch (error) {
            continue
          }
          if (!aliveRef.current) return
          setStatus(next)
          setStaleError(next.error || null)
          if (next.signedIn === false) {
            setPhase('signed_out')
            return
          }
          if (next.syncing === true) continue
          try {
            await loadAllTime()
            await reloadView()
          } catch (error) {
            if (!aliveRef.current) return
            setBootError(error)
            setPhase(errorCode(error) === 'signed_out' ? 'signed_out' : 'error')
            return
          }
          if (aliveRef.current) setPhase('ready')
          return
        }
        if (!aliveRef.current) return
        setBootError(new UsageRequestError('sync_timeout'))
        setPhase('error')
      }
      async function boot() {
        setPhase('loading')
        setBootError(null)
        setRefreshError(null)
        setStaleError(null)
        let next
        try {
          next = await fetchStatus()
        } catch (error) {
          if (!aliveRef.current) return
          setStatus(null)
          setBootError(error)
          setPhase(errorCode(error) === 'signed_out' ? 'signed_out' : 'error')
          return
        }
        if (!aliveRef.current) return
        setStatus(next)
        setStaleError(next.error || null)
        if (next.signedIn === false) {
          setPhase('signed_out')
          return
        }
        if (next.syncing === true && next.lastSync === null) {
          setPhase('syncing')
          await waitForFirstSync()
          return
        }
        try {
          await loadAllTime()
        } catch (error) {
          if (!aliveRef.current) return
          setBootError(error)
          setPhase(errorCode(error) === 'signed_out' ? 'signed_out' : 'error')
          return
        }
        await reloadView()
        if (!aliveRef.current) return
        setPhase('ready')
      }
      async function onRefresh() {
        if (refreshBusyRef.current) return
        refreshBusyRef.current = true
        setRefreshing(true)
        setRefreshError(null)
        try {
          await postRefresh()
          if (!aliveRef.current) return
          const next = await fetchStatus()
          if (!aliveRef.current) return
          setStatus(next)
          setStaleError(next.error || null)
          if (next.signedIn === false) {
            setPhase('signed_out')
            return
          }
          if (next.syncing === true && next.lastSync === null) {
            setPhase('syncing')
            await waitForFirstSync()
            return
          }
          await loadAllTime()
          await reloadView()
          if (aliveRef.current) setPhase('ready')
        } catch (error) {
          if (!aliveRef.current) return
          if (errorCode(error) === 'signed_out') {
            setPhase('signed_out')
            setBootError(error)
          } else {
            setRefreshError(error)
          }
        } finally {
          refreshBusyRef.current = false
          if (aliveRef.current) setRefreshing(false)
        }
      }

      function onPresetChange(event) {
        const value = event.target.value
        setPreset(value)
        setCustomError('')
        if (value === 'custom') {
          // Seed the draft inputs from the current range; only 应用 commits them.
          if (!customFrom || !customTo) {
            const range = rangeForPreset(preset, customFrom, customTo)
            const fallback = range.from
              ? { from: range.from, to: range.to }
              : { from: addUtcDays(utcToday(), -6), to: utcToday() }
            setCustomFrom(fallback.from)
            setCustomTo(fallback.to)
          }
          return
        }
        const next = Object.assign(currentFilters(), { preset: value })
        filtersRef.current = next
        if (phase === 'ready') reloadView(next)
      }
      function onKeyChange(event) {
        const value = event.target.value
        setKeyFilter(value)
        const next = Object.assign(currentFilters(), { keyFilter: value })
        filtersRef.current = next
        if (phase === 'ready') reloadView(next)
      }
      function onModelChange(event) {
        const value = event.target.value
        setModelFilter(value)
        const next = Object.assign(currentFilters(), { modelFilter: value })
        filtersRef.current = next
        if (phase === 'ready') reloadView(next)
      }
      function onApplyRange() {
        if (!customFrom || !customTo) {
          setCustomError('error.rangeRequired')
          return
        }
        if (customFrom > customTo) {
          setCustomError('error.range')
          return
        }
        setCustomError('')
        const next = Object.assign(currentFilters(), { preset: 'custom', customFrom, customTo })
        filtersRef.current = next
        if (phase === 'ready') reloadView(next)
      }

      const describeError = (error) => t(errorKey(error))
      // Instant chart tooltip (native `title` waits about a second, and the
      // user wants the day's tokens and spend without that delay).
      const hideChartTip = () => setChartTip(null)
      function showChartTip(event, title, rows) {
        if (typeof window === 'undefined') return
        const width = 260
        const height = 30 + rows.length * 19
        const left = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - width - 8))
        const top = Math.max(8, Math.min(event.clientY + 14, window.innerHeight - height - 8))
        setChartTip({ left, top, title, rows })
      }
      function renderChartTip() {
        if (chartTip === null) return null
        return h('div', { style: Object.assign({}, S.chartTip, { left: chartTip.left, top: chartTip.top }), role: 'tooltip' },
          h('div', { style: S.chartTipTitle }, chartTip.title),
          chartTip.rows.map((row, index) => h('div', { key: index, style: S.chartTipRow },
            h('span', { style: S.chartTipLabel },
              row.color === undefined ? null : h('span', { style: Object.assign({}, S.chartTipDot, { background: row.color }) }),
              row.label),
            h('span', { style: S.chartTipValue }, row.value))))
      }
      /** Rows for one DS day: tokens, spend and requests. */
      function dsDayTipRows(day) {
        const cost = Number(day.cost)
        return [
          { label: t('summary.tokens'), value: formatInteger(day.tokens), color: TOKENS.dsAccent },
          { label: t('summary.cost'), value: Number.isFinite(cost) ? formatMoney(cost, viewCurrency) : '—' },
          { label: t('summary.requests'), value: t('unit.times', { value: formatInteger(day.requests) }) },
        ]
      }
      const balance = status !== null && status.balance !== null && typeof status.balance === 'object' ? status.balance : null
      const balances = status !== null && status.balances !== null && typeof status.balances === 'object' ? status.balances : null
      const dsBalance = balances !== null && balances.deepseek !== null && typeof balances.deepseek === 'object' ? balances.deepseek : balance
      const ulm = balances !== null && balances.ulm !== null && typeof balances.ulm === 'object' ? balances.ulm : null
      const ulmSub = ulm === null
        ? t('card.ulmPending')
        : ulm.available === null
          ? t('card.ulmUnavailable')
          : ulm.low === true
            ? t('card.ulmLow')
            : t('card.ulmSub', { time: formatDateTime(ulm.updatedAt) || t('time.never') })
      const totals = allTime !== null && allTime.totals !== null && typeof allTime.totals === 'object' ? allTime.totals : null
      const currency = (allTime !== null && typeof allTime.currency === 'string' ? allTime.currency : null)
        || (balance !== null && typeof balance.currency === 'string' ? balance.currency : null)
        || 'CNY'
      const accountLine = status !== null && status.signedIn === true
        ? (status.account !== null && typeof status.account === 'object' && typeof status.account.name === 'string' && status.account.name !== ''
          ? t('account.signedInAs', { name: status.account.name })
          : t('account.generic'))
        : null
      const syncLine = status === null
        ? null
        : typeof status.lastSync === 'number'
          ? t('updatedAt', { time: formatDateTime(status.lastSync) || t('time.never') })
          : t('time.never')
      const syncingNow = status !== null && status.syncing === true
      const refreshDisabled = refreshing || phase === 'loading' || phase === 'syncing' || phase === 'signed_out' || phase === 'error'
      const keys = status !== null && Array.isArray(status.keys) ? status.keys : []
      const models = status !== null && Array.isArray(status.models) ? status.models : []
      const keyOptions = keyFilter !== '' && keys.indexOf(keyFilter) === -1 ? [keyFilter].concat(keys) : keys
      const modelOptions = modelFilter !== '' && models.indexOf(modelFilter) === -1 ? [modelFilter].concat(models) : models
      const viewData = view.data
      const viewCurrency = viewData !== null && typeof viewData.currency === 'string' ? viewData.currency : currency

      function renderHeader() {
        return h('header', { style: Object.assign({}, S.header, { paddingTop: headerPaddingTop }) },
          h('div', { style: S.headerMain },
            h('div', { style: S.titleRow },
              h(UiButton, {
                variant: 'ghost',
                onClick: back,
                testId: TID.back,
                ariaLabel: t('back'),
                title: t('back'),
                style: { paddingLeft: 0, paddingRight: 8 },
              }, h(ChevronLeftIcon, { size: 18 }), h('span', null, t('back'))),
              h('h1', { style: S.title }, t('panel.title')),
            ),
            h('div', { style: S.headerSub },
              accountLine === null ? null : h('span', null, accountLine),
              accountLine !== null && (syncLine !== null || syncingNow) ? h('span', { style: S.dot }, '·') : null,
              syncLine === null ? null : h('span', null, syncLine),
              syncingNow ? h('span', { style: S.dot }, '·') : null,
              syncingNow ? h('span', null, t('refreshing')) : null),
          ),
          h('div', { style: S.headerActions },
            h(UiButton, {
              variant: 'outline',
              onClick: onRefresh,
              disabled: refreshDisabled,
              testId: TID.refresh,
              ariaLabel: t('refresh'),
              title: t('refresh'),
            }, h(RefreshIcon, { size: 16, spinning: refreshing }), h('span', null, refreshing ? t('refreshing') : t('refresh')))),
        )
      }

      function renderBanner(message, danger) {
        return h('div', { style: danger ? Object.assign({}, S.banner, S.bannerDanger) : S.banner, role: 'status' },
          h('span', { style: danger ? Object.assign({}, S.bannerIcon, { color: TOKENS.danger }) : S.bannerIcon }, h(WarningIcon, { size: 16 })),
          h('span', { style: S.bannerText }, message))
      }

      function summaryStat(label, value, key, color) {
        return h('div', { key, style: S.summaryStat },
          h('span', { style: S.summaryLabel }, label),
          h('span', { style: color === undefined ? S.summaryValue : Object.assign({}, S.summaryValue, { color }) }, value))
      }
      function legendItem(color, label) {
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 10, height: 10, borderRadius: 3, background: color, flex: 'none' } }),
          label)
      }
      function renderSummary() {
        if (viewData === null) return null
        const dataTotals = viewData.totals !== null && typeof viewData.totals === 'object' ? viewData.totals : { tokens: 0, cost: 0, requests: 0 }
        const period = viewData.from && viewData.to ? viewData.from + ' ~ ' + viewData.to : t('summary.allTime')
        return h('div', { style: S.summary, 'data-testid': TID.summary },
          summaryStat(t('summary.tokens'), formatInteger(dataTotals.tokens), 'tokens', TOKENS.dsAccent),
          summaryStat(t('summary.cost'), formatMoney(dataTotals.cost, viewCurrency), 'cost'),
          summaryStat(t('summary.requests'), t('unit.times', { value: formatInteger(dataTotals.requests) }), 'requests'),
          summaryStat(t('summary.period'), period, 'period'),
          view.loading ? h('span', { style: S.sectionHint, key: 'loading' }, t('refreshing')) : null)
      }
      function renderChart() {
        const days = viewData !== null && Array.isArray(viewData.byDay) ? viewData.byDay : []
        if (days.length === 0) return h('div', { style: S.chartEmpty, 'data-testid': TID.chart }, t('chart.empty'))
        const sorted = days.slice().sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
        const max = sorted.reduce((peak, day) => Math.max(peak, Number(day.tokens) || 0), 0)
        return h('div', { 'data-testid': TID.chart },
          h('div', { style: S.chart, role: 'img', 'aria-label': t('chart.title') },
            sorted.map((day) => {
              const tokens = Number(day.tokens) || 0
              const ratio = max > 0 ? tokens / max : 0
              const tip = dsDayTipRows(day)
              return h('div', {
                key: day.date,
                style: Object.assign({}, S.chartBar, {
                  height: (ratio * 100) + '%',
                  background: 'linear-gradient(180deg, #6B85FF, #4D6BFE)',
                }),
                'aria-label': t('chart.dayHint', { date: day.date, tokens: formatInteger(tokens) }),
                onMouseEnter: (event) => showChartTip(event, day.date, tip),
                onMouseMove: (event) => showChartTip(event, day.date, tip),
                onMouseLeave: hideChartTip,
              })
            })),
          h('div', { style: S.chartAxis },
            h('span', null, sorted[0].date),
            h('span', null, sorted[sorted.length - 1].date)))
      }
      function renderKeyTable() {
        const rows = viewData !== null && Array.isArray(viewData.byKey) ? viewData.byKey : []
        return h(Section, { title: t('table.byKey') },
          h('div', { style: S.tableWrap },
            h('table', { style: S.table, 'data-testid': TID.keyTable },
              h('thead', null, h('tr', null,
                h('th', { style: S.th }, t('column.key')),
                h('th', { style: S.thNum }, t('column.tokens')),
                h('th', { style: S.thNum }, t('column.cost')),
                h('th', { style: S.thNum }, t('column.requests')))),
              h('tbody', null,
                rows.length === 0
                  ? h('tr', null, h('td', { colSpan: 4, style: S.tdEmpty }, t('table.empty')))
                  : rows.map((row) => h('tr', { key: row.key },
                    h('td', { style: S.td },
                      h('div', { style: S.cellMain }, row.key),
                      row.maskedKey ? h('div', { style: S.cellSub }, row.maskedKey) : null),
                    h('td', { style: S.tdNum }, formatInteger(row.tokens)),
                    h('td', { style: S.tdNum }, formatMoney(row.cost, viewCurrency)),
                    h('td', { style: S.tdNum }, formatInteger(row.requests))))))))
      }
      function renderModelTable() {
        const rows = viewData !== null && Array.isArray(viewData.byModel) ? viewData.byModel : []
        return h(Section, { title: t('table.byModel') },
          h('div', { style: S.tableWrap },
            h('table', { style: S.table, 'data-testid': TID.modelTable },
              h('thead', null, h('tr', null,
                h('th', { style: S.th }, t('column.model')),
                h('th', { style: S.thNum }, t('column.tokens')),
                h('th', { style: S.thNum }, t('column.cost')),
                h('th', { style: S.thNum }, t('column.requests')))),
              h('tbody', null,
                rows.length === 0
                  ? h('tr', null, h('td', { colSpan: 4, style: S.tdEmpty }, t('table.empty')))
                  : rows.map((row) => h('tr', { key: row.model },
                    h('td', { style: S.td },
                      h('div', { style: S.cellMain }, row.model === MODEL_TOOL ? t('model.tool') : row.model)),
                    h('td', { style: S.tdNum }, formatInteger(row.tokens)),
                    h('td', { style: S.tdNum }, formatMoney(row.cost, viewCurrency)),
                    h('td', { style: S.tdNum }, formatInteger(row.requests))))))))
      }
      function renderDailyTable() {
        const rows = viewData !== null && Array.isArray(viewData.byDay) ? viewData.byDay : []
        const newestFirst = rows.slice().sort((left, right) => left.date < right.date ? 1 : left.date > right.date ? -1 : 0)
        return h(Section, { title: t('table.byDay'), hint: t('filter.utcHint') },
          h('div', { style: Object.assign({}, S.tableWrap, { maxHeight: 360 }) },
            h('table', { style: S.table, 'data-testid': TID.dailyTable },
              h('thead', null, h('tr', null,
                h('th', { style: S.th }, t('column.date')),
                h('th', { style: S.thNum }, t('column.tokens')),
                h('th', { style: S.thNum }, t('column.cost')),
                h('th', { style: S.thNum }, t('column.requests')))),
              h('tbody', null,
                newestFirst.length === 0
                  ? h('tr', null, h('td', { colSpan: 4, style: S.tdEmpty }, t('table.empty')))
                  : newestFirst.map((row) => h('tr', { key: row.date },
                    h('td', { style: S.td }, row.date),
                    h('td', { style: S.tdNum }, formatInteger(row.tokens)),
                    h('td', { style: S.tdNum }, formatMoney(row.cost, viewCurrency)),
                    h('td', { style: S.tdNum }, formatInteger(row.requests))))))))
      }
      /** Combined DeepSeek + UncensoredLLM token totals pinned to the top. */
      function renderCombinedOverview() {
        const dsTotals = viewData !== null && viewData.totals !== null && typeof viewData.totals === 'object' ? viewData.totals : null
        const ulmTotals = localUsage !== null && localUsage.totals !== null && typeof localUsage.totals === 'object' ? localUsage.totals : null
        if (dsTotals === null && ulmTotals === null) return null
        const dsTokens = dsTotals === null ? 0 : Number(dsTotals.tokens) || 0
        const ulmTokens = ulmTotals === null ? 0 : Number(ulmTotals.tokens) || 0
        const dsRequests = dsTotals === null ? 0 : Number(dsTotals.requests) || 0
        const ulmRequests = ulmTotals === null ? 0 : Number(ulmTotals.requests) || 0
        const period = viewData !== null && typeof viewData.from === 'string' && typeof viewData.to === 'string'
          ? viewData.from + ' ~ ' + viewData.to
          : t('summary.allTime')
        // Merge both daily series so one bar shows how each day splits.
        const days = new Map()
        if (viewData !== null && Array.isArray(viewData.byDay)) {
          for (const day of viewData.byDay) {
            const cost = Number(day.cost)
            days.set(day.date, {
              ds: Number(day.tokens) || 0,
              ulm: 0,
              dsCost: Number.isFinite(cost) ? cost : null,
            })
          }
        }
        if (localUsage !== null && Array.isArray(localUsage.byDay)) {
          for (const day of localUsage.byDay) {
            const ulm = Number(day.tokens) || 0
            const existing = days.get(day.date)
            if (existing === undefined) days.set(day.date, { ds: 0, ulm, dsCost: null })
            else existing.ulm = ulm
          }
        }
        const sorted = [...days.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))
        const max = sorted.reduce((peak, entry) => Math.max(peak, entry[1].ds + entry[1].ulm), 0)
        return h(Section, { title: t('combined.title'), hint: t('combined.hint') },
          h('div', {
            style: Object.assign({}, S.summary, { background: 'linear-gradient(90deg, rgba(77, 107, 254, 0.08), rgba(227, 154, 45, 0.10))' }),
            'data-testid': 'usage-combined-summary',
          },
            summaryStat(t('combined.totalTokens'), formatInteger(dsTokens + ulmTokens), 'total'),
            summaryStat(t('combined.deepseek'), formatInteger(dsTokens), 'ds', TOKENS.dsAccent),
            summaryStat(t('combined.uncensored'), formatInteger(ulmTokens), 'ulm', TOKENS.ulmAccent),
            summaryStat(t('combined.totalRequests'), t('unit.times', { value: formatInteger(dsRequests + ulmRequests) }), 'requests'),
            summaryStat(t('summary.period'), period, 'period')),
          sorted.length === 0 ? null : h('div', { style: { marginTop: 16 } },
            h('div', { style: Object.assign({}, S.chart, { gap: 3, justifyContent: 'flex-start' }), role: 'img', 'aria-label': t('combined.title') },
              sorted.map((entry) => {
                const date = entry[0]
                const ds = entry[1].ds
                const ulm = entry[1].ulm
                const total = ds + ulm
                const ratio = max > 0 ? total / max : 0
                const ulmShare = total > 0 ? (ulm / total) * 100 : 0
                const tip = [
                  { label: t('combined.totalTokens'), value: formatInteger(total) },
                  { label: t('combined.deepseek'), value: formatInteger(ds), color: TOKENS.dsAccent },
                  {
                    label: t('chart.dsCost'),
                    value: entry[1].dsCost === null ? '—' : formatMoney(entry[1].dsCost, viewCurrency),
                  },
                  { label: t('combined.uncensored'), value: formatInteger(ulm), color: TOKENS.ulmAccent },
                ]
                return h('div', {
                  key: date,
                  'aria-label': t('chart.dayHint', { date, tokens: formatInteger(total) }),
                  onMouseEnter: (event) => showChartTip(event, date, tip),
                  onMouseMove: (event) => showChartTip(event, date, tip),
                  onMouseLeave: hideChartTip,
                  style: Object.assign({}, S.chartBar, {
                    height: (ratio * 100) + '%', maxWidth: 36, flex: '1 1 0',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                    overflow: 'hidden', background: 'transparent',
                  }),
                }, [
                  h('div', { key: 'ulm', style: { height: ulmShare + '%', background: TOKENS.ulmAccent } }),
                  h('div', { key: 'ds', style: { flex: '1 1 auto', background: 'linear-gradient(180deg, #6B85FF, #4D6BFE)' } }),
                ])
              })),
            h('div', { style: S.chartAxis },
              h('span', null, sorted[0][0]),
              h('span', null, sorted[sorted.length - 1][0])),
            h('div', { style: { marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', fontSize: 12, lineHeight: '18px', color: TOKENS.label3 } },
              legendItem(TOKENS.dsAccent, t('combined.deepseek')),
              legendItem(TOKENS.ulmAccent, t('combined.uncensored')),
              h('span', { style: { color: TOKENS.label3 } }, t('combined.legend')))))
      }
      /** UncensoredLLM token usage folded from local Session logs. */
      function renderLocalUsage() {
        if (localUsage === null || typeof localUsage !== 'object') return null
        const usageTotals = localUsage.totals !== null && typeof localUsage.totals === 'object' ? localUsage.totals : null
        if (usageTotals === null || Number(usageTotals.requests) <= 0) return null
        const days = Array.isArray(localUsage.byDay) ? localUsage.byDay.slice() : []
        const models = Array.isArray(localUsage.byModel) ? localUsage.byModel : []
        const period = typeof localUsage.firstDate === 'string' && typeof localUsage.lastDate === 'string'
          ? localUsage.firstDate + ' ~ ' + localUsage.lastDate
          : t('summary.allTime')
        const hint = t('local.hint') + (typeof localUsage.sessions === 'number' && localUsage.sessions > 0
          ? ' · ' + t('local.sessions', { count: formatInteger(localUsage.sessions) })
          : '')
        const sorted = days.sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
        const max = sorted.reduce((peak, day) => Math.max(peak, Number(day.tokens) || 0), 0)
        return h(Section, { title: t('provider.uncensored'), hint, accent: 'ulm' },
          h('div', { style: S.summary, 'data-testid': 'usage-local-summary' },
            summaryStat(t('summary.tokens'), formatInteger(usageTotals.tokens), 'tokens', TOKENS.ulmAccent),
            summaryStat(t('column.input'), formatInteger(usageTotals.input), 'input'),
            summaryStat(t('column.output'), formatInteger(usageTotals.output), 'output'),
            summaryStat(t('column.cache'), formatInteger(usageTotals.cache), 'cache'),
            summaryStat(t('summary.requests'), t('unit.times', { value: formatInteger(usageTotals.requests) }), 'requests'),
            summaryStat(t('summary.period'), period, 'period')),
          sorted.length === 0 ? null : h('div', { style: { marginTop: 16 } },
            h('div', { style: Object.assign({}, S.chart, { gap: 4, justifyContent: 'flex-start' }), role: 'img', 'aria-label': t('local.title') },
              sorted.map((day) => {
                const tokens = Number(day.tokens) || 0
                const ratio = max > 0 ? tokens / max : 0
                const tip = [
                  { label: t('summary.tokens'), value: formatInteger(tokens), color: TOKENS.ulmAccent },
                  { label: t('summary.cost'), value: t('chart.costUnavailable') },
                  { label: t('summary.requests'), value: t('unit.times', { value: formatInteger(day.requests) }) },
                ]
                return h('div', {
                  key: day.date,
                  'aria-label': t('chart.dayHint', { date: day.date, tokens: formatInteger(tokens) }),
                  onMouseEnter: (event) => showChartTip(event, day.date, tip),
                  onMouseMove: (event) => showChartTip(event, day.date, tip),
                  onMouseLeave: hideChartTip,
                  style: Object.assign({}, S.chartBar, {
                    height: (ratio * 100) + '%', maxWidth: 36, flex: '1 1 0',
                    background: 'linear-gradient(180deg, #F3BF63, #E39A2D)',
                  }),
                })
              })),
            h('div', { style: S.chartAxis },
              h('span', null, sorted[0].date),
              h('span', null, sorted[sorted.length - 1].date))),
          h('div', { style: Object.assign({}, S.tableWrap, { marginTop: 16 }) },
            h('table', { style: S.table, 'data-testid': 'usage-local-model-table' },
              h('thead', null, h('tr', null,
                h('th', { style: S.th }, t('column.model')),
                h('th', { style: S.thNum }, t('column.tokens')),
                h('th', { style: S.thNum }, t('column.input')),
                h('th', { style: S.thNum }, t('column.output')),
                h('th', { style: S.thNum }, t('column.cache')),
                h('th', { style: S.thNum }, t('column.requests')))),
              h('tbody', null,
                models.length === 0
                  ? h('tr', null, h('td', { colSpan: 6, style: S.tdEmpty }, t('table.empty')))
                  : models.map((row) => h('tr', { key: row.model },
                    h('td', { style: S.td }, h('div', { style: S.cellMain }, row.model)),
                    h('td', { style: S.tdNum }, formatInteger(row.tokens)),
                    h('td', { style: S.tdNum }, formatInteger(row.input)),
                    h('td', { style: S.tdNum }, formatInteger(row.output)),
                    h('td', { style: S.tdNum }, formatInteger(row.cache)),
                    h('td', { style: S.tdNum }, formatInteger(row.requests))))))))
      }
      function renderCards() {
        return h('div', { style: S.cards },
          h(StatCard, {
            label: t('card.balance'),
            value: dsBalance === null ? '—' : formatBalance(dsBalance.total, dsBalance.currency || currency),
            sub: dsBalance === null ? t('card.balanceUnavailable') : t('card.bonus', { amount: formatBalance(dsBalance.bonus, dsBalance.currency || currency) }),
            accent: 'ds',
          }),
          h(StatCard, {
            label: t('card.ulmBalance'),
            value: ulm === null || ulm.available === null ? '—' : formatUsd(ulm.available),
            sub: ulmSub,
            danger: ulm !== null && ulm.low === true,
            accent: 'ulm',
          }))
      }
      function renderFilterBar() {
        const hint = allTime !== null && typeof allTime.firstDate === 'string' && allTime.firstDate !== ''
          ? t('filter.sinceFirst', { date: allTime.firstDate })
          : null
        return h('div', { style: S.filterBar },
          h(Field, { label: t('filter.range') },
            h('select', {
              'data-testid': TID.preset,
              value: preset,
              onChange: onPresetChange,
              style: S.control,
              'aria-label': t('filter.range'),
            }, PRESETS.map((item) => h('option', { key: item.id, value: item.id }, t(item.labelKey))))),
          preset === 'custom' ? h(Field, { label: t('filter.from') },
            h('input', {
              type: 'date',
              'data-testid': TID.rangeFrom,
              value: customFrom,
              onChange: (event) => setCustomFrom(event.target.value),
              style: S.control,
              'aria-label': t('filter.from'),
            })) : null,
          preset === 'custom' ? h(Field, { label: t('filter.to') },
            h('input', {
              type: 'date',
              'data-testid': TID.rangeTo,
              value: customTo,
              onChange: (event) => setCustomTo(event.target.value),
              style: S.control,
              'aria-label': t('filter.to'),
            })) : null,
          preset === 'custom' ? h(UiButton, { variant: 'primary', onClick: onApplyRange, testId: TID.applyRange }, t('filter.apply')) : null,
          h(Field, { label: t('filter.key') },
            h('select', {
              'data-testid': TID.keySelect,
              value: keyFilter,
              onChange: onKeyChange,
              style: S.control,
              'aria-label': t('filter.key'),
            },
              h('option', { value: '' }, t('filter.all')),
              keyOptions.map((name) => h('option', { key: name, value: name }, name)))),
          h(Field, { label: t('filter.model') },
            h('select', {
              'data-testid': TID.modelSelect,
              value: modelFilter,
              onChange: onModelChange,
              style: S.control,
              'aria-label': t('filter.model'),
            },
              h('option', { value: '' }, t('filter.all')),
              modelOptions.map((name) => h('option', { key: name, value: name }, name === MODEL_TOOL ? t('model.tool') : name)))),
          h('div', { style: S.filterHint },
            h('span', null, t('filter.utcHint')),
            preset === 'all' && hint !== null ? h('span', { style: S.dot }, '·') : null,
            preset === 'all' && hint !== null ? h('span', null, hint) : null),
          customError === '' ? null : h('div', { style: S.fieldError }, t(customError)))
      }

      let body
      if (phase === 'loading') {
        body = h(StatusPanel, { icon: h(Spinner), title: t('loading') })
      } else if (phase === 'syncing') {
        body = h(StatusPanel, { icon: h(Spinner), title: t('syncing.title'), hint: t('syncing.hint') })
      } else if (phase === 'error') {
        body = h(StatusPanel, {
          icon: h(WarningIcon, { size: 22 }),
          danger: true,
          title: t('error.title'),
          hint: describeError(bootError),
        }, h(UiButton, { variant: 'outline', onClick: boot }, t('error.retry')))
      } else if (phase === 'signed_out') {
        body = h(StatusPanel, {
          icon: h(WalletIcon, { size: 22 }),
          title: t('signedOut.title'),
          hint: t('signedOut.hint'),
        }, h(UiButton, { variant: 'outline', onClick: boot }, t('signedOut.recheck')))
      } else {
        body = h('div', null,
          staleError === null ? null : renderBanner(t('status.stalePrefix', { message: describeError(staleError) }), false),
          refreshError === null ? null : renderBanner(describeError(refreshError), true),
          // Merged DeepSeek + UncensoredLLM totals occupy the very top of the page.
          renderCombinedOverview(),
          renderCards(),
          h('div', { style: Object.assign({}, S.sectionHint, { marginTop: 8 }) }, t('balance.providersNote')),
          renderFilterBar(),
          view.error !== null && viewData === null
            ? h(StatusPanel, {
              icon: h(WarningIcon, { size: 22 }),
              danger: true,
              title: t('error.title'),
              hint: describeError(view.error),
            }, h(UiButton, { variant: 'outline', onClick: () => reloadView() }, t('error.retry')))
            : h('div', null,
              h(Section, { title: t('provider.deepseek'), hint: t('provider.deepseekHint'), accent: 'ds' },
                renderSummary(),
                h(Section, { title: t('chart.title'), hint: t('filter.utcHint') }, renderChart()),
                renderKeyTable(),
                renderModelTable(),
                renderDailyTable()),
              renderLocalUsage()))
      }

      return h('section', { style: S.page, 'data-testid': TID.root, 'aria-busy': phase === 'loading' || phase === 'syncing' || view.loading },
        h('div', { style: S.pageInner },
          renderHeader(),
          body,
          renderChartTip()))
    }

    /** Registers the sidebar-foot entry and the global usage panel. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'deepseek-usage: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'deepseek-usage-balance',
        order: 10,
        locale: NS,
        label: () => t('footer.label'),
        inject: () => ({ onSelect: () => ctx.layout.selectPanel(PANEL_ID) }),
      }, UsageFooterAction))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ onBack: () => ctx.layout.selectPanel(null) }),
      }, UsagePage))
    }

    return {
      inject: ['slots', 'layout', 'locale'],
      apply,
    }
  },
})
