import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { delimiter, dirname, sep } from 'path'
import type {
  AppData,
  BuildPhaseId,
  BuildTargetDef,
  BuildPrecheck,
  BuildRecord,
  BuildRequest,
  EngineKind,
  Project
} from '@shared/types'
import { DEFAULT_BUILD_TEMPLATES, findEngine } from '@shared/engines'
import {
  buildFolderName,
  defaultBuildTarget,
  defaultOutputPath,
  findBuildTarget,
  parseBuildFolder,
  safeFileName
} from '@shared/buildtargets'
import { nextVersion, readProjectVersion, writeProjectVersion } from './version'
import { promises as fsp } from 'fs'
import { detachedSpawn, exists, fillTokens, resolveEngineExe } from './resolve'
import { startRun } from './run'
import { killTree } from './platform'
import { reportPathFor, saveRecord } from './buildhistory'
import {
  clearStaleLock,
  detectOpenEditor,
  forceClose,
  requestClose,
  waitForExit
} from './editorlock'
import {
  cleanupBuildScript,
  cleanupBuildScriptSync,
  createPhaseTracker,
  injectBuildScript,
  INJECT_METHOD,
  readBuildReport,
  type Injection,
  type PhaseSnapshot
} from './unitybuild'

/** Optional executable to start once the build succeeds (build-then-run). */
export interface RunAfter {
  exe: string
  args: string[]
  cwd?: string
  /** Capture the launched game's output into the Console instead of detaching. */
  capture?: boolean
}

export interface StartBuildOptions {
  runAfter?: RunAfter
  /** Target/output selection from the Builds view. Absent = plain template build. */
  request?: BuildRequest
}

type Emit = (channel: string, payload: unknown) => void
let emit: Emit = () => {}
export function setBuildEmitter(fn: Emit): void {
  emit = fn
}

/**
 * Reopening an editor needs the full launch logic, which lives in launch.ts and
 * already imports this module — so index.ts hands it to us instead.
 */
type Reopener = (projectId: string) => Promise<void>
let reopenEditor: Reopener = async () => {}
export function setEditorReopener(fn: Reopener): void {
  reopenEditor = fn
}

/** How long we wait for an editor to close on its own before asking again. */
const GRACEFUL_CLOSE_MS = 30_000

interface ActiveBuild {
  record: BuildRecord
  child?: ChildProcess
  injection?: Injection
  reportPath?: string
  cancelled?: boolean
  /** Set while we're waiting for the user to decide about a stubborn editor. */
  forceDecision?: (choice: 'force' | 'cancel') => void
  /** Editor we took down for this build, to be reopened when it ends. */
  closedEditorPid?: number
  reopen?: boolean
}

const running = new Map<string, ActiveBuild>()

export function runningBuilds(): string[] {
  return [...running.keys()]
}

/** Records for builds currently in flight, so the UI can resync after a reload. */
export function runningBuildRecords(): BuildRecord[] {
  return [...running.values()].map((b) => b.record)
}

/** Best-effort progress parsing from a build log line. */
function parsePercent(line: string): number | undefined {
  const pct = line.match(/(\d{1,3})(?:\.\d+)?\s*%/)
  if (pct) return Math.min(100, Math.max(0, parseInt(pct[1], 10)))
  const ratio = line.match(/[[(\s](\d+)\s*\/\s*(\d+)[\])\s]/)
  if (ratio) {
    const [, a, b] = ratio
    const total = parseInt(b, 10)
    if (total > 0) return Math.min(100, Math.round((parseInt(a, 10) / total) * 100))
  }
  return undefined
}

/** Prepend an engine's toolchain bin dir(s) to PATH so g++/make/premake resolve. */
function buildEnv(engineId: string, data: AppData): NodeJS.ProcessEnv {
  const bin = data.settings.toolchainBinByEngine[engineId]?.trim()
  if (!bin) return process.env
  return { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? '') }
}

function log(record: BuildRecord, line: string, stream: 'out' | 'err' | 'sys' = 'out', percent?: number): void {
  emit('build:log', { projectId: record.projectId, buildId: record.id, line, stream, percent })
}

function progress(record: BuildRecord, snapshot: Partial<PhaseSnapshot> & { phase: BuildPhaseId }): void {
  record.phase = snapshot.phase
  emit('build:progress', {
    buildId: record.id,
    projectId: record.projectId,
    phase: snapshot.phase,
    activity: snapshot.activity,
    percent: snapshot.percent,
    imported: snapshot.imported,
    errors: snapshot.errors,
    warnings: snapshot.warnings
  })
}

async function finish(
  active: ActiveBuild,
  code: number | null,
  message?: string
): Promise<void> {
  const { record } = active
  running.delete(record.projectId)
  await cleanupBuildScript(active.injection)

  if (active.reportPath) record.report = await readBuildReport(active.reportPath)

  const ok = !active.cancelled && code === 0
  record.endedAt = Date.now()
  record.exitCode = code
  record.phase = active.cancelled ? 'cancelled' : ok ? 'succeeded' : 'failed'
  record.message = message ?? record.report?.messages?.[0]?.content

  // Put the editor back the way we found it, whatever the build did.
  if (active.closedEditorPid && active.reopen !== false) {
    log(record, 'Reopening the editor…', 'sys')
    try {
      await reopenEditor(record.projectId)
    } catch (err) {
      log(record, `Could not reopen the editor: ${(err as Error).message}`, 'err')
    }
  }

  await saveRecord(record)
  emit('build:done', {
    projectId: record.projectId,
    buildId: record.id,
    code,
    ok,
    message,
    record
  })
}

/* --------------------------------------------------- output + versioning */

/**
 * Where this build goes: its own numbered folder under the target (or profile)
 * so nothing is ever overwritten. The counter continues from whatever is
 * already there, which survives folders being deleted by hand.
 */
async function nextOutputPath(
  project: Project,
  target: BuildTargetDef,
  folderLabel: string,
  version: string | undefined
): Promise<string> {
  const parent = [project.path, 'Builds', safeFileName(folderLabel)].join(sep)

  let highest = 0
  try {
    for (const entry of await fsp.readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const n = parseBuildFolder(entry.name)
      if (n !== undefined && n > highest) highest = n
    }
  } catch {
    /* first build for this target */
  }

  const folder = [parent, buildFolderName(highest + 1, version)].join(sep)
  return target.ext ? `${folder}${sep}${safeFileName(project.name)}${target.ext}` : folder
}

/**
 * Drop the oldest build folders once there are more than the project wants.
 * Opt-in — `keepBuilds` is unset by default, because these are the user's
 * artifacts and quietly deleting them would be rude.
 */
async function pruneBuilds(project: Project, folderLabel: string): Promise<string[]> {
  const keep = project.keepBuilds ?? 0
  if (keep <= 0) return []
  const parent = [project.path, 'Builds', safeFileName(folderLabel)].join(sep)

  try {
    const folders = (await fsp.readdir(parent, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && parseBuildFolder(e.name) !== undefined)
      .map((e) => ({ name: e.name, n: parseBuildFolder(e.name) as number }))
      .sort((a, b) => b.n - a.n)

    const removed: string[] = []
    for (const old of folders.slice(keep)) {
      await fsp.rm([parent, old.name].join(sep), { recursive: true, force: true })
      removed.push(old.name)
    }
    return removed
  } catch {
    return []
  }
}

/** The version this build will carry, applying the project's bump first. */
async function resolveVersion(
  project: Project,
  kind: EngineKind | undefined,
  record: BuildRecord
): Promise<{ version?: string; note?: string }> {
  const current = await readProjectVersion(project.path, kind)
  if (!current) return {}

  const bump = project.versionBump ?? 'none'
  if (bump === 'none') {
    record.version = current.version
    return { version: current.version }
  }

  const next = nextVersion(current.version, bump)
  const written = await writeProjectVersion(project.path, next)
  if (!written.ok) {
    record.version = current.version
    return { version: current.version, note: written.message }
  }
  record.version = next
  return {
    version: next,
    note: `Version ${current.version} → ${next}${
      written.androidVersionCode ? ` (Android code ${written.androidVersionCode})` : ''
    }`
  }
}

/* ------------------------------------------------------- the open editor */

/**
 * Can this project be built right now? Called before a build so the UI can ask
 * about an open editor rather than failing halfway in.
 */
export async function precheckBuild(project: Project, data: AppData): Promise<BuildPrecheck> {
  const engine = findEngine(data.settings.engines, project.engineId)
  if (!engine) return { ok: false, message: 'This project has no engine assigned.' }
  if (running.has(project.id)) return { ok: false, message: 'A build is already running.' }

  const editor = await detectOpenEditor(project, engine.kind)
  return editor ? { ok: true, editor } : { ok: true }
}

/**
 * Close an editor holding the project, gently first. Returns 'ok' when the way
 * is clear, 'cancelled' when the user backed out (or never agreed).
 */
async function ensureEditorClosed(
  active: ActiveBuild,
  project: Project,
  kind: EngineKind | undefined,
  request: BuildRequest
): Promise<'ok' | 'cancelled'> {
  const { record } = active
  const editor = await detectOpenEditor(project, kind)
  if (!editor) return 'ok'

  if (!request.closeEditor) {
    log(
      record,
      `${project.name} is open in an editor (pid ${editor.pid}) and can't be built while it is.`,
      'err'
    )
    await finish(active, 1, `${project.name} is open in an editor. Close it and build again.`)
    return 'cancelled'
  }

  progress(record, {
    phase: 'closing-editor',
    activity: `Closing the editor (pid ${editor.pid})…`,
    percent: 1
  })
  log(record, `Asking the editor to close (pid ${editor.pid}). Unsaved work may prompt.`, 'sys')
  requestClose(editor.pid)

  if (await waitForExit(editor.pid, GRACEFUL_CLOSE_MS)) {
    log(record, 'Editor closed.', 'sys')
    active.closedEditorPid = editor.pid
    await clearStaleLock(project, kind)
    return 'ok'
  }

  // Still there — either a save prompt or a long import. The user decides.
  log(
    record,
    `The editor is still running after ${GRACEFUL_CLOSE_MS / 1000}s — it may be asking you to save, or busy importing.`,
    'err'
  )
  progress(record, {
    phase: 'closing-editor',
    activity: 'Waiting — the editor has not closed yet',
    percent: 1
  })
  emit('build:needs-force', {
    buildId: record.id,
    projectId: project.id,
    projectName: project.name,
    pid: editor.pid,
    waited: GRACEFUL_CLOSE_MS / 1000
  })

  const choice = await new Promise<'force' | 'cancel'>((resolve) => {
    active.forceDecision = resolve
  })
  active.forceDecision = undefined

  if (choice === 'cancel') {
    log(record, 'Build cancelled — the editor was left alone.', 'err')
    active.cancelled = true
    await finish(active, null, 'Build cancelled; the editor was left open.')
    return 'cancelled'
  }

  log(record, 'Force-closing the editor. Unsaved changes are lost.', 'err')
  forceClose(editor.pid)
  if (!(await waitForExit(editor.pid, 10_000))) {
    await finish(active, 1, `Could not close the editor (pid ${editor.pid}).`)
    return 'cancelled'
  }
  log(record, 'Editor closed.', 'sys')
  active.closedEditorPid = editor.pid
  await clearStaleLock(project, kind)
  return 'ok'
}

/** Answer the "it won't close" prompt. */
export function resolveForceClose(projectId: string, choice: 'force' | 'cancel'): void {
  running.get(projectId)?.forceDecision?.(choice)
}

/* ------------------------------------------------------- headless Unity */

/**
 * Should we drive Unity ourselves? Only when the user hasn't supplied their own
 * build method — a configured template always wins.
 */
function hasCustomUnityTemplate(project: Project, data: AppData): boolean {
  return !!(project.buildTemplateOverride?.trim() || data.settings.buildByEngine['unity']?.trim())
}

async function startUnityBuild(
  project: Project,
  data: AppData,
  request: BuildRequest,
  record: BuildRecord
): Promise<{ ok: boolean; message: string }> {
  const engine = findEngine(data.settings.engines, project.engineId)!
  const editor = await resolveEngineExe(engine, project, data)
  if (!editor) {
    return {
      ok: false,
      message: 'No Unity editor found for this project. Set the Unity editors root in Settings.'
    }
  }

  const target = findBuildTarget(request.target) ?? defaultBuildTarget(process.platform)
  const reportPath = reportPathFor(record.id)

  // A profile brings its own target, scenes and player settings.
  const profile = request.profilePath?.trim()
  record.target = profile ? undefined : target.id
  record.profileName = profile ? profile.split('/').pop()?.replace(/\.asset$/i, '') : undefined
  record.development = !!request.development

  // Bump the version before working out where the build goes, so the folder
  // can be named after the version this build actually carries.
  const versioned = await resolveVersion(project, engine.kind, record)
  const folderLabel = record.profileName ?? target.id
  const output =
    request.outputPath?.trim() || (await nextOutputPath(project, target, folderLabel, versioned.version))
  record.outputPath = output

  const active: ActiveBuild = { record, reportPath, reopen: request.reopenEditor !== false }
  running.set(project.id, active)

  log(
    record,
    profile ? `Profile ${record.profileName} → ${output}` : `Target ${target.label} → ${output}`,
    'sys',
    0
  )
  if (versioned.note) log(record, versioned.note, 'sys')
  progress(record, { phase: 'starting', activity: 'Preparing…', percent: 0 })

  // Closing an editor can take a while, so the rest runs in the background and
  // reports through the same events as the build itself.
  void runUnityBuild(active, project, data, request, record, editor, target.id, target.cli, target.label, output, reportPath)

  return {
    ok: true,
    message: `Building ${project.name} ${profile ? `with profile ${record.profileName}` : `for ${target.label}`}…`
  }
}

async function runUnityBuild(
  active: ActiveBuild,
  project: Project,
  data: AppData,
  request: BuildRequest,
  record: BuildRecord,
  editor: string,
  targetId: string,
  targetCli: string,
  targetLabel: string,
  output: string,
  reportPath: string
): Promise<void> {
  const engine = findEngine(data.settings.engines, project.engineId)
  if ((await ensureEditorClosed(active, project, engine?.kind, request)) === 'cancelled') return
  if (active.cancelled) {
    await finish(active, null, 'Build cancelled.')
    return
  }
  record.closedEditor = !!active.closedEditorPid

  const profilePath = request.profilePath?.trim()
  const args = [
    '-batchmode',
    '-projectPath',
    project.path,
    '-executeMethod',
    INJECT_METHOD,
    '-logFile',
    '-',
    '-gbTarget',
    targetId,
    '-gbOutput',
    output,
    '-gbReport',
    reportPath
  ]
  // With a profile, the profile picks the platform — don't fight it on the CLI.
  if (!profilePath) args.push('-buildTarget', targetCli)
  else args.push('-gbProfile', profilePath)
  if (request.development) args.push('-gbDevelopment')
  if (project.buildArgs?.trim()) args.push(...project.buildArgs.trim().split(/\s+/))

  try {
    active.injection = await injectBuildScript(project.path)
  } catch (err) {
    log(record, `Could not write the temporary build script: ${(err as Error).message}`, 'err')
    await finish(active, 1, `Could not write the temporary build script into the project.`)
    return
  }

  log(record, `▶ ${editor} ${args.join(' ')}`, 'sys', 0)
  progress(record, { phase: 'starting', activity: 'Starting Unity…', percent: 2 })

  let child: ChildProcess
  try {
    child = spawn(editor, args, { cwd: project.path, windowsHide: true })
  } catch (err) {
    log(record, `Failed to start Unity: ${(err as Error).message}`, 'err')
    await finish(active, 1, (err as Error).message)
    return
  }
  active.child = child

  const tracker = createPhaseTracker()
  let blocked = false

  const onData = (stream: 'out' | 'err') => (buf: Buffer): void => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      log(record, line, stream)
      if (/Multiple Unity instances cannot open the same project/i.test(line)) blocked = true
      const snapshot = tracker(line)
      if (snapshot) progress(record, snapshot)
    }
  }
  child.stdout?.on('data', onData('out'))
  child.stderr?.on('data', onData('err'))
  child.on('error', (e) => log(record, `Process error: ${e.message}`, 'err'))

  child.on('close', async (code) => {
    if (code === 0) {
      const pruned = await pruneBuilds(project, record.profileName ?? targetId)
      if (pruned.length) {
        log(record, `Removed ${pruned.length} older build folder(s): ${pruned.join(', ')}`, 'sys')
      }
    }
    const artifactMissing = code === 0 && !(await exists(output))
    const message = active.cancelled
      ? 'Build cancelled.'
      : blocked
        ? 'Unity already has this project open. Close the editor and try again.'
        : artifactMissing
          ? `Unity reported success but nothing was written to ${output}.`
          : undefined
    log(
      record,
      active.cancelled ? 'Build cancelled.' : `Unity exited with code ${code}.`,
      active.cancelled ? 'err' : 'sys'
    )
    await finish(active, artifactMissing ? 1 : code, message)
  })
}

/* ------------------------------------------------------- template builds */

/** Run one shell command, streaming output to the build log. Resolves with the exit code. */
function spawnPhase(
  active: ActiveBuild,
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(cmd, { cwd, shell: true, windowsHide: true, env })
    } catch (err) {
      log(active.record, `Failed to start: ${(err as Error).message}`, 'err')
      resolve(1)
      return
    }
    active.child = child
    const onData = (stream: 'out' | 'err') => (buf: Buffer): void => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) log(active.record, line, stream, parsePercent(line))
      }
    }
    child.stdout?.on('data', onData('out'))
    child.stderr?.on('data', onData('err'))
    child.on('error', (e) => log(active.record, `Error: ${e.message}`, 'err'))
    child.on('close', (code) => resolve(code))
  })
}

async function runSequence(
  active: ActiveBuild,
  project: Project,
  kind: EngineKind,
  request: BuildRequest,
  genCmd: string,
  buildCmd: string,
  env: NodeJS.ProcessEnv,
  runAfter?: RunAfter
): Promise<void> {
  const { record } = active

  // A Unity project with its own build template still can't build while open.
  if (kind === 'unity') {
    if ((await ensureEditorClosed(active, project, kind, request)) === 'cancelled') return
    record.closedEditor = !!active.closedEditorPid
  }

  // 1. Optional generate (premake) phase — abort the build if it fails.
  if (genCmd) {
    progress(record, { phase: 'compiling', activity: 'Generating project files', percent: 5 })
    log(record, `$ ${genCmd}`, 'sys', 0)
    const code = await spawnPhase(active, genCmd, project.path, env)
    if (code !== 0) {
      await finish(
        active,
        code,
        `${project.name}: generate step failed (code ${code}). Is premake installed / on PATH?`
      )
      return
    }
  }

  // 2. Build phase.
  progress(record, { phase: 'building', activity: 'Building', percent: genCmd ? 15 : 5 })
  log(record, `$ ${buildCmd}`, 'sys', genCmd ? undefined : 0)
  const code = await spawnPhase(active, buildCmd, project.path, env)

  // 3. Optional launch-on-success.
  if (code === 0 && runAfter) {
    if (await exists(runAfter.exe)) {
      log(record, `→ Launching ${runAfter.exe}`, 'sys', 100)
      if (runAfter.capture) {
        startRun(project.id, runAfter.exe, runAfter.args, runAfter.cwd ?? project.path)
      } else {
        detachedSpawn(runAfter.exe, runAfter.args, runAfter.cwd)
      }
    } else {
      log(record, `Build reported success but produced no executable at ${runAfter.exe}`, 'err')
      await finish(
        active,
        code,
        `${project.name}: build reported success but produced no executable. Check the build log.`
      )
      return
    }
  }
  await finish(active, code)
}

/* ------------------------------------------------------------- entrypoint */

export interface StartResult {
  ok: boolean
  message: string
  buildId?: string
}

export async function startBuild(
  project: Project,
  data: AppData,
  options: StartBuildOptions = {}
): Promise<StartResult> {
  if (running.has(project.id)) return { ok: false, message: 'A build is already running.' }

  const engine = findEngine(data.settings.engines, project.engineId)
  if (!engine) return { ok: false, message: 'This project has no engine assigned.' }

  const record: BuildRecord = {
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    engineId: engine.id,
    startedAt: Date.now(),
    phase: 'starting',
    development: options.request?.development
  }

  // Unity with no build method of its own: drive it ourselves.
  if (engine.kind === 'unity' && !hasCustomUnityTemplate(project, data)) {
    const result = await startUnityBuild(project, data, options.request ?? { projectId: project.id }, record)
    return result.ok ? { ...result, buildId: record.id } : result
  }

  const buildTemplate =
    project.buildTemplateOverride?.trim() ||
    data.settings.buildByEngine[engine.id]?.trim() ||
    DEFAULT_BUILD_TEMPLATES[engine.kind]

  const exe = await resolveEngineExe(engine, project, data)
  if (!exe && buildTemplate.includes('{exe}')) {
    return { ok: false, message: 'Could not resolve the engine executable for this build.' }
  }

  const target = findBuildTarget(options.request?.target)
  const output =
    options.request?.outputPath?.trim() ||
    (target ? defaultOutputPath(project.path, project.name, target, sep) : '')
  record.target = target?.id
  record.outputPath = output || undefined

  const tokens = {
    exe: exe ?? '',
    path: project.path,
    file: project.launchFile ?? project.path,
    name: project.name,
    args: project.buildArgs ?? '',
    target: target?.id ?? '',
    output
  }
  const buildCmd = fillTokens(buildTemplate, tokens).trim()
  const env = buildEnv(engine.id, data)

  const genTemplate = data.settings.generateBeforeBuild[engine.id]
    ? data.settings.generateByEngine[engine.id]?.trim()
    : ''
  const genCmd = genTemplate ? fillTokens(genTemplate, tokens).trim() : ''

  const active: ActiveBuild = {
    record,
    reopen: options.request?.reopenEditor !== false
  }
  running.set(project.id, active)
  void runSequence(
    active,
    project,
    engine.kind,
    options.request ?? { projectId: project.id },
    genCmd,
    buildCmd,
    env,
    options.runAfter
  )

  return {
    ok: true,
    message: genCmd ? `Generating + building ${engine.name}…` : `Building ${engine.name}…`,
    buildId: record.id
  }
}

export function stopBuild(projectId: string): void {
  const active = running.get(projectId)
  if (!active) return
  active.cancelled = true
  // If we're mid-prompt about a stubborn editor, Stop means "leave it alone".
  if (active.forceDecision) {
    active.forceDecision('cancel')
    return
  }
  const child = active.child
  if (!child) return
  // Kill the whole process tree (shell + build tool children).
  if (child.pid) killTree(child.pid)
  else child.kill()
}

/** Kill everything on app shutdown, and take our injected scripts with us. */
export function stopAllBuilds(): void {
  for (const [id, active] of running) {
    stopBuild(id)
    cleanupBuildScriptSync(active.injection)
  }
}

/** Where a finished build put its artifact, for "open output folder". */
export function outputFolderOf(record: BuildRecord): string | undefined {
  // Template builds don't set an output path; Unity's report still knows one.
  const path = record.outputPath || record.report?.outputPath
  if (!path) return undefined
  const target = findBuildTarget(record.target)
  return target && target.ext === '' ? path : dirname(path)
}
