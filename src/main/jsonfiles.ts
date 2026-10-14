import { app } from 'electron'
import { promises as fs, type Dirent } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, join, relative, sep } from 'path'
import type { JsonFileEntry, JsonReadResult, JsonWriteResult } from '@shared/types'

/**
 * Finding, reading and writing the JSON files in a project.
 *
 * Writes are the risky part: a game's data files are often the only copy of
 * hours of work. So every save validates the text parses, keeps a copy of the
 * previous contents outside the project, and lands atomically — a crash
 * mid-write leaves the original intact rather than a half-written file.
 */

const SKIP_DIRS = new Set([
  'library',
  'temp',
  'obj',
  'bin',
  'build',
  'builds',
  'logs',
  'node_modules',
  '.git',
  '.vs',
  '.idea',
  'binaries',
  'intermediate',
  'deriveddatacache',
  'usersettings'
])

/** Editing is form-based; past this a file is shown as text only. */
export const MAX_EDITABLE_BYTES = 5 * 1024 * 1024

const MAX_FILES = 4000

async function walk(dir: string, root: string, out: JsonFileEntry[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      await walk(full, root, out)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
    try {
      const stat = await fs.stat(full)
      const rel = relative(root, full).split(sep).join('/')
      out.push({
        path: full,
        relativePath: rel,
        name: entry.name,
        folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
        bytes: stat.size,
        modifiedAt: stat.mtimeMs
      })
    } catch {
      /* vanished between readdir and stat */
    }
  }
}

/** Every JSON file in a project worth editing, newest-modified first per folder. */
export async function listJsonFiles(projectPath: string): Promise<JsonFileEntry[]> {
  const out: JsonFileEntry[] = []
  await walk(projectPath, projectPath, out)
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/** Work out the indentation a file already uses, so saving doesn't reformat it. */
function detectIndent(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text)
  if (!match) return '  '
  const ws = match[1]
  return ws.includes('\t') ? '\t' : ws
}

/**
 * Object keys that look like integers get reordered by JavaScript, so a save
 * would silently rewrite the file's field order. Worth warning about.
 */
function hasNumericKeys(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => hasNumericKeys(v, depth + 1))
  for (const key of Object.keys(value as object)) {
    if (/^(0|[1-9]\d*)$/.test(key)) return true
  }
  return Object.values(value as object).some((v) => hasNumericKeys(v, depth + 1))
}

export async function readJsonFile(path: string): Promise<JsonReadResult> {
  let text: string
  let bytes = 0
  try {
    const stat = await fs.stat(path)
    bytes = stat.size
    text = await fs.readFile(path, 'utf-8')
  } catch (err) {
    return {
      path,
      name: basename(path),
      bytes: 0,
      text: '',
      tooLarge: false,
      error: `Could not open this file: ${(err as Error).message}`
    }
  }

  // A BOM is invisible but breaks JSON.parse — strip it for parsing and keep
  // the fact, so saving can put it back.
  const bom = text.charCodeAt(0) === 0xfeff
  const body = bom ? text.slice(1) : text

  const base = {
    path,
    name: basename(path),
    bytes,
    text: body,
    indent: detectIndent(body),
    bom,
    tooLarge: bytes > MAX_EDITABLE_BYTES
  }

  if (base.tooLarge) return base

  try {
    const value = JSON.parse(body) as unknown
    return { ...base, value, numericKeys: hasNumericKeys(value) }
  } catch (err) {
    return { ...base, error: (err as Error).message }
  }
}

/* --------------------------------------------------------------- backups */

function backupDir(path: string): string {
  const id = createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'json-backups', id)
}

/** Keep the last few versions of a file, outside the project so nothing imports them. */
async function backup(path: string, previous: string): Promise<void> {
  try {
    const dir = backupDir(path)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, `${Date.now()}.json`), previous, 'utf-8')
    await fs.writeFile(join(dir, 'source.txt'), path, 'utf-8')

    const kept = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
    for (const old of kept.slice(10)) await fs.rm(join(dir, old), { force: true })
  } catch {
    /* a backup is insurance, never a reason to block the save */
  }
}

/**
 * Write a file back. Refuses anything that isn't valid JSON, backs up what was
 * there, and renames into place so a failure can't truncate the original.
 */
export async function writeJsonFile(path: string, text: string): Promise<JsonWriteResult> {
  try {
    JSON.parse(text)
  } catch (err) {
    return { ok: false, message: `Not saved — this isn't valid JSON: ${(err as Error).message}` }
  }

  let previous = ''
  let bom = false
  try {
    previous = await fs.readFile(path, 'utf-8')
    bom = previous.charCodeAt(0) === 0xfeff
  } catch {
    /* new file */
  }
  if (previous) await backup(path, previous)

  const temp = join(dirname(path), `.${basename(path)}.gbtmp`)
  try {
    await fs.writeFile(temp, (bom ? '﻿' : '') + text, 'utf-8')
    await fs.rename(temp, path)
  } catch (err) {
    await fs.rm(temp, { force: true })
    return { ok: false, message: `Could not save: ${(err as Error).message}` }
  }

  const stat = await fs.stat(path).catch(() => undefined)
  return {
    ok: true,
    message: `Saved ${basename(path)}.`,
    bytes: stat?.size ?? 0,
    modifiedAt: stat?.mtimeMs ?? Date.now()
  }
}
