// Renders scripts/banner/banner.html to docs/banner.png with Electron.
// Run with `npm run generate:banner`.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs', 'banner.png')

// Laid out at 1280x640, written at 2x so it stays sharp on high-DPI screens.
const WIDTH = 1280
const HEIGHT = 640
const SCALE = 2

app.whenReady().then(async () => {
  // Shown but invisible: a hidden window never paints, so the screenshot would wait forever.
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    opacity: 0,
    skipTaskbar: true,
    focusable: false
  })
  win.showInactive()
  await win.loadFile(join(root, 'scripts', 'banner', 'banner.html'))
  // Chromium remembers zoom per origin, so reset it in case a file:// page was zoomed before.
  win.webContents.setZoomFactor(1)
  // Wait for Inter to arrive so the capture doesn't fall back to a system font.
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')

  // DevTools' screenshot isn't limited to the window, which Windows clamps to the screen.
  const dbg = win.webContents.debugger
  // Pinning the metrics keeps the result independent of this screen's own display scaling.
  dbg.attach()
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: false
  })
  const { data } = await dbg.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 }
  })
  dbg.detach()

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(data, 'base64'))
  console.log(`Wrote docs/banner.png (${WIDTH * SCALE}x${HEIGHT * SCALE})`)
  app.quit()
})
