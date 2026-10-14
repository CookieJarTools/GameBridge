import { promises as fs, type Dirent } from 'fs'
import { createHash } from 'crypto'
import { extname, join, relative, sep } from 'path'
import type {
  AssetCategoryTotal,
  AssetFileInfo,
  AssetFinding,
  AssetScanResult,
  EngineKind
} from '@shared/types'

/**
 * Static analysis of a project on disk — no engine required.
 *
 * Answers the questions you normally have to open the editor for: what is big,
 * what is imported badly, what is duplicated, and how much disk the engine's
 * own caches are eating.
 */

type Emit = (channel: string, payload: unknown) => void
let emit: Emit = () => {}
export function setAssetEmitter(fn: Emit): void {
  emit = fn
}

/** Folders that never ship but are worth reporting the size of. */
const OVERHEAD_DIRS = new Set([
  'library',
  'temp',
  'obj',
  'build',
  'builds',
  'binaries',
  'intermediate',
  'saved',
  'deriveddatacache',
  'logs',
  'usersettings',
  'bin',
  '.vs',
  'node_modules'
])

/** Never walked at all. */
const IGNORED_DIRS = new Set(['.git', '.svn', '.idea', '.vscode', '.gradle', '__pycache__'])

const EXT_CATEGORY: Record<string, string> = {}
const defineCategory = (category: string, exts: string[]): void => {
  for (const e of exts) EXT_CATEGORY[e] ??= category
}
defineCategory('Textures', [
  'png', 'jpg', 'jpeg', 'tga', 'psd', 'psb', 'tif', 'tiff', 'exr', 'bmp',
  'gif', 'hdr', 'dds', 'ktx', 'astc', 'svg', 'webp', 'cubemap'
])
defineCategory('Models', ['fbx', 'obj', 'blend', 'dae', '3ds', 'max', 'ma', 'mb', 'gltf', 'glb', 'ply', 'stl'])
defineCategory('Audio', ['wav', 'mp3', 'ogg', 'aiff', 'aif', 'flac', 'm4a', 'xm', 'it', 'mod', 's3m'])
defineCategory('Video', ['mp4', 'mov', 'webm', 'avi', 'mkv', 'ogv'])
defineCategory('Scenes', ['unity', 'umap', 'scene'])
defineCategory('Prefabs', ['prefab'])
defineCategory('Shaders', [
  'shader', 'shadergraph', 'shadersubgraph', 'cginc', 'hlsl', 'glslinc', 'compute', 'usf', 'ush', 'raytrace'
])
defineCategory('Scripts', ['cs', 'js', 'ts', 'cpp', 'cc', 'c', 'h', 'hpp', 'py', 'lua', 'java', 'mm', 'swift'])
defineCategory('Animation', ['anim', 'controller', 'overridecontroller', 'mask', 'playable', 'timeline'])
defineCategory('Fonts', ['ttf', 'otf', 'fontsettings', 'woff', 'woff2'])
defineCategory('Materials', ['mat', 'physicmaterial', 'physicsmaterial2d'])
defineCategory('Unreal assets', ['uasset'])
defineCategory('Binaries', ['dll', 'so', 'a', 'lib', 'dylib', 'jar', 'aar', 'pdb', 'exe'])
defineCategory('Archives', ['unitypackage', 'zip', '7z', 'rar', 'tar', 'gz'])
defineCategory('Data', ['asset', 'json', 'xml', 'csv', 'txt', 'yaml', 'yml', 'bytes', 'bin', 'sqlite', 'db'])
defineCategory('Meta', ['meta'])

const TEXTURE_EXT = new Set(['png', 'jpg', 'jpeg', 'tga', 'psd', 'psb', 'tif', 'tiff', 'exr', 'bmp'])
const AUDIO_EXT = new Set(['wav', 'aiff', 'aif', 'flac', 'mp3', 'ogg'])
const SOURCE_ART_EXT = new Set(['psd', 'psb', 'tif', 'tiff'])

const FILE_CAP = 250_000
const LARGE_FILE = 50 * 1024 * 1024
const TEXTURE_META_MIN = 512 * 1024
const AUDIO_META_MIN = 1024 * 1024
const DUPLICATE_MIN = 256 * 1024

const cancelled = new Set<string>()

export function cancelAssetScan(projectId: string): void {
  cancelled.add(projectId)
}

export function categoryOf(ext: string): string {
  return EXT_CATEGORY[ext] ?? 'Other'
}

/** Which folders hold the source assets for each engine. */
export function scanRoots(kind: EngineKind | undefined): string[] {
  if (kind === 'unity') return ['Assets', 'Packages', 'ProjectSettings']
  if (kind === 'unreal') return ['Content', 'Source', 'Config', 'Plugins']
  return [] // custom engines: walk the whole project
}

export interface FileRec {
  path: string
  bytes: number
  ext: string
}

export interface WalkState {
  files: FileRec[]
  totalBytes: number
  totalFiles: number
  overhead: Map<string, { bytes: number; files: number }>
  truncated: boolean
}

/** Recursive walk that accounts for overhead folders without collecting them. */
async function walk(
  dir: string,
  root: string,
  state: WalkState,
  projectId: string,
  overheadLabel?: string
): Promise<void> {
  if (state.truncated || cancelled.has(projectId)) return

  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable folder (permissions, junction) — skip it
  }

  for (const entry of entries) {
    if (state.truncated || cancelled.has(projectId)) return
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase()
      if (IGNORED_DIRS.has(lower)) continue
      // Only treat these as overhead at the top level of the project.
      const isOverhead = overheadLabel ?? (dir === root && OVERHEAD_DIRS.has(lower) ? entry.name : undefined)
      await walk(full, root, state, projectId, isOverhead)
      continue
    }
    if (!entry.isFile()) continue // symlink/junction — don't follow

    let bytes = 0
    try {
      bytes = (await fs.stat(full)).size
    } catch {
      continue
    }

    state.totalFiles++
    if (state.totalFiles % 2000 === 0) {
      emit('assets:progress', { projectId, files: state.totalFiles, current: full })
    }
    if (state.totalFiles > FILE_CAP) {
      state.truncated = true
      return
    }

    if (overheadLabel) {
      const cur = state.overhead.get(overheadLabel) ?? { bytes: 0, files: 0 }
      cur.bytes += bytes
      cur.files++
      state.overhead.set(overheadLabel, cur)
      continue
    }

    state.totalBytes += bytes
    state.files.push({ path: full, bytes, ext: extname(entry.name).slice(1).toLowerCase() })
  }
}

/** Pull the handful of import settings we care about out of a .meta file. */
async function readMeta(path: string): Promise<Record<string, number> | undefined> {
  try {
    const text = await fs.readFile(path + '.meta', 'utf-8')
    const out: Record<string, number> = {}
    for (const key of [
      'maxTextureSize',
      'textureCompression',
      'crunchedCompression',
      'compressionFormat',
      'loadType',
      'forceToMono'
    ]) {
      const m = text.match(new RegExp('\\b' + key + ':\\s*(-?\\d+)'))
      if (m) out[key] = parseInt(m[1], 10)
    }
    return out
  } catch {
    return undefined
  }
}

/** Content key for duplicate detection: cheap for big files, exact for small ones. */
async function contentKey(file: FileRec): Promise<string | undefined> {
  try {
    if (file.bytes <= 16 * 1024 * 1024) {
      return createHash('sha1').update(await fs.readFile(file.path)).digest('hex')
    }
    const handle = await fs.open(file.path, 'r')
    try {
      const head = Buffer.alloc(262144)
      const tail = Buffer.alloc(262144)
      await handle.read(head, 0, head.length, 0)
      await handle.read(tail, 0, tail.length, file.bytes - tail.length)
      return createHash('sha1').update(head).update(tail).digest('hex') + ':partial'
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

function humanList(paths: string[], root: string, cap = 8): string[] {
  return paths.slice(0, cap).map((p) => relative(root, p).split(sep).join('/'))
}

/**
 * Walk a project's source folders (and account for its generated ones).
 * Shared with the cleanup pass so a project is only ever traversed once per
 * request rather than once per feature.
 */
export async function collectFiles(
  projectId: string,
  projectPath: string,
  kind: EngineKind | undefined,
  includeOverhead = true
): Promise<WalkState> {
  cancelled.delete(projectId)

  const state: WalkState = {
    files: [],
    totalBytes: 0,
    totalFiles: 0,
    overhead: new Map(),
    truncated: false
  }

  const roots = scanRoots(kind)
  if (roots.length === 0) {
    await walk(projectPath, projectPath, state, projectId)
    return state
  }

  for (const r of roots) {
    const dir = join(projectPath, r)
    try {
      if ((await fs.stat(dir)).isDirectory()) await walk(dir, dir, state, projectId)
    } catch {
      /* project doesn't have this folder */
    }
  }
  if (!includeOverhead) return state

  // Account for the engine's caches separately — they never ship.
  for (const name of OVERHEAD_DIRS) {
    const dir = join(projectPath, name)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) continue
      const label = name.charAt(0).toUpperCase() + name.slice(1)
      await walk(dir, dir, state, projectId, label)
    } catch {
      /* not present */
    }
  }
  return state
}

export async function scanAssets(
  projectId: string,
  projectPath: string,
  kind: EngineKind | undefined
): Promise<AssetScanResult> {
  const state = await collectFiles(projectId, projectPath, kind)

  /* ------------------------------------------------------------ aggregate */

  const byCategory = new Map<string, { bytes: number; files: number }>()
  for (const f of state.files) {
    const c = categoryOf(f.ext)
    const cur = byCategory.get(c) ?? { bytes: 0, files: 0 }
    cur.bytes += f.bytes
    cur.files++
    byCategory.set(c, cur)
  }

  const categories: AssetCategoryTotal[] = [...byCategory.entries()]
    .map(([category, v]) => ({ category, bytes: v.bytes, files: v.files }))
    .sort((a, b) => b.bytes - a.bytes)

  const largest: AssetFileInfo[] = [...state.files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 60)
    .map((f) => ({
      path: relative(projectPath, f.path).split(sep).join('/'),
      bytes: f.bytes,
      category: categoryOf(f.ext)
    }))

  const overhead: AssetCategoryTotal[] = [...state.overhead.entries()]
    .map(([category, v]) => ({ category, bytes: v.bytes, files: v.files }))
    .sort((a, b) => b.bytes - a.bytes)

  /* ------------------------------------------------------------- findings */

  const findings: AssetFinding[] = []
  const add = (f: AssetFinding): void => {
    if (f.paths.length || f.bytes) findings.push(f)
  }

  const bigFiles = state.files.filter((f) => f.bytes >= LARGE_FILE).sort((a, b) => b.bytes - a.bytes)
  add({
    id: 'large-files',
    severity: 'warn',
    title: `${bigFiles.length} file${bigFiles.length === 1 ? '' : 's'} over 50 MB`,
    detail: 'Large source files slow imports and bloat source control. Consider LFS or streaming them.',
    paths: humanList(bigFiles.map((f) => f.path), projectPath),
    bytes: bigFiles.reduce((n, f) => n + f.bytes, 0)
  })

  if (kind === 'unity') {
    const uncompressed: FileRec[] = []
    const oversized: FileRec[] = []
    const pcmAudio: FileRec[] = []
    const missingMeta: FileRec[] = []

    for (const f of state.files) {
      if (f.ext === 'meta') continue
      const isTexture = TEXTURE_EXT.has(f.ext)
      const isAudio = AUDIO_EXT.has(f.ext)

      if (isTexture && f.bytes >= TEXTURE_META_MIN) {
        const meta = await readMeta(f.path)
        if (meta) {
          if (meta.textureCompression === 0 && !meta.crunchedCompression) uncompressed.push(f)
          if ((meta.maxTextureSize ?? 0) >= 4096) oversized.push(f)
        }
      } else if (isAudio && f.bytes >= AUDIO_META_MIN) {
        const meta = await readMeta(f.path)
        // compressionFormat 0 = PCM, loadType 0 = Decompress On Load.
        if (meta && (meta.compressionFormat === 0 || meta.loadType === 0)) pcmAudio.push(f)
      }
    }

    // A source asset under Assets/ with no .meta hasn't been imported yet.
    const haveMeta = new Set(state.files.filter((f) => f.ext === 'meta').map((f) => f.path.slice(0, -5)))
    const assetsDir = join(projectPath, 'Assets') + sep
    for (const f of state.files) {
      if (f.ext === 'meta' || !f.path.startsWith(assetsDir)) continue
      if (!haveMeta.has(f.path)) missingMeta.push(f)
    }

    add({
      id: 'uncompressed-textures',
      severity: 'warn',
      title: `${uncompressed.length} large texture${uncompressed.length === 1 ? '' : 's'} imported uncompressed`,
      detail: 'Texture Compression is set to None. Compressing these usually cuts VRAM and build size several-fold.',
      paths: humanList(uncompressed.map((f) => f.path), projectPath),
      bytes: uncompressed.reduce((n, f) => n + f.bytes, 0)
    })
    add({
      id: 'oversized-textures',
      severity: 'info',
      title: `${oversized.length} texture${oversized.length === 1 ? '' : 's'} allowed up to 4K or larger`,
      detail: 'Max Size is 4096+. Worth checking each one really needs that resolution on your target platform.',
      paths: humanList(oversized.map((f) => f.path), projectPath),
      bytes: oversized.reduce((n, f) => n + f.bytes, 0)
    })
    add({
      id: 'pcm-audio',
      severity: 'warn',
      title: `${pcmAudio.length} large audio clip${pcmAudio.length === 1 ? '' : 's'} uncompressed or decompressed on load`,
      detail: 'Long clips are usually better as Vorbis with Streaming or Compressed In Memory load type.',
      paths: humanList(pcmAudio.map((f) => f.path), projectPath),
      bytes: pcmAudio.reduce((n, f) => n + f.bytes, 0)
    })
    add({
      id: 'missing-meta',
      severity: 'error',
      title: `${missingMeta.length} asset${missingMeta.length === 1 ? '' : 's'} with no .meta file`,
      detail: 'Unity generates these on import. Missing ones mean broken references for anyone else who pulls the project.',
      paths: humanList(missingMeta.map((f) => f.path), projectPath)
    })

    const sourceArt = state.files.filter((f) => SOURCE_ART_EXT.has(f.ext))
    add({
      id: 'source-art',
      severity: 'info',
      title: `${sourceArt.length} layered source file${sourceArt.length === 1 ? '' : 's'} (PSD/TIFF) under Assets`,
      detail: 'Unity imports these as textures, flattening them each time. Keeping source art outside Assets speeds imports.',
      paths: humanList(sourceArt.map((f) => f.path), projectPath),
      bytes: sourceArt.reduce((n, f) => n + f.bytes, 0)
    })
  }

  // Duplicates: same size first (cheap), then hash only the candidates.
  const bySize = new Map<number, FileRec[]>()
  for (const f of state.files) {
    if (f.bytes < DUPLICATE_MIN || f.ext === 'meta') continue
    const list = bySize.get(f.bytes) ?? []
    list.push(f)
    bySize.set(f.bytes, list)
  }
  const dupes: { paths: string[]; wasted: number }[] = []
  for (const [bytes, list] of bySize) {
    if (list.length < 2 || cancelled.has(projectId)) continue
    const byHash = new Map<string, FileRec[]>()
    for (const f of list) {
      const key = await contentKey(f)
      if (!key) continue
      const group = byHash.get(key) ?? []
      group.push(f)
      byHash.set(key, group)
    }
    for (const group of byHash.values()) {
      if (group.length > 1) {
        dupes.push({ paths: group.map((f) => f.path), wasted: bytes * (group.length - 1) })
      }
    }
  }
  dupes.sort((a, b) => b.wasted - a.wasted)
  add({
    id: 'duplicates',
    severity: 'warn',
    title: `${dupes.length} set${dupes.length === 1 ? '' : 's'} of duplicate files`,
    detail: 'Byte-identical files imported more than once. Deleting the copies saves both disk and build size.',
    paths: humanList(dupes.flatMap((d) => d.paths), projectPath, 10),
    bytes: dupes.reduce((n, d) => n + d.wasted, 0)
  })

  const libraryBytes = overhead.find((o) => o.category.toLowerCase() === 'library')?.bytes ?? 0
  if (libraryBytes > 5 * 1024 * 1024 * 1024) {
    findings.push({
      id: 'library-size',
      severity: 'info',
      title: 'Library folder is over 5 GB',
      detail: 'Safe to delete when the editor is closed — Unity rebuilds it on next open (a slow first import).',
      paths: [],
      bytes: libraryBytes
    })
  }

  const severityRank = { error: 0, warn: 1, info: 2 }
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || (b.bytes ?? 0) - (a.bytes ?? 0))

  return {
    projectId,
    root: projectPath,
    scannedAt: Date.now(),
    totalBytes: state.totalBytes,
    totalFiles: state.totalFiles,
    truncated: state.truncated,
    categories,
    largest,
    findings,
    overhead
  }
}
