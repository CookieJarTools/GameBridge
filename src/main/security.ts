import { app, shell, type BrowserWindow } from 'electron'

/**
 * The asset-store tabs show third-party websites, so anything they can reach
 * is locked down here: they never get our preload, can't navigate to local or
 * custom-protocol URLs, and can't hand such URLs to the OS to open.
 */

const WEB_PROTOCOLS = new Set(['http:', 'https:'])

export function isWebUrl(url: string): boolean {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** App protocols GameBridge itself links to (Settings → "Open Epic"). */
const TRUSTED_APP_PROTOCOLS = new Set(['mailto:', 'com.epicgames.launcher:'])

/**
 * shell.openExternal hands the URL to Windows, which will happily run a
 * `file:` path or any custom protocol handler. Only web links and the
 * named app protocols above get through.
 */
export async function openExternalSafe(url: string): Promise<void> {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return
  }
  if (WEB_PROTOCOLS.has(protocol) || TRUSTED_APP_PROTOCOLS.has(protocol)) await shell.openExternal(url)
}

/** The app window is a single-page UI; it should never navigate anywhere. */
export function lockAppWindow(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafe(url)
    return { action: 'deny' }
  })
}

/** Rules for every <webview> and any popup a store page opens. Call once at startup. */
export function hardenWebContents(): void {
  app.on('web-contents-created', (_e, contents) => {
    // A webview never gets more power than a plain sandboxed browser tab.
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete prefs.preload
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      if (!isWebUrl(params.src)) event.preventDefault()
    })

    if (contents.getType() !== 'webview' && contents.getType() !== 'window') return

    contents.on('will-navigate', (event, url) => {
      if (!isWebUrl(url)) event.preventDefault()
    })

    // Store sign-ins (Epic, Unity) open popups, so web popups are still allowed,
    // but only as sandboxed windows. Everything else is refused.
    contents.setWindowOpenHandler(({ url }) => {
      if (!isWebUrl(url)) return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        }
      }
    })
  })
}
