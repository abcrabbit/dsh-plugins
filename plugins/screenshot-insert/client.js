/**
 * Browser half of the screenshot-insert bundle.
 *
 * Registers one light-green camera button in the composer's trailing control
 * list, immediately beside the profile's prompt-enhance action. A click asks
 * the Host half for a PNG of the screen:
 *
 * - Windows: the whole monitor is returned and a full-page overlay frames the
 *   region.
 * - macOS: the system selection already returned one region, so the annotation
 *   editor opens on it directly.
 *
 * Both paths then show the annotation editor where the operator marks the
 * capture with rectangles and arrows and confirms. Only the confirmed
 * annotated PNG is inserted into the composer as a runtime image draft
 * attachment; the draft's text and caret are never touched.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-screenshot-insert',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin's visible copy. */
    const NS = 'screenshotInsert'
    /** This module's identity; also the style tag owner and the route client. */
    const PACKAGE_ID = '@local/dsh-plugin-screenshot-insert'
    /** Host route answering the raw PNG of the cursor's monitor. */
    const CAPTURE_PATH = 'dsh-screenshot/capture'
    /** Host response header marking a PNG that is already one selected region. */
    const REGION_HEADER = 'x-dsh-capture-region'
    /** Style tag identity so repeated activation never stacks duplicates. */
    const STYLE_TAG_ID = PACKAGE_ID + '/screenshot-insert.css'
    /**
     * Client-side ceiling. macOS selection is interactive, so the request may
     * legitimately stay open while the operator frames the region; the Host
     * route owns the authoritative timeout.
     */
    const CLIENT_CAPTURE_TIMEOUT_MS = 300000
    /** How long one success or failure notice stays on screen. */
    const NOTICE_MS = 3200
    /** Smallest selection worth cropping, in displayed pixels. */
    const MIN_CROP_PX = 6
    /** Annotation ink; red reads on both light and dark captures. */
    const INK = '#ef4444'

    /** Visible copy owned by this plugin, simplified Chinese first. */
    const zh = {
      'action.capture': '截屏插入',
      'action.capturing': '正在截取屏幕',
      'hint': '框选屏幕区域，标注后插入输入框',
      'overlay.label': '截取屏幕区域',
      'overlay.annotateLabel': '截图标注',
      'overlay.hint': '拖动鼠标框选截图区域，Esc 取消',
      'overlay.processing': '正在插入截图…',
      'overlay.cancel': '取消',
      'tool.rect': '矩形',
      'tool.arrow': '箭头',
      'tool.undo': '撤销',
      'tool.clear': '清空',
      'tool.reselect': '重选',
      'tool.cancel': '取消',
      'tool.confirm': '确定',
      'editor.hint': '拖动绘制标注；Enter 确定，Esc 返回框选',
      'editor.hintRegion': '拖动绘制标注；Enter 确定，Esc 取消',
      'notice.inserted': '截图已插入输入框',
      'error.busy': '输入框暂时无法插入图片，请稍后重试',
      'error.unavailable': '截屏功能暂不可用',
      'error.captureFailed': '截屏失败，请重试',
      'error.insertFailed': '无法把截图插入输入框，请重试',
      'error.timeout': '截屏超时，请重试',
      'error.unauthorized': '当前页面无权使用截屏',
      'error.network': '无法连接到本地服务',
      'error.invalid': '截屏结果无法识别',
      'error.unsupported': '截屏图片格式不受支持',
    }

    const en = {
      'action.capture': 'Capture screen',
      'action.capturing': 'Capturing screen',
      'hint': 'Select a screen region, annotate it, then insert it into the composer',
      'overlay.label': 'Capture a screen region',
      'overlay.annotateLabel': 'Screenshot annotation',
      'overlay.hint': 'Drag to select a screen region; Escape cancels',
      'overlay.processing': 'Inserting screenshot…',
      'overlay.cancel': 'Cancel',
      'tool.rect': 'Rectangle',
      'tool.arrow': 'Arrow',
      'tool.undo': 'Undo',
      'tool.clear': 'Clear',
      'tool.reselect': 'Reselect',
      'tool.cancel': 'Cancel',
      'tool.confirm': 'Confirm',
      'editor.hint': 'Drag to annotate; Enter confirms, Escape goes back to framing',
      'editor.hintRegion': 'Drag to annotate; Enter confirms, Escape cancels',
      'notice.inserted': 'Screenshot inserted into the composer',
      'error.busy': 'The composer cannot accept an image right now. Try again.',
      'error.unavailable': 'Screenshot capture is unavailable',
      'error.captureFailed': 'Screen capture failed. Try again.',
      'error.insertFailed': 'The screenshot could not be inserted into the composer',
      'error.timeout': 'Screen capture timed out. Try again.',
      'error.unauthorized': 'This page is not allowed to capture the screen',
      'error.network': 'Could not reach the local service',
      'error.invalid': 'The captured image could not be read',
      'error.unsupported': 'The captured image format is not supported',
    }

    /**
     * Control geometry mirrors the shipped send circle (`.primary` in
     * InputBar.module.css): a 34px round control that keeps the same -2px seat
     * inside the composer's trailing group. Light green is the capture button's
     * own accent; the annotation overlay adds a dark toolbar above the capture.
     */
    const STYLES = [
      '.dshScreenshot_button{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;',
      'border:none;border-radius:999px;corner-shape:round;background:#86efac;color:#14532d;cursor:pointer;',
      'transition:background-color 100ms ease,box-shadow 100ms ease;transform:translateY(-2px)}',
      '@media (hover:hover){.dshScreenshot_button:hover:not(:disabled){background:#4ade80}}',
      '.dshScreenshot_button:active:not(:disabled){background:#22c55e;color:#052e16}',
      '.dshScreenshot_button:disabled{opacity:.4;cursor:default}',
      '.dshScreenshot_button.dshScreenshot_busy:disabled{opacity:1;cursor:progress}',
      '.dshScreenshot_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshScreenshot_spinner{width:16px;height:16px;border-radius:50%;box-sizing:border-box;',
      'border:2px solid rgba(20,83,45,.3);border-top-color:#14532d;',
      'animation:dshScreenshot_spin 800ms linear infinite}',
      '@media (prefers-reduced-motion:reduce){.dshScreenshot_spinner{animation-duration:2400ms}}',
      '@keyframes dshScreenshot_spin{to{transform:rotate(360deg)}}',
      '.dshScreenshot_overlay{position:fixed;inset:0;z-index:1300;box-sizing:border-box;display:flex;',
      'align-items:center;justify-content:center;padding:24px;background:rgba(2,6,23,.58);cursor:crosshair;',
      'user-select:none;-webkit-user-select:none;touch-action:none;outline:none}',
      '.dshScreenshot_stage{position:relative;line-height:0;border-radius:10px;overflow:hidden;',
      'box-shadow:0 24px 80px rgba(0,0,0,.55);max-width:100%;max-height:100%;cursor:crosshair}',
      '.dshScreenshot_image{display:block;max-width:calc(100vw - 48px);max-height:calc(100vh - 128px);',
      'width:auto;height:auto;background:#0f172a;user-select:none;-webkit-user-drag:none;pointer-events:none}',
      '.dshScreenshot_selection{position:absolute;pointer-events:none;border:1px solid rgba(134,239,172,.95);',
      'border-radius:2px;box-shadow:0 0 0 9999px rgba(2,6,23,.45)}',
      '.dshScreenshot_hint{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:1302;',
      'padding:7px 14px;border:1px solid rgba(148,163,184,.35);border-radius:999px;background:rgba(2,6,23,.82);',
      'color:#f8fafc;font:13px/18px var(--dsw-font-family,system-ui);white-space:nowrap;pointer-events:none;',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)}',
      '.dshScreenshot_cancel{position:fixed;top:18px;right:20px;z-index:1302;padding:6px 14px;cursor:pointer;',
      'border:1px solid rgba(148,163,184,.35);border-radius:8px;background:rgba(2,6,23,.82);color:#f8fafc;',
      'font:13px/18px var(--dsw-font-family,system-ui)}',
      '.dshScreenshot_cancel:hover{background:rgba(30,41,59,.95)}',
      '.dshScreenshot_toolbar{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:1302;',
      'box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;',
      'max-width:calc(100vw - 32px);padding:6px;border:1px solid rgba(148,163,184,.35);border-radius:12px;',
      'background:rgba(2,6,23,.9);box-shadow:0 8px 24px rgba(0,0,0,.4)}',
      '.dshScreenshot_tool{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
      'min-width:44px;height:46px;padding:0 8px;border:none;border-radius:8px;background:rgba(148,163,184,.12);',
      'color:#e2e8f0;cursor:pointer;font:11px/14px var(--dsw-font-family,system-ui);',
      'transition:background-color 100ms ease,color 100ms ease;box-sizing:border-box}',
      '@media (hover:hover){.dshScreenshot_tool:hover:not(:disabled){background:rgba(148,163,184,.26)}}',
      '.dshScreenshot_tool[aria-pressed="true"]{background:rgba(134,239,172,.22);color:#86efac}',
      '.dshScreenshot_tool:disabled{opacity:.4;cursor:default}',
      '.dshScreenshot_tool:focus-visible,.dshScreenshot_ghostTool:focus-visible,.dshScreenshot_primaryTool:focus-visible{',
      'outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshScreenshot_separator{width:1px;height:26px;margin:0 3px;background:rgba(148,163,184,.3)}',
      '.dshScreenshot_ghostTool{height:46px;padding:0 12px;border:1px solid rgba(148,163,184,.35);',
      'border-radius:8px;background:rgba(148,163,184,.08);color:#e2e8f0;cursor:pointer;box-sizing:border-box;',
      'font:13px/18px var(--dsw-font-family,system-ui)}',
      '@media (hover:hover){.dshScreenshot_ghostTool:hover:not(:disabled){background:rgba(148,163,184,.22)}}',
      '.dshScreenshot_ghostTool:disabled{opacity:.4;cursor:default}',
      '.dshScreenshot_primaryTool{display:flex;align-items:center;gap:6px;height:46px;padding:0 16px;',
      'border:none;border-radius:8px;background:#86efac;color:#14532d;cursor:pointer;box-sizing:border-box;',
      'font:600 13px/18px var(--dsw-font-family,system-ui)}',
      '@media (hover:hover){.dshScreenshot_primaryTool:hover:not(:disabled){background:#4ade80}}',
      '.dshScreenshot_primaryTool:active:not(:disabled){background:#22c55e}',
      '.dshScreenshot_primaryTool:disabled{opacity:.55;cursor:progress}',
      '.dshScreenshot_toolLabel{pointer-events:none;white-space:nowrap}',
      '.dshScreenshot_button svg,.dshScreenshot_button span,',
      '.dshScreenshot_tool svg,.dshScreenshot_tool span,',
      '.dshScreenshot_ghostTool svg,.dshScreenshot_ghostTool span,',
      '.dshScreenshot_primaryTool svg,.dshScreenshot_primaryTool span{pointer-events:none}',
      '.dshScreenshot_editor{position:relative;line-height:0;border-radius:10px;overflow:hidden;',
      'background:#0f172a;box-shadow:0 24px 80px rgba(0,0,0,.55);max-width:100%;max-height:100%}',
      '.dshScreenshot_annotationCanvas{display:block;background:#0f172a;cursor:crosshair;',
      'touch-action:none;user-select:none;-webkit-user-drag:none}',
      '.dshScreenshot_editorHint{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:1302;',
      'padding:7px 14px;border:1px solid rgba(148,163,184,.35);border-radius:999px;background:rgba(2,6,23,.82);',
      'color:#f8fafc;font:13px/18px var(--dsw-font-family,system-ui);white-space:nowrap;pointer-events:none;',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)}',
      '.dshScreenshot_toastLayer{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:1400;',
      'display:flex;justify-content:center;max-width:min(520px,calc(100vw - 32px));pointer-events:none}',
      '.dshScreenshot_toast{display:flex;align-items:center;gap:8px;padding:9px 14px;overflow-wrap:anywhere;',
      'border:1px solid rgba(134,239,172,.45);border-radius:999px;background:rgba(2,6,23,.9);color:#dcfce7;',
      'font:13px/18px var(--dsw-font-family,system-ui);box-shadow:0 8px 24px rgba(0,0,0,.35)}',
      '.dshScreenshot_toastError{border-color:rgba(248,113,113,.6);color:#fee2e2}',
      '.dshScreenshot_toastIcon{flex:none;font-weight:600}',
    ].join('')

    /** Host/Client failure code to localized notice key. */
    const NOTICE_BY_CODE = {
      'capture-busy': 'error.busy',
      'capture-failed': 'error.captureFailed',
      'capture-timeout': 'error.timeout',
      'capture-unavailable': 'error.unavailable',
      'insert-failed': 'error.insertFailed',
      'unsupported': 'error.unsupported',
      'unauthorized': 'error.unauthorized',
      'network': 'error.network',
      'invalid': 'error.invalid',
      'unavailable': 'error.unavailable',
      'busy': 'error.busy',
      'internal': 'error.insertFailed',
    }

    /** Failure carrying a stable code so visible copy can be localized. */
    class ScreenshotError extends Error {
      constructor(code, message) {
        super(message === undefined ? code : message)
        this.name = 'ScreenshotError'
        this.code = code
      }
    }

    /** Clamp one number into [min, max]. */
    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value
    }

    /** Normalize one two-corner drag into a non-negative rectangle. */
    function normalizeSelection(a, b) {
      return {
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      }
    }

    /** Load one image URL into an element and report its intrinsic size. */
    function loadImage(url) {
      return new Promise((resolvePromise, rejectPromise) => {
        const image = new Image()
        image.onload = () => {
          resolvePromise({ image, width: image.naturalWidth, height: image.naturalHeight })
        }
        image.onerror = () => { rejectPromise(new Error('the captured image could not be decoded')) }
        image.src = url
      })
    }

    /** Draw one already-decoded image into a canvas of its own natural size. */
    function buildCropCanvas(imageElement, width, height) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context === null) throw new ScreenshotError('invalid')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(imageElement, 0, 0, width, height)
      return canvas
    }

    /** Local wall-clock file name for one inserted capture. */
    function screenshotFileName() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return 'screenshot-' + String(now.getFullYear())
        + pad(now.getMonth() + 1) + pad(now.getDate()) + '-'
        + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '.png'
    }

    /** Map one thrown failure to its localized notice key. */
    function noticeKeyFor(error) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
      return NOTICE_BY_CODE[code] || 'error.captureFailed'
    }

    /** Ask the Host half for a PNG of the monitor under the cursor. */
    async function requestCapture() {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        throw new ScreenshotError('unavailable')
      }
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : window.location.href
      const url = new URL(CAPTURE_PATH, base)
      const controller = new AbortController()
      const timer = window.setTimeout(() => { controller.abort() }, CLIENT_CAPTURE_TIMEOUT_MS)
      let response
      try {
        response = await window.fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        })
      } catch (error) {
        throw new ScreenshotError(controller.signal.aborted ? 'capture-timeout' : 'network')
      } finally {
        window.clearTimeout(timer)
      }
      if (response.status === 401 || response.status === 403) throw new ScreenshotError('unauthorized')
      if (!response.ok) {
        let code = ''
        try {
          const payload = await response.json()
          if (payload !== null && typeof payload === 'object' && typeof payload.code === 'string') code = payload.code
        } catch (error) {
          code = ''
        }
        throw new ScreenshotError(code === '' ? 'capture-failed' : code)
      }
      let blob
      try {
        blob = await response.blob()
      } catch (error) {
        throw new ScreenshotError('invalid')
      }
      if (blob.size === 0) throw new ScreenshotError('invalid')
      const objectUrl = URL.createObjectURL(blob)
      try {
        const loaded = await loadImage(objectUrl)
        if (loaded.width < 1 || loaded.height < 1) throw new ScreenshotError('invalid')
        const region = response.headers.get(REGION_HEADER) === '1'
        if (!region) return { url: objectUrl, width: loaded.width, height: loaded.height, region: false }
        // macOS returns the already-selected region, so the annotation editor
        // opens on it directly and the frameless capture is not needed.
        return {
          url: objectUrl,
          width: loaded.width,
          height: loaded.height,
          region: true,
          cropCanvas: buildCropCanvas(loaded.image, loaded.width, loaded.height),
        }
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        if (error instanceof ScreenshotError) throw error
        throw new ScreenshotError('invalid')
      }
    }

    /** Camera artwork for the capture action; inherits `currentColor`. */
    function CameraIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 17,
        height: 17,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.7c.28-.43.76-.69 1.27-.69h3.86c.51 0 .99.26 1.27.69L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
        h('circle', {
          cx: 12,
          cy: 12.2,
          r: 3.35,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('circle', { cx: 17.4, cy: 9.1, r: 0.9, fill: 'currentColor' }),
      )
    }

    /** Toolbar artwork: an outlined rectangle. */
    function RectIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('rect', { x: 3, y: 4.5, width: 14, height: 11, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
      )
    }

    /** Toolbar artwork: an arrow pointing up-right. */
    function ArrowIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('path', { d: 'M4 16 15 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M9.4 4.6H15.4V10.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Toolbar artwork: undo. */
    function UndoIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('path', { d: 'M7.5 5.5 3.5 9.5l4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M3.8 9.5H11a4.7 4.7 0 0 1 0 9.4h-.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    /** Toolbar artwork: clear all annotations. */
    function ClearIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('path', { d: 'M4 6h12M8 6V4h4v2M6.2 6l.9 10h5.8l.9-10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Toolbar artwork: confirm. */
    function CheckIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 15, height: 15, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('path', { d: 'm4 10 4 4 8-9', fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Stroke width matching the annotated image's resolution. */
    function annotationLineWidth(width, height) {
      return clamp(Math.round(Math.max(width, height) / 320), 2, 10)
    }

    /**
     * Draw one annotation shape in natural image coordinates.
     * @param context - canvas 2d context in image pixel space.
     * @param shape - `rect` or `arrow` with two corners.
     * @param width - crop width in pixels.
     * @param height - crop height in pixels.
     */
    function drawShape(context, shape, width, height) {
      const lineWidth = annotationLineWidth(width, height)
      context.save()
      context.strokeStyle = INK
      context.fillStyle = INK
      context.lineWidth = lineWidth
      context.lineCap = 'round'
      context.lineJoin = 'round'
      if (shape.type === 'rect') {
        const left = Math.min(shape.x1, shape.x2)
        const top = Math.min(shape.y1, shape.y2)
        const rectWidth = Math.abs(shape.x2 - shape.x1)
        const rectHeight = Math.abs(shape.y2 - shape.y1)
        context.strokeRect(left, top, rectWidth, rectHeight)
      } else {
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
        const headLength = Math.max(lineWidth * 3.4, 10)
        context.beginPath()
        context.moveTo(shape.x1, shape.y1)
        context.lineTo(shape.x2, shape.y2)
        context.stroke()
        context.beginPath()
        context.moveTo(shape.x2, shape.y2)
        context.lineTo(
          shape.x2 - headLength * Math.cos(angle - Math.PI / 7),
          shape.y2 - headLength * Math.sin(angle - Math.PI / 7),
        )
        context.lineTo(
          shape.x2 - headLength * Math.cos(angle + Math.PI / 7),
          shape.y2 - headLength * Math.sin(angle + Math.PI / 7),
        )
        context.closePath()
        context.fill()
      }
      context.restore()
    }

    /**
     * Full-page capture overlay. It has two possible starts:
     *
     * - Windows: the `select` stage shows the frozen screen and takes one drag
     *   selection; releasing it crops the selection at the capture's natural
     *   resolution and opens `edit`.
     * - macOS: the Host already ran the system's interactive region selection,
     *   so the overlay opens straight in `edit` with that region as the crop.
     *
     * `edit` shows the crop with a toolbar, where rectangles and arrows are
     * drawn on a canvas at native resolution; only the confirmed canvas is
     * encoded and handed back. The portal lives on `document.body`, so the
     * composer's sticky stacking context cannot clip it. Escape cancels
     * framing, returns from annotation to framing (Windows), or cancels the
     * whole overlay (macOS); Enter confirms annotation.
     * @param props - captured image, locale seat, and outcome callbacks.
     * @returns one portalled overlay element.
     */
    function CaptureOverlay(props) {
      const { image, t, onCancel, onConfirm, onFailed } = props
      const overlayRef = React.useRef(null)
      const stageRef = React.useRef(null)
      const imageRef = React.useRef(null)
      const selectionDragRef = React.useRef(null)
      const canvasRef = React.useRef(null)
      const annotationDragRef = React.useRef(null)

      const directRegion = image.region === true && image.cropCanvas instanceof HTMLCanvasElement

      const [stage, setStage] = React.useState(directRegion ? 'edit' : 'select')
      const [selection, setSelection] = React.useState(null)
      const [crop, setCrop] = React.useState(() => (
        directRegion ? { canvas: image.cropCanvas, width: image.width, height: image.height } : null
      ))
      const [shapes, setShapes] = React.useState([])
      const [draftShape, setDraftShape] = React.useState(null)
      const [tool, setTool] = React.useState('rect')
      const [working, setWorking] = React.useState(false)
      const [displayScale, setDisplayScale] = React.useState(1)

      const workingRef = React.useRef(false)
      workingRef.current = working
      const stageNameRef = React.useRef(stage)
      stageNameRef.current = stage
      const cropRef = React.useRef(crop)
      cropRef.current = crop
      const shapesRef = React.useRef(shapes)
      shapesRef.current = shapes
      const draftShapeRef = React.useRef(draftShape)
      draftShapeRef.current = draftShape

      React.useEffect(() => {
        const node = overlayRef.current
        if (node !== null) {
          try {
            node.focus({ preventScroll: true })
          } catch (error) {
            node.focus()
          }
        }
      }, [])

      /** Fit the annotated crop into the viewport, allowing some upscale. */
      React.useEffect(() => {
        if (stage !== 'edit' || crop === null) return undefined
        const compute = () => {
          const maxWidth = Math.max(120, window.innerWidth - 48)
          const maxHeight = Math.max(120, window.innerHeight - 210)
          const raw = Math.min(maxWidth / crop.width, maxHeight / crop.height)
          setDisplayScale(Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3) : 1)
        }
        compute()
        window.addEventListener('resize', compute)
        return () => { window.removeEventListener('resize', compute) }
      }, [stage, crop])

      /** Confirm only while no canvas encode is in flight. */
      const confirmAnnotation = () => {
        const canvas = canvasRef.current
        if (canvas === null || workingRef.current) return
        setWorking(true)
        workingRef.current = true
        canvas.toBlob((blob) => {
          if (blob === null) {
            setWorking(false)
            workingRef.current = false
            onFailed(new Error('the annotated image could not be encoded'))
            return
          }
          onConfirm(new File([blob], screenshotFileName(), { type: 'image/png' }))
        }, 'image/png')
      }

      /** Drop the crop and return to framing; a native selection closes instead. */
      const backToSelect = () => {
        if (workingRef.current) return
        if (directRegion) {
          onCancel()
          return
        }
        selectionDragRef.current = null
        annotationDragRef.current = null
        setStage('select')
        setCrop(null)
        setShapes([])
        setDraftShape(null)
        setSelection(null)
      }

      /** Remove the last committed annotation. */
      const undoShape = () => {
        if (workingRef.current) return
        setShapes((current) => current.slice(0, -1))
      }

      /** Keyboard: Escape steps back or cancels; Enter confirms annotation. */
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.defaultPrevented) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (workingRef.current) return
            if (stageNameRef.current === 'edit') backToSelect()
            else onCancel()
            return
          }
          if (stageNameRef.current !== 'edit') return
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            confirmAnnotation()
            return
          }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
            event.preventDefault()
            event.stopPropagation()
            undoShape()
          }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => { window.removeEventListener('keydown', onKeyDown, true) }
      })

      /** Redraw the canvas: crop pixels plus committed and in-progress shapes. */
      const redraw = React.useCallback(() => {
        const canvas = canvasRef.current
        const currentCrop = cropRef.current
        if (canvas === null || currentCrop === null) return
        const context = canvas.getContext('2d')
        if (context === null) return
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(currentCrop.canvas, 0, 0)
        for (const shape of shapesRef.current) drawShape(context, shape, currentCrop.width, currentCrop.height)
        if (draftShapeRef.current !== null) drawShape(context, draftShapeRef.current, currentCrop.width, currentCrop.height)
      }, [])

      React.useLayoutEffect(() => {
        redraw()
      }, [redraw, stage, crop, shapes, draftShape])

      /** Map one pointer event to framing-stage coordinates. */
      const stagePointOf = (event) => {
        const node = stageRef.current
        if (node === null) return null
        const bounds = node.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return null
        return {
          x: clamp(event.clientX - bounds.left, 0, bounds.width),
          y: clamp(event.clientY - bounds.top, 0, bounds.height),
        }
      }

      /** Map one pointer event to annotation-canvas pixel coordinates. */
      const canvasPointOf = (event) => {
        const canvas = canvasRef.current
        const currentCrop = cropRef.current
        if (canvas === null || currentCrop === null) return null
        const bounds = canvas.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return null
        return {
          x: clamp((event.clientX - bounds.left) / bounds.width * currentCrop.width, 0, currentCrop.width),
          y: clamp((event.clientY - bounds.top) / bounds.height * currentCrop.height, 0, currentCrop.height),
        }
      }

      /** Crop the framed region at native resolution and open the editor. */
      const beginAnnotation = (rect) => {
        const node = stageRef.current
        const imageElement = imageRef.current
        if (node === null || imageElement === null) {
          setSelection(null)
          return
        }
        const bounds = node.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) {
          setSelection(null)
          return
        }
        const scaleX = image.width / bounds.width
        const scaleY = image.height / bounds.height
        const sourceX = clamp(Math.round(rect.left * scaleX), 0, image.width - 1)
        const sourceY = clamp(Math.round(rect.top * scaleY), 0, image.height - 1)
        const sourceWidth = clamp(Math.round(rect.width * scaleX), 1, image.width - sourceX)
        const sourceHeight = clamp(Math.round(rect.height * scaleY), 1, image.height - sourceY)
        const canvas = document.createElement('canvas')
        canvas.width = sourceWidth
        canvas.height = sourceHeight
        const context = canvas.getContext('2d')
        if (context === null) {
          setSelection(null)
          return
        }
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(imageElement, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
        selectionDragRef.current = null
        annotationDragRef.current = null
        setSelection(null)
        setShapes([])
        setDraftShape(null)
        setTool('rect')
        setCrop({ canvas, width: sourceWidth, height: sourceHeight })
        setStage('edit')
      }

      const onStagePointerDown = (event) => {
        if (event.button !== 0 || workingRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const point = stagePointOf(event)
        if (point === null) return
        selectionDragRef.current = { pointerId: event.pointerId, start: point, current: point }
        setSelection({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch (error) {
          // Synthetic or already-released pointers need no capture.
        }
      }

      const onStagePointerMove = (event) => {
        const drag = selectionDragRef.current
        if (drag === null || event.pointerId !== drag.pointerId || workingRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const point = stagePointOf(event)
        if (point === null) return
        drag.current = point
        setSelection({ x1: drag.start.x, y1: drag.start.y, x2: point.x, y2: point.y })
      }

      const onStagePointerUp = (event) => {
        const drag = selectionDragRef.current
        if (drag === null || event.pointerId !== drag.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        selectionDragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch (error) {
          // Releasing an uncaptured pointer is a no-op.
        }
        const point = stagePointOf(event) ?? drag.current
        const rect = normalizeSelection(drag.start, point)
        if (rect.width < MIN_CROP_PX || rect.height < MIN_CROP_PX) {
          setSelection(null)
          return
        }
        beginAnnotation(rect)
      }

      const onStagePointerCancel = (event) => {
        if (selectionDragRef.current === null) return
        selectionDragRef.current = null
        setSelection(null)
        event.stopPropagation()
      }

      const onCanvasPointerDown = (event) => {
        if (event.button !== 0 || workingRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const point = canvasPointOf(event)
        if (point === null) return
        annotationDragRef.current = { pointerId: event.pointerId, start: point }
        setDraftShape({ type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y })
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch (error) {
          // Synthetic or already-released pointers need no capture.
        }
      }

      const onCanvasPointerMove = (event) => {
        const drag = annotationDragRef.current
        if (drag === null || event.pointerId !== drag.pointerId || workingRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const point = canvasPointOf(event)
        if (point === null) return
        setDraftShape({ type: tool, x1: drag.start.x, y1: drag.start.y, x2: point.x, y2: point.y })
      }

      const onCanvasPointerUp = (event) => {
        const drag = annotationDragRef.current
        if (drag === null || event.pointerId !== drag.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        annotationDragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch (error) {
          // Releasing an uncaptured pointer is a no-op.
        }
        const point = canvasPointOf(event) ?? drag.start
        const shape = { type: tool, x1: drag.start.x, y1: drag.start.y, x2: point.x, y2: point.y }
        setDraftShape(null)
        if (Math.abs(shape.x2 - shape.x1) < 2 && Math.abs(shape.y2 - shape.y1) < 2) return
        setShapes((current) => [...current, shape])
      }

      const onCanvasPointerCancel = (event) => {
        if (annotationDragRef.current === null) return
        annotationDragRef.current = null
        setDraftShape(null)
        event.stopPropagation()
      }

      /** Overlay chrome stops events from reaching the composer underneath. */
      const stop = (event) => { event.stopPropagation() }

      const selectionRect = selection === null ? null : normalizeSelection(
        { x: selection.x1, y: selection.y1 },
        { x: selection.x2, y: selection.y2 },
      )

      /**
       * One labeled tool button in the annotation toolbar. The icon and the
       * label are children of the button itself and neither captures pointer
       * events, so every visible pixel of the control belongs to the button.
       * No native `title` is set: the label is always visible, and a native
       * tooltip would float above the capture where it could be mistaken for
       * part of the control.
       */
      const toolButton = (id, Icon, label) => h('button', {
        key: 'tool-' + id,
        type: 'button',
        className: 'dshScreenshot_tool',
        'data-dsh-tool': id,
        'aria-label': label,
        'aria-pressed': tool === id ? 'true' : 'false',
        onClick: (event) => {
          event.stopPropagation()
          if (!workingRef.current) setTool(id)
        },
      }, h(Icon), h('span', { className: 'dshScreenshot_toolLabel' }, label))

      /** One labeled action in the annotation toolbar (same hit box as a tool). */
      const actionButton = (id, Icon, label, disabled, action) => h('button', {
        key: 'action-' + id,
        type: 'button',
        className: 'dshScreenshot_tool',
        'data-dsh-tool': id,
        'aria-label': label,
        disabled,
        onClick: (event) => {
          event.stopPropagation()
          action()
        },
      }, h(Icon), h('span', { className: 'dshScreenshot_toolLabel' }, label))

      /** One text action in the annotation toolbar. */
      const textButton = (id, className, label, action, disabled) => h('button', {
        key: 'text-' + id,
        type: 'button',
        className,
        'data-dsh-tool': id,
        disabled,
        onClick: (event) => {
          event.stopPropagation()
          action()
        },
      }, label)

      return h('div', {
        ref: overlayRef,
        className: 'dshScreenshot_overlay',
        tabIndex: -1,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': stage === 'edit' ? t('overlay.annotateLabel') : t('overlay.label'),
        'data-dsh-screenshot-overlay': '',
        'data-stage': stage,
        onPointerDown: stop,
        onPointerMove: stop,
        onPointerUp: stop,
        onClick: stop,
        onMouseDown: stop,
        onContextMenu: (event) => {
          event.preventDefault()
          event.stopPropagation()
        },
      },
        stage === 'select'
          ? [
              h('div', { key: 'hint', className: 'dshScreenshot_hint', role: 'status' },
                working ? t('overlay.processing') : t('overlay.hint')),
              h('button', {
                key: 'cancel',
                type: 'button',
                className: 'dshScreenshot_cancel',
                onClick: (event) => {
                  event.stopPropagation()
                  if (!workingRef.current) onCancel()
                },
              }, t('overlay.cancel')),
              h('div', {
                key: 'stage',
                ref: stageRef,
                className: 'dshScreenshot_stage',
                'data-dsh-screenshot-stage': '',
                onPointerDown: onStagePointerDown,
                onPointerMove: onStagePointerMove,
                onPointerUp: onStagePointerUp,
                onPointerCancel: onStagePointerCancel,
              },
                h('img', {
                  ref: imageRef,
                  className: 'dshScreenshot_image',
                  src: image.url,
                  alt: '',
                  draggable: false,
                  onDragStart: (event) => { event.preventDefault() },
                }),
                selectionRect === null ? null : h('div', {
                  className: 'dshScreenshot_selection',
                  style: {
                    left: selectionRect.left + 'px',
                    top: selectionRect.top + 'px',
                    width: selectionRect.width + 'px',
                    height: selectionRect.height + 'px',
                  },
                }),
              ),
            ]
          : [
              h('div', { key: 'toolbar', className: 'dshScreenshot_toolbar', 'data-dsh-toolbar': '' },
                toolButton('rect', RectIcon, t('tool.rect')),
                toolButton('arrow', ArrowIcon, t('tool.arrow')),
                h('span', { key: 'sep-1', className: 'dshScreenshot_separator', 'aria-hidden': true }),
                actionButton('undo', UndoIcon, t('tool.undo'), shapes.length === 0 || working, undoShape),
                actionButton('clear', ClearIcon, t('tool.clear'), shapes.length === 0 || working, () => { setShapes([]) }),
                h('span', { key: 'sep-2', className: 'dshScreenshot_separator', 'aria-hidden': true }),
                textButton('reselect', 'dshScreenshot_ghostTool', t('tool.reselect'), backToSelect, working),
                textButton('cancel', 'dshScreenshot_ghostTool', t('tool.cancel'), onCancel, working),
                h('button', {
                  key: 'confirm',
                  type: 'button',
                  className: 'dshScreenshot_primaryTool',
                  'data-dsh-tool': 'confirm',
                  disabled: working,
                  onClick: (event) => {
                    event.stopPropagation()
                    confirmAnnotation()
                  },
                },
                  working ? h('span', { className: 'dshScreenshot_spinner', 'aria-hidden': true }) : h(CheckIcon),
                  h('span', null, t('tool.confirm')),
                ),
              ),
              h('div', { key: 'editor', className: 'dshScreenshot_editor', 'data-dsh-annotation-editor': '' },
                crop === null ? null : h('canvas', {
                  ref: canvasRef,
                  className: 'dshScreenshot_annotationCanvas',
                  'data-dsh-annotation-canvas': '',
                  width: crop.width,
                  height: crop.height,
                  style: {
                    width: Math.round(crop.width * displayScale) + 'px',
                    height: Math.round(crop.height * displayScale) + 'px',
                  },
                  onPointerDown: onCanvasPointerDown,
                  onPointerMove: onCanvasPointerMove,
                  onPointerUp: onCanvasPointerUp,
                  onPointerCancel: onCanvasPointerCancel,
                  onDragStart: (event) => { event.preventDefault() },
                }),
              ),
              h('div', { key: 'editorHint', className: 'dshScreenshot_editorHint', role: 'status' },
                working ? t('overlay.processing') : t(directRegion ? 'editor.hintRegion' : 'editor.hint')),
            ],
      )
    }

    /**
     * The composer's light-green screenshot circle, rendered before the submit
     * action beside the prompt-enhance control.
     * @param props - the slot's input hooks plus this plugin's injected face.
     * @returns the capture button, its overlay, and transient notices.
     */
    function ScreenshotButton(props) {
      const { useInput, inputActions, sessionId, t, captureScreen, insertImage } = props
      const phase = useInput((state) => (
        state !== null && typeof state === 'object' && typeof state.phase === 'string' ? state.phase : 'plain'
      ))
      const [busy, setBusy] = React.useState(false)
      const [overlay, setOverlay] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const alive = React.useRef(true)
      const busyRef = React.useRef(false)
      const overlayRef = React.useRef(null)
      const restoreFocusRef = React.useRef(null)
      const noticeSeq = React.useRef(0)
      overlayRef.current = overlay

      React.useEffect(() => () => {
        alive.current = false
        const image = overlayRef.current
        if (image !== null) URL.revokeObjectURL(image.url)
        overlayRef.current = null
      }, [])

      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => {
          if (alive.current) setNotice(null)
        }, NOTICE_MS)
        return () => { window.clearTimeout(timer) }
      }, [notice])

      /** Show one localized notice; failures tint it red. */
      const showNotice = (key, isError) => {
        noticeSeq.current += 1
        setNotice({ key, isError, seq: noticeSeq.current })
      }

      /** Return focus to the control that owned it before the overlay opened. */
      const restoreFocus = () => {
        const target = restoreFocusRef.current
        restoreFocusRef.current = null
        if (target === null || target === undefined) return
        window.setTimeout(() => {
          try {
            if (document.contains(target) && typeof target.focus === 'function') target.focus({ preventScroll: true })
          } catch (error) {
            // A removed target simply keeps focus where it is.
          }
        }, 0)
      }

      /** Close the overlay, releasing its object URL. */
      const closeOverlay = () => {
        const image = overlayRef.current
        overlayRef.current = null
        setOverlay(null)
        if (image !== null) URL.revokeObjectURL(image.url)
      }

      const onCancel = () => {
        closeOverlay()
        restoreFocus()
      }

      const onConfirm = (file) => {
        closeOverlay()
        try {
          insertImage(sessionId, file, inputActions)
          showNotice(t('notice.inserted'), false)
        } catch (error) {
          showNotice(t(noticeKeyFor(error)), true)
          console.warn('[screenshot-insert] insertion failed:', error)
        } finally {
          restoreFocus()
        }
      }

      const onFailed = (error) => {
        closeOverlay()
        showNotice(t(noticeKeyFor(error)), true)
        console.warn('[screenshot-insert] annotation failed:', error)
        restoreFocus()
      }

      const onClick = () => {
        if (busyRef.current || overlayRef.current !== null) return
        busyRef.current = true
        setBusy(true)
        setNotice(null)
        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        captureScreen().then((captured) => {
          if (!alive.current) {
            URL.revokeObjectURL(captured.url)
            return
          }
          busyRef.current = false
          setBusy(false)
          setOverlay(captured)
        }).catch((error) => {
          if (!alive.current) return
          busyRef.current = false
          setBusy(false)
          // A cancelled native macOS selection is an ordinary user action:
          // discard it silently instead of raising a failure notice.
          const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
          if (code === 'capture-cancelled') return
          showNotice(t(noticeKeyFor(error)), true)
          console.warn('[screenshot-insert] capture failed:', error)
        })
      }

      const machineBusy = phase === 'adjudicating' || phase === 'submitting'
      const label = busy ? t('action.capturing') : t('action.capture')
      const className = 'dshScreenshot_button' + (busy ? ' dshScreenshot_busy' : '')

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className,
          'data-dsh-screenshot-button': '',
          'aria-label': label,
          'aria-busy': busy ? 'true' : undefined,
          disabled: busy || machineBusy,
          onMouseDown: (event) => { event.preventDefault() },
          onClick,
        }, busy ? h('span', { className: 'dshScreenshot_spinner', 'aria-hidden': true }) : h(CameraIcon)),
        overlay === null ? null : ReactDOM.createPortal(h(CaptureOverlay, {
          image: overlay,
          t,
          onCancel,
          onConfirm,
          onFailed,
        }), document.body),
        notice === null ? null : ReactDOM.createPortal(h('div', {
          className: 'dshScreenshot_toastLayer',
          role: 'status',
          'data-dsh-screenshot-notice': '',
        }, h('div', {
          className: 'dshScreenshot_toast' + (notice.isError ? ' dshScreenshot_toastError' : ''),
        },
          h('span', { className: 'dshScreenshot_toastIcon', 'aria-hidden': true }, notice.isError ? '!' : '✓'),
          h('span', { className: 'dshScreenshot_toastText' }, t(notice.key)),
        )), document.body),
      )
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
        }, 'screenshot-insert: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'screenshot-insert: dictionaries')

        const t = ctx.locale.bind(NS)

        /**
         * Resolve the Conversation service at the moment of insertion. It owns
         * the runtime draft-attachment registry and the image draft path; the
         * public `inputActions.addAttachments` accepts the ids it mints.
         */
        const resolveConversation = () => {
          const conversation = ctx.get('conversation')
          if (conversation === undefined || conversation === null || typeof conversation.createDrafts !== 'function') {
            throw new ScreenshotError('unavailable')
          }
          return conversation
        }

        /**
         * Insert one confirmed capture into the composer as a draft image
         * attachment, leaving the draft text and caret untouched.
         * @param sessionId - the slot's Session identity.
         * @param file - a PNG File holding the annotated crop.
         * @param inputActions - the composer's standard action face.
         */
        function insertImage(sessionId, file, inputActions) {
          if (typeof sessionId !== 'string' || sessionId === '') throw new ScreenshotError('unavailable')
          if (inputActions === undefined || inputActions === null || typeof inputActions.addAttachments !== 'function') {
            throw new ScreenshotError('unavailable')
          }
          const conversation = resolveConversation()
          let drafts
          try {
            drafts = conversation.createDrafts(sessionId, [file])
          } catch (error) {
            const name = error !== null && typeof error === 'object' && typeof error.name === 'string' ? error.name : ''
            throw new ScreenshotError(name === 'UnsupportedImageMediaTypeError' ? 'unsupported' : 'insert-failed')
          }
          try {
            const ids = drafts.map((draft) => draft.id)
            if (!inputActions.addAttachments(ids)) {
              conversation.releaseDraftAttachments(drafts)
              throw new ScreenshotError('busy')
            }
          } catch (error) {
            if (error instanceof ScreenshotError) throw error
            conversation.releaseDraftAttachments(drafts)
            throw new ScreenshotError('insert-failed')
          }
        }

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'screenshot-insert',
          order: 101,
          locale: NS,
          inject: () => ({ t, captureScreen: requestCapture, insertImage }),
        }, ScreenshotButton))
      },
    }
  },
})
