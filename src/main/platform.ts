import { spawn } from 'child_process'
import { existsSync, promises as fs, readdirSync, readFileSync } from 'fs'
import { delimiter, join } from 'path'

/**
 * The few things that differ between the Windows and Linux builds: executable
 * names, where engines keep their binaries, and how to stop a process tree.
 */
export const IS_WINDOWS = process.platform === 'win32'

/** The editor binary inside a Unity install's Editor folder. */
export const UNITY_EDITOR_BINARY = IS_WINDOWS ? 'Unity.exe' : 'Unity'

/** Unreal keeps one binaries folder per platform, Engine/Binaries/<this>. */
export const UNREAL_BINARIES_DIR = IS_WINDOWS ? 'Win64' : 'Linux'
export const UNREAL_EDITOR_BINARY = IS_WINDOWS ? 'UnrealEditor.exe' : 'UnrealEditor'
export const UNREAL_CMD_BINARY = IS_WINDOWS ? 'UnrealEditor-Cmd.exe' : 'UnrealEditor-Cmd'

/** The first of `names` found on PATH, as an absolute path. */
export async function findOnPath(names: string[]): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      try {
        await fs.access(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        // keep looking
      }
    }
  }
  return undefined
}

/** Every process descended from `pid`, read from /proc. */
function descendants(pid: number): number[] {
  const children = new Map<number, number[]>()
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      // "pid (comm) state ppid ...": comm may hold spaces, so count from its closing paren.
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf-8')
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)])
    } catch {
      // exited while we were looking
    }
  }
  const found: number[] = []
  const queue = [pid]
  while (queue.length) {
    for (const child of children.get(queue.shift() as number) ?? []) {
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/**
 * Kill a process and everything it started. A build run through a shell leaves
 * its compiler going if only the shell dies, so Windows gets taskkill /T and
 * Linux gets the whole tree from /proc, collected before anything is killed.
 */
export function killTree(pid: number): void {
  if (IS_WINDOWS) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  const tree = existsSync('/proc') ? [pid, ...descendants(pid)] : [pid]
  for (const p of tree) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}
