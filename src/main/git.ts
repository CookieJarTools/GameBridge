import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import type { GitAction, GitActionResult, GitStatus } from '@shared/types'
import { exists } from './resolve'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 })
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, args)
    return stdout.trim()
  } catch {
    return null
  }
}

export async function gitStatus(path: string): Promise<GitStatus> {
  const empty: GitStatus = {
    isRepo: false,
    ahead: 0,
    behind: 0,
    dirty: false,
    changedFiles: 0,
    hasUpstream: false
  }
  if (!(await exists(join(path, '.git')))) {
    // Might still be a subfolder of a repo — ask git directly.
    const inside = await tryGit(path, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return empty
  }

  const branch = await tryGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch == null) return empty

  const porcelain = (await tryGit(path, ['status', '--porcelain'])) ?? ''
  const changedFiles = porcelain ? porcelain.split('\n').filter(Boolean).length : 0

  let ahead = 0
  let behind = 0
  let hasUpstream = false
  const counts = await tryGit(path, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  if (counts) {
    const [b, a] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0)
    behind = b
    ahead = a
    hasUpstream = true
  }

  return {
    isRepo: true,
    branch: branch === 'HEAD' ? '(detached)' : branch,
    ahead,
    behind,
    dirty: changedFiles > 0,
    changedFiles,
    hasUpstream
  }
}

export async function runGitAction(
  path: string,
  action: GitAction,
  message?: string
): Promise<GitActionResult> {
  try {
    switch (action) {
      case 'fetch':
        await git(path, ['fetch', '--all', '--prune'])
        return { ok: true, message: 'Fetched from remote.' }
      case 'pull': {
        const { stdout } = await git(path, ['pull', '--ff-only'])
        return { ok: true, message: stdout.trim() || 'Pulled (fast-forward).' }
      }
      case 'push': {
        // Push, setting upstream automatically if the branch has none.
        try {
          await git(path, ['push'])
        } catch {
          const branch = (await tryGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'HEAD'
          await git(path, ['push', '--set-upstream', 'origin', branch])
        }
        return { ok: true, message: 'Pushed to remote.' }
      }
      case 'commit': {
        const msg = (message ?? '').trim()
        if (!msg) return { ok: false, message: 'Commit message is empty.' }
        await git(path, ['add', '-A'])
        const { stdout } = await git(path, ['commit', '-m', msg])
        const summary = stdout.split('\n').find((l) => l.trim()) ?? 'Committed.'
        return { ok: true, message: summary.trim() }
      }
      default:
        return { ok: false, message: `Unknown git action: ${action}` }
    }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const detail = (e.stderr || e.message || 'git command failed').trim()
    return { ok: false, message: detail.split('\n').slice(0, 2).join(' ') }
  }
}
