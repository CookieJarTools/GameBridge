import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { spawn } from 'child_process'
import type { AppData, Engine, EngineConfig, Project } from '@shared/types'
import { UNITY_EDITOR_BINARY } from './platform'

/** Launch a detached process; the child outlives GameBridge. Returns its pid. */
export function detachedSpawn(exe: string, args: string[], cwd?: string): number | undefined {
  const child = spawn(exe, args, {
    detached: true,
    stdio: 'ignore',
    cwd: cwd ?? dirname(exe),
    windowsHide: false
  })
  child.unref()
  return child.pid
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function findSln(projectDir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(projectDir)
    const sln = entries.find((e) => e.toLowerCase().endsWith('.sln'))
    return sln ? join(projectDir, sln) : undefined
  } catch {
    return undefined
  }
}

export async function resolveUnityEditor(
  version: string | undefined,
  config: EngineConfig
): Promise<string | undefined> {
  // Prefer the Unity Hub's installed list (covers custom install directories).
  const editors = config.unityEditors ?? []
  if (editors.length) {
    if (version) {
      const exact = editors.find((e) => e.version === version)
      if (exact && (await exists(exact.location))) return exact.location
      const prefixed = editors.find((e) => e.version.startsWith(version.split('.')[0]))
      if (prefixed && (await exists(prefixed.location))) return prefixed.location
    }
    const newest = [...editors].sort((a, b) => b.version.localeCompare(a.version))[0]
    if (newest && (await exists(newest.location))) return newest.location
  }

  // Fall back to scanning the Unity Hub editors root folder.
  const root = config.unityEditorsRoot
  if (!root) return undefined
  if (version) {
    const exact = join(root, version, 'Editor', UNITY_EDITOR_BINARY)
    if (await exists(exact)) return exact
  }
  try {
    const dirs = (await fs.readdir(root)).sort().reverse()
    if (version) {
      const prefixed = dirs.find((d) => d.startsWith(version.split('.')[0]))
      if (prefixed) {
        const p = join(root, prefixed, 'Editor', UNITY_EDITOR_BINARY)
        if (await exists(p)) return p
      }
    }
    for (const d of dirs) {
      const p = join(root, d, 'Editor', UNITY_EDITOR_BINARY)
      if (await exists(p)) return p
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/** Resolve the executable used to launch/build a project's engine. */
export async function resolveEngineExe(
  engine: Engine,
  project: Project,
  data: AppData
): Promise<string | undefined> {
  if (engine.kind === 'unity') {
    return resolveUnityEditor(project.engineVersion, data.settings.engineConfig)
  }
  if (engine.kind === 'unreal') {
    const match = data.settings.engineConfig.unrealInstalls.find(
      (u) => project.engineVersion && u.version.startsWith(project.engineVersion)
    )
    return match?.editorPath
  }
  return engine.executable
}

/** Split a command-line string into argv, honouring double quotes. */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? '')
  return out
}

export function fillTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? '')
}
