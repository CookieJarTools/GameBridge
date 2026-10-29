import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'
import { join } from 'path'
import type { UnityEditor, UnityRelease } from '@shared/types'
import { exists } from './resolve'
import { findOnPath, IS_WINDOWS, killTree } from './platform'

const execFileAsync = promisify(execFile)

const PF = process.env['ProgramFiles'] || 'C:\\Program Files'
const PFX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

/**
 * Locate the Hub: "Unity Hub.exe" on Windows; on Linux the package install
 * (/opt/unityhub, usually also on PATH as unityhub) or Unity's AppImage.
 */
export async function findUnityHub(explicit?: string): Promise<string | undefined> {
  const candidates = IS_WINDOWS
    ? [explicit, join(PF, 'Unity Hub', 'Unity Hub.exe'), join(PFX86, 'Unity Hub', 'Unity Hub.exe')]
    : [
        explicit,
        await findOnPath(['unityhub']),
        '/opt/unityhub/unityhub',
        join(homedir(), 'Applications', 'Unity Hub.AppImage'),
        join(homedir(), 'Applications', 'UnityHub.AppImage')
      ]
  for (const c of candidates.filter(Boolean) as string[]) if (await exists(c)) return c
  return undefined
}

/** The Hub's headless switch: Unity documents it after a `--` on Windows and bare on Linux. */
function headless(args: string[]): string[] {
  return IS_WINDOWS ? ['--', '--headless', ...args] : ['--headless', ...args]
}

async function hubJson<T>(hub: string, args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(hub, headless(args), {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  })
  // The Hub prints the JSON array; guard against any stray leading text.
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) return [] as unknown as T
  return JSON.parse(stdout.slice(start, end + 1)) as T
}

export async function listInstalledEditors(hub: string): Promise<UnityEditor[]> {
  try {
    return await hubJson<UnityEditor[]>(hub, ['editors', '-i', '-j'])
  } catch {
    return []
  }
}

export async function listReleases(hub: string): Promise<UnityRelease[]> {
  try {
    return await hubJson<UnityRelease[]>(hub, ['editors', '-r', '-j'])
  } catch {
    return []
  }
}

const installing = new Map<string, ChildProcess>()

export function installingVersions(): string[] {
  return [...installing.keys()]
}

/**
 * Install a Unity editor version (with optional build-support modules), streaming
 * progress via onLine. Resolves with the exit code.
 */
export function installEditor(
  hub: string,
  version: string,
  modules: string[],
  onLine: (line: string) => void,
  onDone: (ok: boolean, message: string) => void
): void {
  if (installing.has(version)) {
    onDone(false, 'That version is already installing.')
    return
  }
  const args = headless(['install', '--version', version])
  for (const m of modules) args.push('--module', m)
  if (modules.length) args.push('--childModules')

  onLine(`$ Unity Hub install ${version}${modules.length ? ' +' + modules.join(',') : ''}`)
  const child = spawn(hub, args, { windowsHide: true })
  installing.set(version, child)

  const onData = (buf: Buffer): void => {
    for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) onLine(line.trimEnd())
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (e) => onLine(`Error: ${e.message}`))
  child.on('close', (code) => {
    installing.delete(version)
    onDone(code === 0, code === 0 ? `Installed Unity ${version}` : `Install failed (code ${code})`)
  })
}

export function cancelInstall(version: string): void {
  const child = installing.get(version)
  if (child?.pid) killTree(child.pid)
  else child?.kill()
}
