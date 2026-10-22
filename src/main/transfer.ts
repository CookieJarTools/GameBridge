import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { promises as fs, type Dirent } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import type {
  FabImportRequest,
  TransferPhase,
  TransferRequest,
  TransferResult,
  UnrealAssetEntry,
  UnrealAssetKind,
  UnrealInstall,
  UnrealScanResult
} from '@shared/types'
import exportScript from './unrealexport.py?raw'
import { extractEmbeddedSource, readUnrealAsset } from './uasset'
import { writeImportMeta, type MetaKind } from './unitymeta'
import { toUnitySpec, type UnrealMaterialDescription } from './materialspec'
import { queueMaterialBuild, type UnityMaterialManifest } from './unitymaterials'

/**
 * Moving assets from Unreal (or a Fab download) into a Unity project.
 *
 * Sounds and many textures still carry the file they were imported from, so
 * those are copied straight out of the .uasset with no engine involved.
 * Meshes, characters, animations and anything without an embedded source go
 * through Unreal, run headless with a Python script that exports FBX/WAV/PNG.
 */

type Emit = (channel: string, payload: unknown) => void
let emit: Emit = () => {}
export function setTransferEmitter(fn: Emit): void {
  emit = fn
}

// ------------------------------------------------------------------ scan ---

const KIND_OUTPUT: Partial<Record<UnrealAssetKind, UnrealAssetEntry['output']>> = {
  sound: 'wav',
  texture: 'png',
  staticMesh: 'fbx',
  skeletalMesh: 'fbx',
  animation: 'fbx',
  material: 'mat'
}

const SCAN_CONCURRENCY = 16

async function walkContent(dir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nested = await Promise.all(
    entries.map((e) => {
      const full = join(dir, e.name)
      if (e.isDirectory()) return walkContent(full)
      return Promise.resolve(e.name.toLowerCase().endsWith('.uasset') ? [full] : [])
    })
  )
  return nested.flat()
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function readEngineAssociation(uprojectPath: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await fs.readFile(uprojectPath, 'utf-8'))
    return typeof json.EngineAssociation === 'string' ? json.EngineAssociation : undefined
  } catch {
    return undefined
  }
}

/** UnrealEditor-Cmd.exe for the project's engine version, if that version is installed. */
async function resolveUnrealCmd(version: string | undefined, installs: UnrealInstall[]): Promise<string | undefined> {
  if (!version) return undefined
  const match = installs.find((i) => i.version === version) ?? installs.find((i) => i.version.startsWith(version))
  if (!match) return undefined
  const cmd = join(dirname(match.editorPath), 'UnrealEditor-Cmd.exe')
  try {
    await fs.access(cmd)
    return cmd
  } catch {
    return undefined
  }
}

export async function scanUnrealProject(
  uprojectPath: string,
  installs: UnrealInstall[],
  scanId: string
): Promise<UnrealScanResult> {
  const projectDir = dirname(uprojectPath)
  const contentDir = join(projectDir, 'Content')
  const engineVersion = await readEngineAssociation(uprojectPath)
  const engineCmdPath = await resolveUnrealCmd(engineVersion, installs)

  const files = await walkContent(contentDir)
  let done = 0
  const assets = await mapLimit(files, SCAN_CONCURRENCY, async (file): Promise<UnrealAssetEntry> => {
    const info = await readUnrealAsset(file).catch(() => ({ kind: 'other' as const, size: 0, source: null, refs: [] as string[] }))
    done++
    if (done % 100 === 0 || done === files.length) {
      emit('transfer:progress', { transferId: scanId, phase: 'scanning', done, total: files.length })
    }
    const path = relative(contentDir, file).split(sep).join('/').replace(/\.uasset$/i, '')
    const name = path.split('/').pop() ?? path
    const output = KIND_OUTPUT[info.kind]
    const route = !output ? 'none' : info.source ? 'direct' : 'engine'
    const refs = info.refs.filter((r) => r.startsWith('/Game/')).map((r) => r.slice('/Game/'.length))
    return { path, objectPath: `/Game/${path}.${name}`, kind: info.kind, size: info.size, route, output, refs }
  })

  assets.sort((a, b) => a.path.localeCompare(b.path))
  return {
    uprojectPath,
    projectName: basename(uprojectPath, extname(uprojectPath)),
    engineVersion,
    engineCmdPath,
    assets
  }
}

// -------------------------------------------------------------- transfer ---

interface ActiveTransfer {
  cancelled: boolean
  child?: ChildProcess
}

let active: { id: string; state: ActiveTransfer } | null = null

function progress(transferId: string, phase: TransferPhase, done: number, total: number, message?: string): void {
  emit('transfer:progress', { transferId, phase, done, total, message })
}

/** Destination must sit inside the Unity project's Assets folder. */
function resolveDestination(unityProjectPath: string, destination: string): string {
  const assetsDir = resolve(unityProjectPath, 'Assets')
  const dir = resolve(unityProjectPath, destination)
  if (dir !== assetsDir && !dir.startsWith(assetsDir + sep)) {
    throw new Error('The destination has to be inside the Unity project\u2019s Assets folder.')
  }
  return dir
}

const metaKindFor = (kind: UnrealAssetKind): MetaKind =>
  kind === 'skeletalMesh' || kind === 'animation' || kind === 'texture' ? kind : 'other'

/**
 * Puts one file into the Unity project: .meta first, so Unity's first import
 * already uses the right settings, then the file itself via a temp name so
 * Unity never picks up a half-written asset.
 */
async function placeFile(
  target: string,
  write: (tempPath: string) => Promise<void>,
  metaKind: MetaKind,
  humanoid: boolean
): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true })
  await writeImportMeta(target, metaKind, humanoid)
  const temp = join(dirname(target), `.${basename(target)}.gbtmp`)
  await write(temp)
  await fs.rm(target, { force: true })
  await fs.rename(temp, target)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

const NOT_TRANSFERABLE: Partial<Record<UnrealAssetKind, string>> = {
  soundCue: 'Sound cues are Unreal-only; the sounds they play transfer on their own',
  metaSound: 'MetaSounds are Unreal-only sound graphs',
  animationAsset: 'Blend spaces and montages are Unreal-only; their animations transfer on their own',
  skeleton: 'Comes across inside each character and animation FBX',
  physics: 'Physics assets are Unreal-only',
  blueprint: 'Blueprints are Unreal-only',
  level: 'Levels are Unreal-only',
  other: 'Not a type GameBridge can transfer'
}

export function cancelTransfer(transferId: string): void {
  if (!active || active.id !== transferId) return
  active.state.cancelled = true
  const pid = active.state.child?.pid
  if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
}

export function cancelAllTransfers(): void {
  if (active) cancelTransfer(active.id)
}

export async function runTransfer(
  req: TransferRequest,
  scan: UnrealScanResult,
  transferId: string = randomUUID()
): Promise<TransferResult> {
  const result: TransferResult = {
    transferId,
    ok: false,
    written: 0,
    exported: 0,
    materials: 0,
    skipped: [],
    failed: [],
    destinationDir: '',
    notes: []
  }
  if (active) {
    result.notes.push('Another transfer is already running.')
    return result
  }
  const state: ActiveTransfer = { cancelled: false }
  active = { id: transferId, state }

  try {
    const destDir = resolveDestination(req.unityProjectPath, req.destination)
    result.destinationDir = destDir
    const contentDir = join(dirname(req.uprojectPath), 'Content')
    const wanted = new Set(req.paths)
    const selected = scan.assets.filter((a) => wanted.has(a.path))

    const direct: UnrealAssetEntry[] = []
    const viaEngine: UnrealAssetEntry[] = []
    const manifest: UnityMaterialManifest = { root: '', materials: [], meshes: [] }
    for (const asset of selected) {
      const target = join(destDir, `${asset.path}.${asset.output}`)
      if (asset.route === 'none') {
        result.skipped.push({ path: asset.path, reason: NOT_TRANSFERABLE[asset.kind] ?? 'Not transferable' })
      } else if (asset.kind === 'material' && !req.options.materials) {
        result.skipped.push({ path: asset.path, reason: 'Rebuilding materials is switched off' })
      } else if (!req.options.overwrite && (await fileExists(target))) {
        result.skipped.push({ path: asset.path, reason: 'Already in the Unity project' })
      } else if (asset.route === 'direct') {
        direct.push(asset)
      } else {
        viaEngine.push(asset)
      }
    }

    // 1. Straight copies out of the packages.
    let done = 0
    for (const asset of direct) {
      if (state.cancelled) break
      progress(transferId, 'copying', done, direct.length, asset.path)
      try {
        const source = await extractEmbeddedSource(join(contentDir, `${asset.path}.uasset`), asset.kind)
        if (source) {
          const target = join(destDir, `${asset.path}.${source.ext}`)
          await placeFile(target, (t) => fs.writeFile(t, source.data), metaKindFor(asset.kind), req.options.humanoid)
          result.written++
        } else {
          viaEngine.push(asset) // the embedded file wasn't where the scan saw it; let Unreal do it
        }
      } catch (e) {
        result.failed.push({ path: asset.path, reason: (e as Error).message })
      }
      done++
    }

    // 2. Everything else through Unreal.
    if (viaEngine.length && !state.cancelled) {
      if (!scan.engineCmdPath) {
        const reason = scan.engineVersion
          ? `Needs Unreal ${scan.engineVersion}, which isn\u2019t installed`
          : 'Needs Unreal, and the project doesn\u2019t say which version'
        for (const a of viaEngine) result.failed.push({ path: a.path, reason })
      } else {
        await exportWithUnreal(req, scan, viaEngine, destDir, state, transferId, result, manifest)
      }
    }

    // 3. Hand the materials to Unity, which builds them the next time it compiles.
    if (req.options.materials && (manifest.materials.length || manifest.meshes.length) && !state.cancelled) {
      manifest.root = relative(req.unityProjectPath, destDir).split(sep).join('/')
      await queueMaterialBuild(req.unityProjectPath, manifest, transferId)
      result.materials = manifest.materials.length
      const n = manifest.materials.length
      result.notes.push(
        `Unity builds ${n === 1 ? 'the material' : `the ${n} materials`} and hooks ${n === 1 ? 'it' : 'them'} up to the models the next time it compiles: switch to Unity, or open the project.`
      )
    }

    result.cancelled = state.cancelled
    result.ok = !state.cancelled && result.failed.length === 0
    progress(transferId, 'finishing', 1, 1)
    return result
  } catch (e) {
    result.failed.push({ path: '', reason: (e as Error).message })
    return result
  } finally {
    active = null
  }
}

// ----------------------------------------------------------- unreal side ---

/** Restarts allowed when Unreal dies mid-batch; the asset it died on is skipped each time. */
const MAX_UNREAL_RESTARTS = 3
const EVENT_PREFIX = 'GAMEBRIDGE|'

interface ExportJobAsset {
  objectPath: string
  kind: UnrealAssetKind
  out: string
}

/** Args for Unreal, quoted by hand: it reads the raw command line, not argv. */
function unrealArgs(uprojectPath: string, scriptPath: string): string[] {
  return [
    `"${uprojectPath}"`,
    '-run=pythonscript',
    `-script="${scriptPath}"`,
    // Python is off by default; this enables it for this run without touching the .uproject.
    '-EnablePlugins=PythonScriptPlugin',
    // Skeletal mesh FBX export needs render resources, which commandlets skip by default.
    '-AllowCommandletRendering',
    '-unattended',
    '-nosplash',
    '-nop4',
    '-stdout',
    '-FullStdOutLogOutput'
  ]
}

async function exportWithUnreal(
  req: TransferRequest,
  scan: UnrealScanResult,
  assets: UnrealAssetEntry[],
  destDir: string,
  state: ActiveTransfer,
  transferId: string,
  result: TransferResult,
  manifest: UnityMaterialManifest
): Promise<void> {
  const work = join(tmpdir(), `gamebridge-transfer-${transferId}`)
  const staging = join(work, 'out')
  await fs.mkdir(staging, { recursive: true })
  const scriptPath = join(work, 'gamebridge_export.py')
  await fs.writeFile(scriptPath, exportScript, 'utf-8')

  const byObject = new Map(assets.map((a) => [a.objectPath, a]))
  let remaining = assets.slice()
  let exportedCount = 0

  try {
    for (let attempt = 0; attempt <= MAX_UNREAL_RESTARTS && remaining.length && !state.cancelled; attempt++) {
      const job: ExportJobAsset[] = remaining.map((a) => ({
        objectPath: a.objectPath,
        kind: a.kind,
        out: stagedPath(staging, a)
      }))
      const jobPath = join(work, `job-${attempt}.json`)
      await fs.writeFile(jobPath, JSON.stringify({ assets: job }), 'utf-8')

      progress(
        transferId,
        'starting-unreal',
        exportedCount,
        assets.length,
        attempt === 0 ? `Starting Unreal ${scan.engineVersion ?? ''}\u2026` : 'Unreal stopped; starting it again for the rest\u2026'
      )

      const reported = new Set<string>()
      let finished = false
      let startError: string | undefined
      let lastLines: string[] = []

      await new Promise<void>((resolveRun) => {
        const exe = scan.engineCmdPath as string
        const child = spawn(exe, unrealArgs(req.uprojectPath, scriptPath), {
          env: { ...process.env, GAMEBRIDGE_JOB: jobPath },
          // Verbatim so our own quoting reaches Unreal; argv0 quoted for engines under Program Files.
          argv0: `"${exe}"`,
          windowsHide: true,
          windowsVerbatimArguments: true
        })
        state.child = child
        let pending: Promise<void> = Promise.resolve()
        let buffer = ''
        const onData = (chunk: Buffer): void => {
          buffer += chunk.toString('utf-8')
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trimEnd()
            buffer = buffer.slice(nl + 1)
            lastLines.push(line)
            if (lastLines.length > 40) lastLines = lastLines.slice(-40)
            const at = line.indexOf(EVENT_PREFIX)
            if (at < 0) continue
            let event: { event: string; objectPath?: string; ok?: boolean; error?: string | null }
            try {
              event = JSON.parse(line.slice(at + EVENT_PREFIX.length))
            } catch {
              continue
            }
            if (event.event === 'done') finished = true
            if (event.event !== 'asset' || !event.objectPath) continue
            reported.add(event.objectPath)
            const asset = byObject.get(event.objectPath)
            if (!asset) continue
            pending = pending.then(() =>
              collectExport(asset, event.ok === true, event.error, staging, destDir, req, result, manifest)
            )
            exportedCount++
            progress(transferId, 'exporting', exportedCount, assets.length, asset.path)
          }
        }
        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)
        child.on('error', (e) => {
          startError = e.message
          pending.then(() => resolveRun())
        })
        child.on('close', () => {
          pending.then(() => resolveRun())
        })
      })
      state.child = undefined

      // Unreal's exit code is unreliable (it returns 1 for harmless log errors);
      // what matters is which assets it reported on.
      remaining = remaining.filter((a) => !reported.has(a.objectPath))
      if (startError && !reported.size) {
        for (const a of remaining) result.failed.push({ path: a.path, reason: `Couldn’t start Unreal: ${startError}` })
        remaining = []
      }
      if (finished || state.cancelled || !remaining.length) break

      // It died part way: the first unreported asset is the likely culprit.
      const culprit = remaining.shift()
      if (culprit) {
        const hint = lastLines.reverse().find((l) => /Assertion failed|Fatal error|Critical error/i.test(l))
        result.failed.push({
          path: culprit.path,
          reason: `Unreal crashed exporting this${hint ? `: ${hint.replace(/^\[[^\]]*\]\[[^\]]*\]/, '').trim()}` : ''}`
        })
        exportedCount++
      }
    }
    // Out of restarts (or cancelled): nothing left over may go unreported.
    const reason = state.cancelled ? 'Cancelled' : 'Unreal kept stopping before it got to this'
    for (const a of remaining) result.failed.push({ path: a.path, reason })
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/** Materials come back from Unreal as a description, not a file Unity can use directly. */
const stagedPath = (staging: string, asset: UnrealAssetEntry): string =>
  join(staging, asset.kind === 'material' ? `${asset.path}.gbmat.json` : `${asset.path}.${asset.output}`)

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function collectExport(
  asset: UnrealAssetEntry,
  ok: boolean,
  error: string | null | undefined,
  staging: string,
  destDir: string,
  req: TransferRequest,
  result: TransferResult,
  manifest: UnityMaterialManifest
): Promise<void> {
  if (!ok) {
    result.failed.push({ path: asset.path, reason: error ?? 'Unreal couldn\u2019t export it' })
    return
  }
  const from = stagedPath(staging, asset)

  if (asset.kind === 'material') {
    const desc = await readJson<UnrealMaterialDescription>(from)
    if (desc) manifest.materials.push(toUnitySpec(asset.path, desc))
    else result.failed.push({ path: asset.path, reason: 'Unreal didn\u2019t describe the material' })
    return
  }

  const target = join(destDir, `${asset.path}.${asset.output}`)
  try {
    await placeFile(target, (t) => fs.rename(from, t), metaKindFor(asset.kind), req.options.humanoid)
    result.written++
    result.exported++
  } catch (e) {
    result.failed.push({ path: asset.path, reason: (e as Error).message })
    return
  }

  // Which material each slot uses, so Unity can point the model at the rebuilt ones.
  const slots = req.options.materials ? await readJson<{ slot: string; material: string }[]>(`${from}.slots.json`) : null
  const usable = (slots ?? []).filter((s) => s.material.startsWith('/Game/'))
  if (usable.length) {
    manifest.meshes.push({
      path: asset.path,
      slots: usable.map((s) => ({
        name: s.material.split('/').pop() ?? s.material,
        material: s.material.slice('/Game/'.length)
      }))
    })
  }
}

// ------------------------------------------------------- fab downloads ---

const TAR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
const JUNK = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini'])
const UNREAL_FILES = new Set(['.uasset', '.umap', '.uexp', '.ubulk'])

function runTar(args: string[]): Promise<void> {
  return new Promise((resolveTar, reject) => {
    const child = spawn(TAR, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolveTar() : reject(new Error(err.trim() || `tar exited with ${code}`))))
  })
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((e) => !JUNK.has(e.name.toLowerCase()))
      .map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : Promise.resolve([join(dir, e.name)])))
  )
  return nested.flat()
}

/** If everything sits in one top folder (as zips usually do), that folder is the root. */
async function contentRoot(dir: string): Promise<string> {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => !JUNK.has(e.name.toLowerCase()))
  return entries.length === 1 && entries[0].isDirectory() ? contentRoot(join(dir, entries[0].name)) : dir
}

async function hasGltfPackage(unityProjectPath: string): Promise<boolean> {
  try {
    const manifest = await fs.readFile(join(unityProjectPath, 'Packages', 'manifest.json'), 'utf-8')
    return /com\.unity\.cloud\.gltfast|com\.atteneder\.gltfast/.test(manifest)
  } catch {
    return false
  }
}

/**
 * A .unitypackage is a gzipped tar of GUID-named folders, each holding the
 * asset, its .meta and a `pathname` file. Unpacking it by hand keeps the
 * author's GUIDs, so prefabs and materials still find their textures.
 */
async function installUnityPackage(
  packagePath: string,
  work: string,
  req: FabImportRequest,
  result: TransferResult
): Promise<void> {
  const unpacked = join(work, `pkg-${randomUUID()}`)
  await fs.mkdir(unpacked, { recursive: true })
  await runTar(['-xzf', packagePath, '-C', unpacked])

  const assetsDir = resolve(req.unityProjectPath, 'Assets')
  const placed = new Set<string>()
  for (const guidDir of await fs.readdir(unpacked)) {
    const dir = join(unpacked, guidDir)
    let pathname: string
    try {
      pathname = (await fs.readFile(join(dir, 'pathname'), 'utf-8')).split('\n')[0].trim()
    } catch {
      continue
    }
    const target = resolve(req.unityProjectPath, pathname)
    if (target !== assetsDir && !target.startsWith(assetsDir + sep)) {
      result.skipped.push({ path: pathname, reason: 'Points outside Assets' })
      continue
    }
    const hasAsset = await fileExists(join(dir, 'asset'))
    if (!hasAsset) {
      await fs.mkdir(target, { recursive: true }) // a folder entry
    } else if (!req.options.overwrite && (await fileExists(target))) {
      result.skipped.push({ path: pathname, reason: 'Already in the Unity project' })
      continue
    } else {
      await fs.mkdir(dirname(target), { recursive: true })
      if (await fileExists(join(dir, 'asset.meta'))) {
        if (!(await fileExists(`${target}.meta`))) await fs.copyFile(join(dir, 'asset.meta'), `${target}.meta`)
      }
      await fs.copyFile(join(dir, 'asset'), target)
      result.written++
      placed.add(pathname.split('/').slice(0, 3).join('/'))
      continue
    }
    if (!(await fileExists(`${target}.meta`)) && (await fileExists(join(dir, 'asset.meta')))) {
      await fs.copyFile(join(dir, 'asset.meta'), `${target}.meta`)
    }
  }
  if (placed.size) {
    result.notes.push(`Unity packages go where their author put them: ${[...placed].slice(0, 3).join(', ')}`)
  }
}

export async function importFabArchive(req: FabImportRequest, transferId: string = randomUUID()): Promise<TransferResult> {
  const result: TransferResult = {
    transferId,
    ok: false,
    written: 0,
    exported: 0,
    materials: 0,
    skipped: [],
    failed: [],
    destinationDir: '',
    notes: []
  }
  const work = join(tmpdir(), `gamebridge-fab-${transferId}`)
  try {
    const destDir = resolveDestination(req.unityProjectPath, req.destination)
    result.destinationDir = destDir
    await fs.mkdir(work, { recursive: true })
    progress(transferId, 'extracting', 0, 1, basename(req.archivePath))

    const ext = extname(req.archivePath).toLowerCase()
    if (ext === '.unitypackage') {
      await installUnityPackage(req.archivePath, work, req, result)
      result.destinationDir = resolve(req.unityProjectPath, 'Assets')
    } else {
      const unzipped = join(work, 'zip')
      await fs.mkdir(unzipped, { recursive: true })
      await runTar(['-xf', req.archivePath, '-C', unzipped])
      const root = await contentRoot(unzipped)
      const files = await listFiles(root)

      let done = 0
      let unrealCount = 0
      let gltf = false
      let blend = false
      for (const file of files) {
        done++
        progress(transferId, 'copying', done, files.length, relative(root, file))
        const fileExt = extname(file).toLowerCase()
        const rel = relative(root, file).split(sep).join('/')
        if (fileExt === '.unitypackage') {
          await installUnityPackage(file, work, req, result)
          continue
        }
        if (UNREAL_FILES.has(fileExt)) {
          unrealCount++
          continue
        }
        if (fileExt === '.glb' || fileExt === '.gltf') gltf = true
        if (fileExt === '.blend') blend = true
        const target = join(destDir, rel)
        if (!req.options.overwrite && (await fileExists(target))) {
          result.skipped.push({ path: rel, reason: 'Already in the Unity project' })
          continue
        }
        try {
          const kind: MetaKind = /\.(png|tga|jpe?g|psd|exr|tiff?)$/i.test(file) ? 'texture' : 'other'
          await placeFile(target, (t) => fs.copyFile(file, t), kind, false)
          result.written++
        } catch (e) {
          result.failed.push({ path: rel, reason: (e as Error).message })
        }
      }
      if (unrealCount) {
        result.skipped.push({
          path: `${unrealCount} Unreal files`,
          reason: 'Unreal-format assets. Add them to an Unreal project and transfer from there'
        })
      }
      if (gltf && !(await hasGltfPackage(req.unityProjectPath))) {
        result.notes.push('This pack has .glb/.gltf models. Unity needs the glTFast package (com.unity.cloud.gltfast) to import them.')
      }
      if (blend) result.notes.push('This pack has .blend files. Unity only imports those if Blender is installed.')
    }

    result.ok = result.failed.length === 0
    progress(transferId, 'finishing', 1, 1)
    return result
  } catch (e) {
    result.failed.push({ path: basename(req.archivePath), reason: (e as Error).message })
    return result
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
