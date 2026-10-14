import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { BuildRecord } from '@shared/types'

/**
 * Build history, kept next to the app data so reports survive a restart.
 * Logs are not persisted — only the record and its parsed report.
 */

const MAX_RECORDS = 40

const FILE = (): string => join(app.getPath('userData'), 'gamebridge-builds.json')

export function reportPathFor(buildId: string): string {
  return join(app.getPath('userData'), 'build-reports', `${buildId}.json`)
}

let cache: BuildRecord[] | null = null

export async function loadHistory(): Promise<BuildRecord[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(FILE(), 'utf-8')
    const parsed = JSON.parse(raw) as BuildRecord[]
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache
}

/** Insert or replace a record, newest first, trimming old ones. */
export async function saveRecord(record: BuildRecord): Promise<void> {
  const history = await loadHistory()
  const i = history.findIndex((r) => r.id === record.id)
  if (i >= 0) history[i] = record
  else history.unshift(record)

  history.sort((a, b) => b.startedAt - a.startedAt)
  const dropped = history.splice(MAX_RECORDS)
  cache = history

  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(FILE(), JSON.stringify(history, null, 2), 'utf-8')
    for (const old of dropped) await fs.rm(reportPathFor(old.id), { force: true })
  } catch {
    /* history is a nicety — never fail a build over it */
  }
}

export async function removeRecord(buildId: string): Promise<BuildRecord[]> {
  const history = await loadHistory()
  cache = history.filter((r) => r.id !== buildId)
  try {
    await fs.writeFile(FILE(), JSON.stringify(cache, null, 2), 'utf-8')
    await fs.rm(reportPathFor(buildId), { force: true })
  } catch {
    /* ignore */
  }
  return cache
}
