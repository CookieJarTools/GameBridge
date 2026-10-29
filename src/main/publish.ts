import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { BuildRecord, PublishStartResult, PublishTarget, Project } from '@shared/types'
import { exists, splitArgs } from './resolve'
import { killTree } from './platform'

/**
 * Sending a finished build somewhere.
 *
 * Two rules shape everything here. Uploading publishes work to the world, so it
 * only ever happens on an explicit request for one named target and one named
 * build — nothing runs automatically after a build. And no credential is ever
 * stored by GameBridge: steamcmd and butler both keep their own cached login,
 * which the user establishes once in a terminal, so all we hold is a username.
 */

type Emit = (channel: string, payload: unknown) => void
let emit: Emit = () => {}
export function setPublishEmitter(fn: Emit): void {
  emit = fn
}

interface ActiveUpload {
  id: string
  child?: ChildProcess
  cancelled?: boolean
}

const running = new Map<string, ActiveUpload>()

export function runningUploads(): string[] {
  return [...running.keys()]
}

function log(id: string, line: string, stream: 'out' | 'err' | 'sys' = 'out'): void {
  emit('publish:log', { uploadId: id, line, stream })
}

/** Tokens a custom command can use. */
function fillTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => tokens[key] ?? '')
}

/**
 * Steam's build script. Generated per upload so there's no .vdf to maintain by
 * hand, and written to temp rather than into the project.
 */
async function writeSteamScript(
  target: PublishTarget,
  contentRoot: string,
  version: string
): Promise<string> {
  const dir = join(app.getPath('temp'), 'gamebridge-steam')
  await fs.mkdir(dir, { recursive: true })
  const outputDir = join(dir, 'output')
  await fs.mkdir(outputDir, { recursive: true })
  const path = join(dir, `app_build_${target.appId}_${Date.now()}.vdf`)

  const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const vdf = `"appbuild"
{
\t"appid" "${escape(target.appId ?? '')}"
\t"desc" "${escape(`${target.description || 'GameBridge upload'} ${version}`.trim())}"
\t"buildoutput" "${escape(outputDir)}"
\t"contentroot" "${escape(contentRoot)}"
\t"setlive" "${escape(target.branch ?? '')}"
\t"preview" "${target.dryRun ? '1' : '0'}"
\t"local" ""
\t"depots"
\t{
\t\t"${escape(target.depotId ?? '')}"
\t\t{
\t\t\t"FileMapping"
\t\t\t{
\t\t\t\t"LocalPath" "*"
\t\t\t\t"DepotPath" "."
\t\t\t\t"recursive" "1"
\t\t\t}
\t\t}
\t}
}
`
  await fs.writeFile(path, vdf, 'utf-8')
  return path
}

/** Turn a target into the command to run. */
async function buildCommand(
  target: PublishTarget,
  contentRoot: string,
  version: string,
  project: Project,
  build: BuildRecord
): Promise<{ exe: string; args: string[]; note?: string } | { error: string }> {
  if (target.kind === 'steam') {
    if (!target.toolPath) return { error: 'No path to steamcmd set for this target.' }
    if (!target.appId || !target.depotId) {
      return { error: 'Steam targets need both an App ID and a Depot ID.' }
    }
    if (!target.username) return { error: 'Steam targets need the username to upload as.' }
    if (!(await exists(target.toolPath))) {
      return { error: `steamcmd not found at ${target.toolPath}` }
    }
    const script = await writeSteamScript(target, contentRoot, version)
    return {
      exe: target.toolPath,
      args: ['+login', target.username, '+run_app_build', script, '+quit'],
      note: target.dryRun
        ? 'Preview mode — Steam will check the build without publishing it.'
        : undefined
    }
  }

  if (target.kind === 'itch') {
    if (!target.toolPath) return { error: 'No path to butler set for this target.' }
    if (!target.itchTarget) {
      return { error: 'itch.io targets need a destination like user/game:windows.' }
    }
    if (!(await exists(target.toolPath))) {
      return { error: `butler not found at ${target.toolPath}` }
    }
    const args = ['push', contentRoot, target.itchTarget, '--userversion', version]
    if (target.dryRun) args.push('--dry-run')
    return { exe: target.toolPath, args }
  }

  if (!target.command?.trim()) return { error: 'This target has no command to run.' }
  const filled = fillTokens(target.command, {
    output: build.outputPath ?? contentRoot,
    outputDir: contentRoot,
    version,
    name: project.name,
    target: build.target ?? '',
    profile: build.profileName ?? ''
  })
  const parts = splitArgs(filled)
  if (!parts.length) return { error: 'This target has no command to run.' }
  return { exe: parts[0], args: parts.slice(1) }
}

/**
 * Launch the tool.
 *
 * Node refuses to spawn .cmd and .bat directly on Windows (a 2024 security
 * fix), which matters because plenty of build tooling ships as a batch wrapper.
 * Those go through cmd.exe instead; everything else is spawned as-is, so no
 * shell gets to reinterpret the arguments.
 */
function spawnTool(exe: string, args: string[]): ChildProcess {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/c', exe, ...args], { windowsHide: true })
  }
  return spawn(exe, args, { windowsHide: true })
}

/** Phrases worth turning into plain advice when they show up in the output. */
const HINTS: { re: RegExp; hint: string }[] = [
  {
    re: /Steam Guard|two-factor|Enter the current code/i,
    hint: 'Steam is asking for a Steam Guard code. Run "steamcmd +login <user>" in a terminal once and complete it there — after that the login is cached and this will work unattended.'
  },
  {
    re: /Invalid Password|Login Failure|FAILED \(Invalid Password\)/i,
    hint: 'Steam rejected the login. GameBridge never stores your password — log in once with "steamcmd +login <user>" in a terminal so steamcmd caches it.'
  },
  {
    re: /butler: login|not logged in|no credentials/i,
    hint: 'butler is not logged in. Run "butler login" in a terminal once; it stores its own API key.'
  },
  {
    re: /ERROR! Failed to init SAM|Failed to load steamclient/i,
    hint: 'steamcmd could not start properly. Running it once on its own usually finishes its first-run setup.'
  },
  {
    // Reached the server, logged in fine, and Steam refused the build itself.
    re: /Failed to initialize build on server.*Access Denied/i,
    hint:
      'Steam accepted the login but refused the build. That is an account or app setting, not something GameBridge can fix. In likely order: (1) the account needs "Edit App Metadata" and "Publish App Changes To Steam" for this app under Steamworks → Users & Permissions, and a partner admin has to approve the change; (2) the Depot ID must belong to this App ID — check Steamworks → SteamPipe → Depots; (3) if you set a branch live, Steam will not let steamcmd set "default" live — leave the branch blank and set it live in Steamworks instead.'
  },
  {
    re: /Failed to initialize build on server(?!.*Access Denied)/i,
    hint: 'Steam refused to start the build. Check the App ID and Depot ID against Steamworks → SteamPipe → Depots.'
  },
  {
    re: /depot \d+ (?:is )?not (?:found|part of|configured)/i,
    hint: 'That depot does not belong to this app. Depot IDs are listed under Steamworks → SteamPipe → Depots.'
  }
]

export async function startUpload(
  project: Project,
  build: BuildRecord,
  target: PublishTarget,
  contentRoot: string,
  version: string
): Promise<PublishStartResult> {
  if ([...running.values()].some((u) => !u.cancelled)) {
    // One at a time: these are network-bound and interleaved output is useless.
    return { ok: false, message: 'An upload is already running.' }
  }
  if (!(await exists(contentRoot))) {
    return { ok: false, message: `Nothing to upload — ${contentRoot} is not there any more.` }
  }

  const command = await buildCommand(target, contentRoot, version, project, build)
  if ('error' in command) return { ok: false, message: command.error }

  const id = randomUUID()
  const active: ActiveUpload = { id }
  running.set(id, active)

  emit('publish:started', {
    uploadId: id,
    projectId: project.id,
    buildId: build.id,
    targetId: target.id,
    targetName: target.name,
    version,
    startedAt: Date.now()
  })

  log(id, `▶ ${command.exe} ${command.args.join(' ')}`, 'sys')
  log(id, `Uploading ${contentRoot} as version ${version}`, 'sys')
  if (command.note) log(id, command.note, 'sys')

  let child: ChildProcess
  try {
    child = spawnTool(command.exe, command.args)
  } catch (err) {
    log(id, `Could not start: ${(err as Error).message}`, 'err')
    running.delete(id)
    emit('publish:done', { uploadId: id, ok: false, message: (err as Error).message })
    return { ok: false, message: `Could not start ${command.exe}: ${(err as Error).message}` }
  }
  active.child = child

  const seen = new Set<string>()
  const onData = (stream: 'out' | 'err') => (buf: Buffer): void => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      log(id, line, stream)
      for (const { re, hint } of HINTS) {
        if (re.test(line) && !seen.has(hint)) {
          seen.add(hint)
          log(id, hint, 'sys')
        }
      }
    }
  }
  child.stdout?.on('data', onData('out'))
  child.stderr?.on('data', onData('err'))
  child.on('error', (e) => log(id, `Process error: ${e.message}`, 'err'))

  child.on('close', (code) => {
    running.delete(id)
    const ok = !active.cancelled && code === 0
    log(
      id,
      active.cancelled ? 'Upload cancelled.' : `${target.name} finished with code ${code}.`,
      ok ? 'sys' : 'err'
    )
    emit('publish:done', {
      uploadId: id,
      ok,
      code,
      message: active.cancelled
        ? 'Upload cancelled.'
        : ok
          ? `Uploaded to ${target.name}.`
          : `${target.name} failed (code ${code}) — see the log.`
    })
  })

  return { ok: true, message: `Uploading to ${target.name}…`, uploadId: id }
}

export function cancelUpload(uploadId: string): void {
  const active = running.get(uploadId)
  if (!active?.child?.pid) return
  active.cancelled = true
  killTree(active.child.pid)
}

export function cancelAllUploads(): void {
  for (const id of running.keys()) cancelUpload(id)
}
