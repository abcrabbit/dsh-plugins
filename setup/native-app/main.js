/**
 * Native preview window host.
 *
 * This is a minimal Electron application used only by the preview-popout
 * plugin. It reuses the DSH installation's Electron/Chromium runtime through
 * hard links (so it costs no extra disk space and no browser installation),
 * and creates exactly one native window that loads the already authenticated
 * preview URL handed over by the Host plugin.
 *
 * The window stays hidden until the page reports that the preview itself is on
 * screen (a title handshake). That removes the flash of the full DSH shell
 * before the file content appears. A timeout reveals the window anyway so a
 * failed restore cannot leave an invisible window behind.
 *
 * Inputs arrive through the environment (never through shell-interpolated
 * arguments):
 *   DSH_PREVIEW_URL   authenticated application URL including the pop-out payload
 *   DSH_PREVIEW_TITLE window title (the file name)
 */
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

/** Title marker prefix; the client appends a Base64URL of the UTF-8 window title. */
const READY_PREFIX = '__DSH_PREVIEW_WINDOW_READY__'
/** Reveal anyway after this long so a failed restore still shows the application. */
const REVEAL_TIMEOUT_MS = 15000

const previewUrl = typeof process.env.DSH_PREVIEW_URL === 'string' ? process.env.DSH_PREVIEW_URL : ''
const warmWindowMode = process.env.DSH_PREVIEW_WARM === '1'
const windowTitle = typeof process.env.DSH_PREVIEW_TITLE === 'string' && process.env.DSH_PREVIEW_TITLE !== ''
  ? process.env.DSH_PREVIEW_TITLE
  : 'Preview'

/** The only origin this window may stay on. */
let allowedOrigin = ''
try {
  allowedOrigin = new URL(previewUrl).origin
} catch {
  allowedOrigin = ''
}

// A dedicated profile keeps this window's cookies and storage separate from the
// main application and from any browser the user owns.
app.setName('DSH Preview')
try {
  app.setPath('userData', path.join(app.getPath('temp'), `dsh-preview-window-${process.pid}`))
} catch {
  // A read-only temp directory still lets the window open with the default path.
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    title: windowTitle,
    autoHideMenuBar: true,
    backgroundColor: '#111315',
    // The renderer must paint while the window is invisible so that showing it
    // reveals an already-painted preview frame, never the application shell.
    show: false,
    opacity: 0,
    focusable: false,
    skipTaskbar: warmWindowMode,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      devTools: true,
      backgroundThrottling: false,
    },
  })
  let revealed = false
  const reveal = () => {
    if (revealed || window.isDestroyed()) return
    revealed = true
    window.setSkipTaskbar(false)
    window.setIgnoreMouseEvents(false)
    window.setFocusable(true)
    window.setOpacity(1)
    window.show()
    window.focus()
  }
  const timeout = setTimeout(reveal, REVEAL_TIMEOUT_MS)
  timeout.unref?.()
  // Show it (fully transparent, ignoring the mouse) right away: a shown window
  // is painted normally, whereas a hidden one can keep presenting a stale first
  // frame. A parked warm window waits here until a detach claims it.
  window.once('ready-to-show', () => {
    if (revealed) return
    window.setIgnoreMouseEvents(true)
    window.showInactive()
  })

  window.setMenu(null)
  window.removeMenu?.()
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // The page owns the title handshake: it embeds the UTF-8 title after the
  // marker, so Chinese file names survive this page-title channel. The first
  // paint after the marker is the preview.
  window.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    if (typeof title !== 'string' || !title.startsWith(READY_PREFIX)) return
    let label = ''
    try {
      label = Buffer.from(title.slice(READY_PREFIX.length), 'base64url').toString('utf8')
    } catch {
      label = ''
    }
    if (label.length > 0 && label.length <= 300 && !/[\u0000-\u001f\u007f]/.test(label)) window.setTitle(label)
    else window.setTitle(windowTitle)
    reveal()
  })
  window.webContents.on('will-navigate', (event, url) => {
    let origin = ''
    try {
      origin = new URL(url).origin
    } catch {
      origin = ''
    }
    if (allowedOrigin === '' || origin !== allowedOrigin) event.preventDefault()
  })
  window.on('closed', () => {
    clearTimeout(timeout)
    app.quit()
  })
  if (previewUrl === '') {
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="font:14px sans-serif;padding:24px">Missing preview URL</body>')}`)
  } else {
    window.loadURL(previewUrl).catch(() => {
      window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="font:14px sans-serif;padding:24px">The preview could not be loaded.</body>')}`)
    })
  }
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
