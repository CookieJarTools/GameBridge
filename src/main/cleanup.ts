import { app, shell } from 'electron'
import { promises as fs } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { dirname, join, relative, resolve, sep } from 'path'
import type {
  CleanupActionResult,
  CleanupCandidate,
  CleanupConfidence,
  CleanupReason,
  CleanupReport,
  EngineKind,
  Project,
  QuarantineEntry
} from '@shared/types'
import { categoryOf, collectFiles, type FileRec } from './assetscan'
import { readBuildContents } from './unitybuild'

/**
 * Working out what a project can lose.
 *
 * The strong signal is "the last build didn't include this", but that is never
 * proof: Addressables, asset bundles, StreamingAssets and anything loaded by
 * name at runtime are invisible to a build report. So everything here carries a
 * confidence, whole categories are excluded from suggestion outright, and the
 * default action moves files to a quarantine folder rather than deleting them.
 */

/* ---------------------------------------------------------------- exclusions */

/** Folder names that mean "never suggest anything inside this". */
const EXCLUDED_SEGMENTS = new Set([
  'editor', // editor-only code and tooling is never in a player build
  'streamingassets', // copied verbatim, never appears as a packed asset
  'gamebridge' // our own injected folder
])

/** Extensions we never suggest removing — too load-bearing, or invisible to the report. */
const NEVER_SUGGEST = new Set([
  'cs', 'asmdef', 'asmref', 'rsp', 'dll', 'so', 'a', 'dylib', 'jslib', 'jspre',
  'aar', 'androidlib', 'h', 'hpp', 'cpp', 'c', 'm', 'mm', 'java', 'kt', 'meta',
  'asset', 'preset', 'unitypackage'
])

/** Extensions where "not in the build" is weak evidence (stripping, indirection). */
const LOW_CONFIDENCE_EXT = new Set([
  'shader', 'shadergraph', 'shadersubgraph', 'compute', 'cginc', 'hlsl', 'glslinc',
  'json', 'xml', 'txt', 'bytes', 'uss', 'uxml', 'inputactions', 'spriteatlas', 'spriteatlasv2'
])

const MEDIA_EXT = new Set([
  'png', 'jpg', 'jpeg', 'tga', 'psd', 'psb', 'tif', 'tiff', 'exr', 'bmp', 'gif', 'hdr',
  'wav', 'mp3', 'ogg', 'aiff', 'aif', 'flac',
  'fbx', 'obj', 'blend', 'dae', 'gltf', 'glb',
  'mp4', 'mov', 'webm', 'avi'
])

/* ------------------------------------------------------------------ helpers */

/** Project-relative, forward slashes — the form used everywhere in this module. */
function rel(projectPath: string, absolute: string): string {
  return relative(projectPath, absolute).split(sep).join('/')
}

/** Refuse anything that would escape the project's Assets folder. */
function insideAssets(projectPath: string, relativePath: string): boolean {
  if (!relativePath || relativePath.includes('..')) return false
  const abs = resolve(projectPath, relativePath)
  const assets = resolve(projectPath, 'Assets')
  return abs.startsWith(assets + sep)
}

function segments(relativePath: string): string[] {
  return relativePath.toLowerCase().split('/')
}

function excluded(relativePath: string): boolean {
  return segments(relativePath).some((s) => EXCLUDED_SEGMENTS.has(s))
}

/* ------------------------------------------------------------------ caveats */

/** Things about this project that make "not in the build" less trustworthy. */
async function findCaveats(projectPath: string, files: FileRec[]): Promise<string[]> {
  const caveats: string[] = []
  const has = async (p: string): Promise<boolean> => {
    try {
      await fs.access(join(projectPath, p))
      return true
    } catch {
      return false
    }
  }

  if (await has(join('Assets', 'AddressableAssetsData'))) {
    caveats.push(
      'This project uses Addressables. Addressable assets are built into bundles, not the player, so they will look unused here.'
    )
  }
  if (await has(join('Assets', 'StreamingAssets'))) {
    caveats.push(
      'StreamingAssets is copied into the build verbatim and never appears in the report, so nothing under it is suggested.'
    )
  }
  if (files.some((f) => segments(f.path).includes('resources'))) {
    caveats.push(
      'Resources folders are loaded by name at runtime. Everything in them ships, so anything listed from one really was unreferenced.'
    )
  }
  return caveats
}

/* ------------------------------------------------------------------ the scan */

export async function computeCleanup(
  project: Project,
  kind: EngineKind | undefined,
  reportPath: string | undefined,
  buildLabel: string | undefined,
  buildId: string | undefined
): Promise<CleanupReport> {
  const state = await collectFiles(project.id, project.path, kind, false)
  const files = state.files.map((f) => ({ ...f, rel: rel(project.path, f.path) }))

  const contents = reportPath ? await readBuildContents(reportPath) : undefined
  const heuristicsOnly = !contents || contents.assets.size === 0
  const keep = new Set((project.keepAssets ?? []).map((p) => p.toLowerCase()))
  const caveats = await findCaveats(project.path, files)
  const addressables = caveats.some((c) => c.startsWith('This project uses Addressables'))

  const candidates: CleanupCandidate[] = []
  const add = (
    f: { rel: string; bytes: number; ext: string },
    reason: CleanupCandidate['reason'],
    confidence: CleanupConfidence,
    detail: string
  ): void => {
    candidates.push({
      path: f.rel,
      bytes: f.bytes,
      category: categoryOf(f.ext),
      reason,
      confidence,
      detail
    })
  }

  /* 1. In the project, not in the build. */
  if (contents) {
    for (const f of files) {
      if (!f.rel.toLowerCase().startsWith('assets/')) continue
      if (keep.has(f.rel.toLowerCase()) || excluded(f.rel) || NEVER_SUGGEST.has(f.ext)) continue

      if (f.ext === 'unity') {
        // No scene list at all means we can't tell — never guess for scenes.
        if (contents.scenes.size === 0) continue
        if (contents.scenes.has(f.rel.toLowerCase())) continue
        add(
          f,
          'unused-scene',
          'medium',
          'Not in the build — it is not an enabled scene in Build Settings.'
        )
        continue
      }

      if (contents.assets.has(f.rel.toLowerCase())) continue

      const confidence: CleanupConfidence = addressables
        ? 'low'
        : LOW_CONFIDENCE_EXT.has(f.ext)
          ? 'low'
          : MEDIA_EXT.has(f.ext)
            ? 'high'
            : 'medium'
      add(
        f,
        'not-in-build',
        confidence,
        confidence === 'high'
          ? 'The last build did not include this asset.'
          : 'The last build did not include this, but assets of this kind can be loaded in ways a build report cannot see.'
      )
    }
  }

  /* 2. Heuristics that need no build. */
  const byRel = new Map(files.map((f) => [f.rel.toLowerCase(), f]))

  // Orphaned .meta — its asset is gone, so Unity will never use it again.
  for (const f of files) {
    if (f.ext !== 'meta') continue
    const owner = f.rel.slice(0, -5)
    if (byRel.has(owner.toLowerCase())) continue
    if (keep.has(f.rel.toLowerCase()) || excluded(f.rel)) continue
    add(f, 'orphan-meta', 'high', 'The asset this .meta described no longer exists.')
  }

  // Byte-identical duplicates.
  const bySize = new Map<number, typeof files>()
  for (const f of files) {
    if (f.bytes < 256 * 1024 || f.ext === 'meta') continue
    const list = bySize.get(f.bytes) ?? []
    list.push(f)
    bySize.set(f.bytes, list)
  }
  for (const [, list] of bySize) {
    if (list.length < 2) continue
    const byHash = new Map<string, typeof files>()
    for (const f of list) {
      try {
        const hash = createHash('sha1').update(await fs.readFile(f.path)).digest('hex')
        const group = byHash.get(hash) ?? []
        group.push(f)
        byHash.set(hash, group)
      } catch {
        /* unreadable — skip */
      }
    }
    for (const group of byHash.values()) {
      if (group.length < 2) continue

      /*
       * A copy that shipped is referenced by something — deleting it breaks
       * that reference, whatever its twin is called. So with a build to go on,
       * only ever suggest the copies it didn't include. Without one there is no
       * way to tell which copy is the referenced one, so keep the first and say
       * the rest merit a check rather than presenting them as safe.
       */
      const shipped = contents
        ? group.filter((f) => contents.assets.has(f.rel.toLowerCase()))
        : []
      const survivor = shipped[0] ?? group[0]
      const removable = contents
        ? group.filter((f) => !contents.assets.has(f.rel.toLowerCase()))
        : group.slice(1)

      for (const f of removable) {
        if (f === survivor) continue
        if (keep.has(f.rel.toLowerCase())) continue
        if (excluded(f.rel) || NEVER_SUGGEST.has(f.ext)) continue
        add(
          f,
          'duplicate',
          contents ? 'high' : 'medium',
          contents
            ? `Byte-identical to ${survivor.rel}, which is the copy the build used.`
            : `Byte-identical to ${survivor.rel}. Without a build, there is no telling which copy is the referenced one.`
        )
      }
    }
  }

  // Layered source art imported as a texture — usually belongs outside Assets.
  for (const f of files) {
    if (!['psd', 'psb', 'tif', 'tiff'].includes(f.ext)) continue
    if (keep.has(f.rel.toLowerCase()) || excluded(f.rel)) continue
    add(
      f,
      'source-art',
      'low',
      'Layered source art under Assets. Unity flattens it on every import; keeping it outside the project speeds imports up.'
    )
  }

  /*
   * One entry per path. Confidence decides first; where two reasons are equally
   * confident the more specific one is the more useful thing to show — being a
   * duplicate of a shipped asset says more than simply not being in the build.
   */
  const rank: Record<CleanupConfidence, number> = { high: 0, medium: 1, low: 2 }
  const reasonRank: Record<CleanupReason, number> = {
    duplicate: 0,
    'orphan-meta': 1,
    'not-in-build': 2,
    'unused-scene': 3,
    'source-art': 4
  }
  const best = new Map<string, CleanupCandidate>()
  for (const c of candidates) {
    const existing = best.get(c.path)
    if (
      !existing ||
      rank[c.confidence] < rank[existing.confidence] ||
      (rank[c.confidence] === rank[existing.confidence] &&
        reasonRank[c.reason] < reasonRank[existing.reason])
    ) {
      best.set(c.path, c)
    }
  }

  const final = [...best.values()].sort(
    (a, b) => rank[a.confidence] - rank[b.confidence] || b.bytes - a.bytes
  )

  return {
    projectId: project.id,
    scannedAt: Date.now(),
    buildId,
    buildLabel,
    heuristicsOnly,
    caveats,
    candidates: final,
    totalBytes: final.reduce((n, c) => n + c.bytes, 0),
    keep: project.keepAssets ?? []
  }
}

/* --------------------------------------------------------------- quarantine */

const QUARANTINE_FILE = (): string => join(app.getPath('userData'), 'gamebridge-quarantine.json')

/** Sibling of the project so the engine never imports what we moved out. */
function quarantineRoot(project: Project): string {
  return join(dirname(project.path), `${project.name}_GameBridgeRemoved`)
}

let entries: QuarantineEntry[] | null = null

export async function loadQuarantine(): Promise<QuarantineEntry[]> {
  if (entries) return entries
  try {
    const parsed = JSON.parse(await fs.readFile(QUARANTINE_FILE(), 'utf-8')) as QuarantineEntry[]
    entries = Array.isArray(parsed) ? parsed : []
  } catch {
    entries = []
  }
  return entries
}

async function saveQuarantine(next: QuarantineEntry[]): Promise<void> {
  entries = next
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(QUARANTINE_FILE(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    /* the manifest is a convenience — never fail an action over it */
  }
}

/** Move a file and its .meta, creating the destination folder. */
async function moveWithMeta(from: string, to: string): Promise<boolean> {
  await fs.mkdir(dirname(to), { recursive: true })
  await fs.rename(from, to)
  try {
    await fs.rename(from + '.meta', to + '.meta')
    return true
  } catch {
    return false
  }
}

/**
 * Move assets out of the project into a sibling folder. Reversible with
 * restoreQuarantined, and emptied to the Recycle Bin when you're happy.
 */
export async function quarantineAssets(
  project: Project,
  paths: string[]
): Promise<CleanupActionResult> {
  const root = quarantineRoot(project)
  const current = await loadQuarantine()
  const added: QuarantineEntry[] = []
  const failed: { path: string; error: string }[] = []
  let bytes = 0

  for (const p of paths) {
    if (!insideAssets(project.path, p)) {
      failed.push({ path: p, error: 'Outside the project Assets folder.' })
      continue
    }
    const from = join(project.path, p)
    const to = join(root, p)
    try {
      const size = (await fs.stat(from)).size
      const hadMeta = await moveWithMeta(from, to)
      added.push({
        id: randomUUID(),
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        originalPath: p,
        quarantinePath: to,
        bytes: size,
        movedAt: Date.now(),
        hadMeta
      })
      bytes += size
    } catch (err) {
      failed.push({ path: p, error: (err as Error).message })
    }
  }

  await saveQuarantine([...current, ...added])
  return {
    ok: failed.length === 0,
    count: added.length,
    bytes,
    failed,
    message: added.length
      ? `Moved ${added.length} file${added.length === 1 ? '' : 's'} to ${root}.`
      : 'Nothing was moved.'
  }
}

/** Put quarantined files back where they came from. */
export async function restoreQuarantined(ids: string[]): Promise<CleanupActionResult> {
  const current = await loadQuarantine()
  const wanted = new Set(ids)
  const kept: QuarantineEntry[] = []
  const failed: { path: string; error: string }[] = []
  let count = 0
  let bytes = 0

  for (const entry of current) {
    if (!wanted.has(entry.id)) {
      kept.push(entry)
      continue
    }
    try {
      const target = join(entry.projectPath, entry.originalPath)
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.rename(entry.quarantinePath, target)
      if (entry.hadMeta) {
        try {
          await fs.rename(entry.quarantinePath + '.meta', target + '.meta')
        } catch {
          /* the .meta may already be gone */
        }
      }
      count++
      bytes += entry.bytes
    } catch (err) {
      failed.push({ path: entry.originalPath, error: (err as Error).message })
      kept.push(entry)
    }
  }

  await saveQuarantine(kept)
  return {
    ok: failed.length === 0,
    count,
    bytes,
    failed,
    message: count ? `Restored ${count} file${count === 1 ? '' : 's'}.` : 'Nothing was restored.'
  }
}

/** Send quarantined files to the Recycle Bin. */
export async function trashQuarantined(ids: string[]): Promise<CleanupActionResult> {
  const current = await loadQuarantine()
  const wanted = new Set(ids)
  const kept: QuarantineEntry[] = []
  const failed: { path: string; error: string }[] = []
  let count = 0
  let bytes = 0

  for (const entry of current) {
    if (!wanted.has(entry.id)) {
      kept.push(entry)
      continue
    }
    try {
      await shell.trashItem(entry.quarantinePath)
      if (entry.hadMeta) {
        await shell.trashItem(entry.quarantinePath + '.meta').catch(() => undefined)
      }
      count++
      bytes += entry.bytes
    } catch (err) {
      failed.push({ path: entry.originalPath, error: (err as Error).message })
      kept.push(entry)
    }
  }

  await saveQuarantine(kept)
  return {
    ok: failed.length === 0,
    count,
    bytes,
    failed,
    message: count
      ? `Sent ${count} file${count === 1 ? '' : 's'} to the Recycle Bin.`
      : 'Nothing was removed.'
  }
}

/** Send project assets straight to the Recycle Bin, skipping quarantine. */
export async function trashAssets(
  project: Project,
  paths: string[]
): Promise<CleanupActionResult> {
  const failed: { path: string; error: string }[] = []
  let count = 0
  let bytes = 0

  for (const p of paths) {
    if (!insideAssets(project.path, p)) {
      failed.push({ path: p, error: 'Outside the project Assets folder.' })
      continue
    }
    const abs = join(project.path, p)
    try {
      bytes += (await fs.stat(abs)).size
      await shell.trashItem(abs)
      await shell.trashItem(abs + '.meta').catch(() => undefined)
      count++
    } catch (err) {
      failed.push({ path: p, error: (err as Error).message })
    }
  }

  return {
    ok: failed.length === 0,
    count,
    bytes,
    failed,
    message: count
      ? `Sent ${count} file${count === 1 ? '' : 's'} to the Recycle Bin.`
      : 'Nothing was removed.'
  }
}
