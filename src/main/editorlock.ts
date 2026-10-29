import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { EngineKind, OpenEditorInfo, Project } from '@shared/types'
import { killTree } from './platform'

/**
 * Finding — and politely closing — an editor that already has a project open.
 *
 * Unity refuses to build a project another instance holds, so a build has to
 * either fail or take the editor down first. Closing one can lose unsaved work,
 * so everything here defaults to the gentle path and the caller always asks.
 */

/** Unity writes this while a project is open; it names the process holding it. */
interface EditorInstanceJson {
  process_id?: number
  version?: string
  app_path?: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Editors GameBridge itself launched, so we can spot an open Unreal or custom
 * editor too — those leave no lock file we can rely on.
 */
const ourEditors = new Map<string, { pid: number; kind: EngineKind }>()

export function rememberLaunchedEditor(projectId: string, pid: number, kind: EngineKind): void {
  ourEditors.set(projectId, { pid, kind })
}

export function forgetLaunchedEditor(projectId: string): void {
  ourEditors.delete(projectId)
}

/** Is an editor holding this project right now? */
export async function detectOpenEditor(
  project: Project,
  kind: EngineKind | undefined
): Promise<OpenEditorInfo | undefined> {
  if (kind === 'unity') {
    try {
      const raw = await fs.readFile(join(project.path, 'Library', 'EditorInstance.json'), 'utf-8')
      const parsed = JSON.parse(raw) as EditorInstanceJson
      const pid = Number(parsed.process_id)
      if (pid > 0 && alive(pid)) {
        return {
          projectId: project.id,
          projectName: project.name,
          pid,
          version: parsed.version,
          // The lock file is what Unity actually checks, so report it too.
          locked: await fileExists(join(project.path, 'Temp', 'UnityLockfile'))
        }
      }
    } catch {
      /* no instance file — fall through to what we launched ourselves */
    }
  }

  const ours = ourEditors.get(project.id)
  if (ours && alive(ours.pid)) {
    return { projectId: project.id, projectName: project.name, pid: ours.pid, locked: true }
  }
  if (ours) ourEditors.delete(project.id)
  return undefined
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Ask the editor to close the way clicking its X does, so it can prompt about
 * unsaved work.
 *
 * `CloseMainWindow()` posts WM_CLOSE to the editor's main window. Plain
 * `taskkill` without /F does NOT reliably reach Unity — measured against a real
 * editor it sat there for a minute, where CloseMainWindow closed it in one
 * second — so that is only the fallback for a process with no main window.
 */
export function requestClose(pid: number): void {
  if (process.platform === 'win32') {
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue;` +
          ` if ($p -and -not $p.CloseMainWindow()) { taskkill /pid ${pid} }`
      ],
      { windowsHide: true }
    )
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

/** Kill it outright. Unsaved work is lost — only ever on an explicit request. */
export function forceClose(pid: number): void {
  killTree(pid)
}

/** Resolves true if the process went away within `timeoutMs`. */
export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return !alive(pid)
}

/**
 * Unity can leave its lock file behind if it was killed. Clearing it stops the
 * next build failing on a lock nothing owns.
 */
export async function clearStaleLock(project: Project, kind: EngineKind | undefined): Promise<void> {
  if (kind !== 'unity') return
  try {
    await fs.rm(join(project.path, 'Temp', 'UnityLockfile'), { force: true })
  } catch {
    /* the editor may still hold it — leave it alone */
  }
}
