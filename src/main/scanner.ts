import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { Engine, Project } from '@shared/types'
import { newId } from './store'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readDirSafe(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p)
  } catch {
    return []
  }
}

async function unityVersion(dir: string): Promise<string | undefined> {
  try {
    const txt = await fs.readFile(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf-8')
    const m = txt.match(/m_EditorVersion:\s*(.+)/)
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function findUproject(dir: string, entries: string[]): Promise<string | undefined> {
  const file = entries.find((e) => e.toLowerCase().endsWith('.uproject'))
  return file ? join(dir, file) : undefined
}

async function unrealVersion(uproject: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await fs.readFile(uproject, 'utf-8'))
    const assoc = json.EngineAssociation
    return typeof assoc === 'string' && assoc.length ? assoc : undefined
  } catch {
    return undefined
  }
}

/** Inspect a single folder and return a Project if it looks like a game project. */
async function classify(dir: string, customEngines: Engine[]): Promise<Project | null> {
  const entries = await readDirSafe(dir)
  if (entries.length === 0) return null

  // Unreal: any .uproject file.
  const uproject = await findUproject(dir, entries)
  if (uproject) {
    return {
      id: newId(),
      name: basename(uproject, '.uproject'),
      path: dir,
      engineId: 'unreal',
      engineVersion: await unrealVersion(uproject),
      launchFile: uproject,
      tags: []
    }
  }

  // Unity: Assets + ProjectSettings, or a ProjectVersion.txt.
  const hasAssets = entries.includes('Assets')
  const hasProjectSettings = entries.includes('ProjectSettings')
  if (hasAssets && hasProjectSettings) {
    return {
      id: newId(),
      name: basename(dir),
      path: dir,
      engineId: 'unity',
      engineVersion: await unityVersion(dir),
      tags: []
    }
  }

  // Custom engines by declared file extension.
  for (const eng of customEngines) {
    if (eng.kind !== 'custom' || !eng.detectExtension) continue
    const ext = eng.detectExtension.startsWith('.') ? eng.detectExtension : '.' + eng.detectExtension
    const match = entries.find((e) => e.toLowerCase().endsWith(ext.toLowerCase()))
    if (match) {
      return {
        id: newId(),
        name: basename(dir),
        path: dir,
        engineId: eng.id,
        launchFile: join(dir, match),
        tags: []
      }
    }
  }

  return null
}

/**
 * Scan the given roots for projects. Looks at each root's children and
 * grandchildren (depth 2), skipping into a folder no further once it is
 * identified as a project.
 */
export async function scanProjects(
  roots: string[],
  customEngines: Engine[]
): Promise<Project[]> {
  const found: Project[] = []
  const seen = new Set<string>()

  async function visit(dir: string, depth: number): Promise<void> {
    const norm = dir.toLowerCase()
    if (seen.has(norm)) return
    seen.add(norm)

    const project = await classify(dir, customEngines)
    if (project) {
      found.push(project)
      return // don't descend into a known project
    }
    if (depth <= 0) return

    for (const entry of await readDirSafe(dir)) {
      const child = join(dir, entry)
      try {
        const stat = await fs.stat(child)
        if (stat.isDirectory() && !entry.startsWith('.')) {
          await visit(child, depth - 1)
        }
      } catch {
        /* ignore unreadable entries */
      }
    }
  }

  for (const root of roots) {
    if (await exists(root)) await visit(root, 2)
  }
  return found
}
