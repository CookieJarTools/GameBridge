import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = readFileSync(join(buildDir, 'icon.svg'))

const renderPng = (size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

// 512px PNG — Linux tray/window and the largest source.
writeFileSync(join(buildDir, 'icon.png'), renderPng(512))

// Multi-resolution Windows .ico for the taskbar, title bar and packaged exe.
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const ico = await pngToIco(icoSizes.map(renderPng))
writeFileSync(join(buildDir, 'icon.ico'), ico)

console.log(`Wrote build/icon.png (512) and build/icon.ico (${icoSizes.join(', ')})`)
