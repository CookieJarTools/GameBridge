import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import { openSync, readSync, closeSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { forgetLaunchedEditor, rememberLaunchedEditor } from './editorlock'
import type { EngineKind } from '@shared/types'

type Emit = (channel: string, payload: unknown) => void
let emit: Emit = () => {}
export function setRunEmitter(fn: Emit): void {
  emit = fn
}

interface RunHandle {
  kind: 'pipe' | 'tail'
  child: ChildProcess
  tail?: NodeJS.Timeout
  /** Tail runs only: the log file and how far into it we've read. */
  logPath?: string
  offset?: number
}

const running = new Map<string, RunHandle>()

/**
 * Tail runs we've stopped watching. The editor itself is still (probably) alive,
 * so we keep the log path + read offset around and can pick the log back up.
 */
const watchable = new Map<string, RunHandle>()

export function runningRuns(): string[] {
  return [...running.keys()]
}

/** Runs that are not being watched but could be re-attached to. */
export function reattachableRuns(): string[] {
  return [...watchable.keys()]
}

/** A fresh per-project log path in temp that we redirect Unity/Unreal logs to and tail. */
export function newRunLogPath(projectId: string): string {
  const dir = join(app.getPath('temp'), 'gamebridge-logs')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${projectId}.log`)
  writeFileSync(path, '') // truncate so we tail from the start of this run
  return path
}

/** Format an exit code, decoding common Windows NTSTATUS crash codes. */
function describeExit(code: number | null, signal: string | null): string {
  if (signal) return `terminated (${signal})`
  if (code == null) return 'exited'
  if (code === 0) return 'exited cleanly (code 0)'
  const u = code >>> 0
  const known: Record<number, string> = {
    0xc0000005: 'ACCESS_VIOLATION',
    0xc0000409: 'STACK_BUFFER_OVERRUN',
    0xc000041d: 'FATAL_USER_CALLBACK_EXCEPTION',
    0xc00000fd: 'STACK_OVERFLOW',
    0xc0000374: 'HEAP_CORRUPTION',
    0xc000013a: 'CONTROL_C_EXIT'
  }
  const hex = '0x' + u.toString(16).toUpperCase()
  return known[u] ? `crashed — ${known[u]} (${hex})` : `exited with code ${code} (${hex})`
}

/**
 * Launch a game with stdout/stderr piped back (custom engines). The process is a
 * child of GameBridge and is killed on Stop / app quit.
 */
export function startRun(projectId: string, exe: string, args: string[], cwd: string): void {
  if (running.has(projectId)) stopRun(projectId)
  watchable.delete(projectId)
  emit('run:log', { projectId, line: `▶ ${exe} ${args.join(' ')}`.trim(), stream: 'sys' })

  let child: ChildProcess
  try {
    child = spawn(exe, args, { cwd, windowsHide: false })
  } catch (err) {
    emit('run:log', { projectId, line: `Failed to start: ${(err as Error).message}`, stream: 'err' })
    emit('run:exit', { projectId, code: null, signal: null })
    return
  }
  running.set(projectId, { kind: 'pipe', child })

  const forward = (stream: 'out' | 'err') => (buf: Buffer): void => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.length) emit('run:log', { projectId, line, stream })
    }
  }
  child.stdout?.on('data', forward('out'))
  child.stderr?.on('data', forward('err'))
  child.on('error', (e) =>
    emit('run:log', { projectId, line: `Process error: ${e.message}`, stream: 'err' })
  )
  child.on('close', (code, signal) => {
    running.delete(projectId)
    emit('run:log', { projectId, line: `Process ${describeExit(code, signal)}.`, stream: 'sys' })
    emit('run:exit', { projectId, code, signal })
  })
}

/** Read whatever has been appended to the log since we last looked. */
function readNew(projectId: string, handle: RunHandle): void {
  const logPath = handle.logPath
  if (!logPath) return
  try {
    const size = statSync(logPath).size
    if (size < (handle.offset ?? 0)) handle.offset = 0 // rotated/truncated
    const offset = handle.offset ?? 0
    if (size > offset) {
      const fd = openSync(logPath, 'r')
      const buf = Buffer.alloc(size - offset)
      readSync(fd, buf, 0, buf.length, offset)
      closeSync(fd)
      handle.offset = size
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.length) emit('run:log', { projectId, line, stream: 'out' })
      }
    }
  } catch {
    /* log file not created yet — try again next tick */
  }
}

/** Watch `handle.logPath` from its current offset and report the editor exiting. */
function watch(projectId: string, handle: RunHandle): void {
  handle.tail = setInterval(() => readNew(projectId, handle), 300)
  running.set(projectId, handle)

  handle.child.on('close', (code, signal) => {
    readNew(projectId, handle) // final flush
    if (handle.tail) clearInterval(handle.tail)
    running.delete(projectId)
    watchable.delete(projectId)
    forgetLaunchedEditor(projectId)
    emit('run:log', { projectId, line: `Editor ${describeExit(code, signal)}.`, stream: 'sys' })
    emit('run:exit', { projectId, code, signal, canReattach: false })
  })
}

/**
 * Launch an editor (Unity/Unreal) DETACHED so it survives GameBridge closing, and
 * tail its log file into the Console. Stop only stops watching — it never kills the
 * editor (that could lose unsaved work), and the log can be picked back up later.
 */
export function startRunTailing(
  projectId: string,
  exe: string,
  args: string[],
  cwd: string,
  logPath: string,
  kind: EngineKind = 'unity'
): void {
  if (running.has(projectId)) stopRun(projectId)
  watchable.delete(projectId)
  emit('run:log', {
    projectId,
    line: `▶ ${exe} ${args.join(' ')}  (tailing ${logPath})`.trim(),
    stream: 'sys'
  })

  let child: ChildProcess
  try {
    child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore' })
  } catch (err) {
    emit('run:log', { projectId, line: `Failed to start: ${(err as Error).message}`, stream: 'err' })
    emit('run:exit', { projectId, code: null, signal: null })
    return
  }
  child.unref() // don't keep GameBridge alive for the editor
  // Recorded so a build can tell this project is already open in an editor.
  if (child.pid) rememberLaunchedEditor(projectId, child.pid, kind)

  watch(projectId, { kind: 'tail', child, logPath, offset: 0 })
}

/**
 * Pick a stopped editor log back up, continuing from where we left off so the
 * lines written while we weren't watching aren't lost.
 */
export function reattachRun(projectId: string): { ok: boolean; message: string } {
  if (running.has(projectId)) return { ok: false, message: 'Already watching this log.' }

  const handle = watchable.get(projectId)
  if (!handle || !handle.logPath) {
    return {
      ok: false,
      message: 'Nothing to reconnect to — this session was a piped process, not a log file.'
    }
  }
  watchable.delete(projectId)

  // The editor may have closed while we weren't looking; ChildProcess keeps the
  // exit status, and a closed process will never fire 'close' again.
  const exited = handle.child.exitCode !== null || handle.child.signalCode !== null
  if (exited) {
    emit('run:log', { projectId, line: 'Reconnected — the editor has since closed.', stream: 'sys' })
    readNew(projectId, handle)
    emit('run:exit', {
      projectId,
      code: handle.child.exitCode,
      signal: handle.child.signalCode,
      canReattach: false
    })
    return { ok: true, message: 'Editor already closed — read the rest of the log.' }
  }

  emit('run:log', { projectId, line: `▶ Reconnected to ${handle.logPath}`, stream: 'sys' })
  watch(projectId, handle)
  readNew(projectId, handle) // catch up immediately rather than after a tick
  return { ok: true, message: 'Watching the editor log again.' }
}

function killTree(pid: number): void {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'])
}

export function stopRun(projectId: string): void {
  const h = running.get(projectId)
  if (!h) return
  if (h.tail) clearInterval(h.tail)
  running.delete(projectId)

  if (h.kind === 'pipe') {
    if (h.child.pid) killTree(h.child.pid) // 'close' handler will emit run:exit
  } else {
    // Editor: stop watching but leave it running, and remember where we got to.
    h.child.removeAllListeners('close')
    h.tail = undefined
    watchable.set(projectId, h)
    emit('run:log', {
      projectId,
      line: 'Stopped watching log (editor left running).',
      stream: 'sys'
    })
    emit('run:exit', { projectId, code: null, signal: null, canReattach: true })
  }
}

/** On quit: kill child games, but leave detached editors running. */
export function stopAllRuns(): void {
  for (const [, h] of running) {
    if (h.tail) clearInterval(h.tail)
    if (h.kind === 'pipe' && h.child.pid) killTree(h.child.pid)
  }
  running.clear()
  watchable.clear()
}
