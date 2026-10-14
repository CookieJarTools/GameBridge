import { promises as fs, type Dirent } from 'fs'
import { basename, join, relative, sep } from 'path'
import type { UnityBuildProfile } from '@shared/types'

/**
 * Finding Unity 6 Build Profiles in a project.
 *
 * A profile is a ScriptableObject in a .asset file, so there is no API to ask
 * from outside the editor. We look for the fields only a BuildProfile has,
 * reading just the head of each candidate file. Detection only drives the
 * picker — the build itself loads the asset through the AssetDatabase, so a
 * false positive fails loudly rather than building the wrong thing.
 */

/** Only these fields together mean "this is a build profile". */
const MARKER = /m_PlatformBuildProfile|Build\.Profile\.BuildProfile/
const NAME = /^\s*m_Name:\s*(.+?)\s*$/m
const TARGET = /^\s*m_BuildTarget:\s*(-?\d+)\s*$/m

/**
 * Enough of Unity's BuildTarget enum to label the common profiles and pick the
 * right output extension. Anything unmapped just shows without a platform.
 */
const TARGETS: Record<number, { label: string; id?: string }> = {
  2: { label: 'macOS', id: 'StandaloneOSX' },
  5: { label: 'Windows', id: 'StandaloneWindows64' },
  9: { label: 'iOS', id: 'iOS' },
  13: { label: 'Android', id: 'Android' },
  19: { label: 'Windows (x64)', id: 'StandaloneWindows64' },
  20: { label: 'WebGL', id: 'WebGL' },
  24: { label: 'Linux (x64)', id: 'StandaloneLinux64' },
  31: { label: 'PS4' },
  37: { label: 'Switch' },
  38: { label: 'PS5' },
  43: { label: 'Xbox Series' }
}

const HEAD_BYTES = 4096
const MAX_CANDIDATES = 5000

const SKIP_DIRS = new Set(['library', 'temp', 'obj', 'build', 'builds', 'logs', '.git', 'node_modules'])

/** Collect .asset paths under Assets, cheaply and with a cap. */
async function assetFiles(dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_CANDIDATES) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_CANDIDATES) return
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      await assetFiles(full, out)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.asset')) {
      out.push(full)
    }
  }
}

/** Read the first few KB — the fields we need are in the header. */
async function head(path: string): Promise<string> {
  let handle
  try {
    handle = await fs.open(path, 'r')
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } catch {
    return ''
  } finally {
    await handle?.close()
  }
}

/** Every build profile in the project, newest Unity only (6000+ has the feature). */
export async function findBuildProfiles(projectPath: string): Promise<UnityBuildProfile[]> {
  const candidates: string[] = []
  await assetFiles(join(projectPath, 'Assets'), candidates)

  const profiles: UnityBuildProfile[] = []
  for (const path of candidates) {
    const text = await head(path)
    if (!MARKER.test(text)) continue
    const name = NAME.exec(text)?.[1]
    const target = TARGET.exec(text)?.[1]
    const known = target ? TARGETS[Number(target)] : undefined
    profiles.push({
      // Unity wants an AssetDatabase path: project-relative, forward slashes.
      path: relative(projectPath, path).split(sep).join('/'),
      name: name && name !== '' ? name : basename(path, '.asset'),
      platform: known?.label,
      targetId: known?.id
    })
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name))
}
