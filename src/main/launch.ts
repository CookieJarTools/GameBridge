import { shell } from 'electron'
import type { AppData, IDE, LaunchMode, LaunchResult, Project } from '@shared/types'
import { findEngine } from '@shared/engines'
import {
  detachedSpawn,
  exists,
  fillTokens,
  findSln,
  resolveUnityEditor,
  splitArgs
} from './resolve'
import { dirname } from 'path'
import { startBuild } from './build'
import { startRun, startRunTailing, newRunLogPath } from './run'
import { rememberLaunchedEditor } from './editorlock'

async function launchEngine(
  project: Project,
  data: AppData,
  extraArgs?: string
): Promise<LaunchResult> {
  const { settings } = data
  const engine = findEngine(settings.engines, project.engineId)
  if (!engine) {
    return {
      ok: false,
      message: 'This project has no engine assigned. Set one via the edit (pencil) button.'
    }
  }

  const capture = !!settings.captureLogsByEngine[engine.id]

  if (engine.kind === 'unity') {
    const editor = await resolveUnityEditor(project.engineVersion, settings.engineConfig)
    if (!editor) {
      return {
        ok: false,
        message:
          'No Unity editor found. Set the Unity editors root in Settings (Unity Hub → Installs location).'
      }
    }
    if (capture) {
      // -logFile redirects Unity's editor log; we tail that file into the Console.
      const logPath = newRunLogPath(project.id)
      startRunTailing(
        project.id,
        editor,
        ['-projectPath', project.path, '-logFile', logPath],
        project.path,
        logPath,
        'unity'
      )
      return { ok: true, message: `Launching Unity — watching log` }
    }
    const pid = detachedSpawn(editor, ['-projectPath', project.path])
    if (pid) rememberLaunchedEditor(project.id, pid, 'unity')
    return { ok: true, message: `Launching Unity ${project.engineVersion ?? ''}`.trim() }
  }

  if (engine.kind === 'unreal') {
    const uproject = project.launchFile
    if (!uproject || !(await exists(uproject))) {
      return { ok: false, message: 'Could not find the .uproject file for this project.' }
    }
    const match = settings.engineConfig.unrealInstalls.find(
      (u) => project.engineVersion && u.version.startsWith(project.engineVersion)
    )
    if (match && (await exists(match.editorPath))) {
      if (capture) {
        // -abslog gives Unreal an absolute log path we then tail.
        const logPath = newRunLogPath(project.id)
        startRunTailing(
          project.id,
          match.editorPath,
          [uproject, `-abslog=${logPath}`],
          dirname(uproject),
          logPath,
          'unreal'
        )
        return { ok: true, message: `Launching Unreal ${match.version} — watching log` }
      }
      const pid = detachedSpawn(match.editorPath, [uproject])
      if (pid) rememberLaunchedEditor(project.id, pid, 'unreal')
      return { ok: true, message: `Launching Unreal ${match.version}` }
    }
    // Fall back to the OS file association (Unreal version selector) — can't capture here.
    const err = await shell.openPath(uproject)
    if (err) return { ok: false, message: err }
    return {
      ok: true,
      message: capture
        ? 'Opened via Unreal version selector — enable a detected Unreal install in Settings to capture logs'
        : 'Opening project via Unreal version selector'
    }
  }

  // Custom engine. The executable itself may use tokens, e.g. "{path}\Bin\Release\Game.exe".
  if (!engine.executable) {
    return { ok: false, message: `Set an executable for "${engine.name}" in Settings → Engines.` }
  }
  const tokens = {
    exe: engine.executable,
    path: project.path,
    file: project.launchFile ?? project.path,
    name: project.name,
    args: extraArgs ?? ''
  }
  const exePath = fillTokens(engine.executable, tokens)
  const args = splitArgs(fillTokens(engine.argsTemplate ?? '', { ...tokens, exe: exePath }))

  // Build first, then launch the executable if the build succeeds.
  if (engine.buildBeforeRun) {
    const res = await startBuild(project, data, {
      runAfter: { exe: exePath, args, cwd: project.path, capture }
    })
    return res.ok
      ? { ok: true, message: `Building ${engine.name} — will launch when it succeeds…` }
      : res
  }

  if (!(await exists(exePath))) {
    return { ok: false, message: `Engine executable not found: ${exePath}` }
  }
  if (capture) {
    startRun(project.id, exePath, args, project.path)
    return { ok: true, message: `Launching ${engine.name} — watching output` }
  }
  detachedSpawn(exePath, args, project.path)
  return { ok: true, message: `Launching ${engine.name}` }
}

function resolveIde(project: Project, data: AppData): IDE | undefined {
  const { settings } = data
  const assigned = settings.ideByEngine[project.engineId]
  const id = assigned ?? settings.defaultIdeId
  return settings.ides.find((i) => i.id === id)
}

async function launchIde(project: Project, data: AppData): Promise<string | null> {
  const ide = resolveIde(project, data)
  if (!ide) return 'No IDE assigned for this engine (and no default IDE set).'
  if (!(await exists(ide.executable))) return `IDE executable not found: ${ide.executable}`

  const sln = (await findSln(project.path)) ?? project.path
  const filled = fillTokens(ide.argsTemplate, {
    path: project.path,
    sln,
    file: project.launchFile ?? project.path
  })
  detachedSpawn(ide.executable, splitArgs(filled), project.path)
  return null
}

export async function launchProject(
  project: Project,
  data: AppData,
  mode: LaunchMode,
  extraArgs?: string
): Promise<LaunchResult> {
  // IDE only — never touches the engine or the build.
  if (mode === 'ide') {
    const ideError = await launchIde(project, data)
    if (ideError) return { ok: false, message: ideError }
    const ide = resolveIde(project, data)
    return { ok: true, message: `Opening ${ide?.name ?? 'IDE'}` }
  }

  const engineResult = await launchEngine(project, data, extraArgs)
  if (!engineResult.ok) return engineResult

  if (mode === 'project+ide') {
    const ideError = await launchIde(project, data)
    if (ideError) {
      return { ok: true, message: `${engineResult.message} — but IDE failed: ${ideError}` }
    }
    return { ok: true, message: `${engineResult.message} + IDE` }
  }
  return engineResult
}
