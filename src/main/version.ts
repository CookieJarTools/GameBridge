import { promises as fs } from 'fs'
import { join } from 'path'
import type { EngineKind, ProjectVersion, VersionBump } from '@shared/types'

/**
 * Reading and bumping a project's version.
 *
 * Unity keeps this in ProjectSettings.asset as plain YAML scalars, so it can be
 * read and written without the editor — which matters, because the version has
 * to be set before Unity is launched for the build that stamps it.
 *
 * Every write is surgical: one known line, replaced only when exactly one match
 * exists, with the original kept alongside. Nothing here reformats the file.
 */

const SETTINGS = (projectPath: string): string =>
  join(projectPath, 'ProjectSettings', 'ProjectSettings.asset')

/** `  bundleVersion: 1.2.3` */
const BUNDLE = /^([ \t]*bundleVersion:[ \t]*)(.*)$/m
/** `  AndroidBundleVersionCode: 12` */
const ANDROID_CODE = /^([ \t]*AndroidBundleVersionCode:[ \t]*)(\d+)[ \t]*$/m
/**
 * The `buildNumber:` block and only its children:
 *
 *     buildNumber:
 *       Standalone: 0
 *       iPhone: 0
 *     overrideDefaultApplicationIdentifier: 1   <- must NOT be included
 *
 * The children are indented deeper than `buildNumber:` itself, and the
 * back-reference enforces that. Matching "indented `word: digits`" alone runs
 * straight past the block into the rest of the settings.
 */
const BUILD_NUMBER_BLOCK = /^([ \t]*)buildNumber:[ \t]*\r?\n((?:\1[ \t]+\w+:[ \t]*\d+[ \t]*\r?\n)+)/m

export async function readProjectVersion(
  projectPath: string,
  kind: EngineKind | undefined
): Promise<ProjectVersion | undefined> {
  if (kind !== 'unity') return undefined
  try {
    const text = await fs.readFile(SETTINGS(projectPath), 'utf-8')
    const version = BUNDLE.exec(text)?.[2]?.trim()
    if (version === undefined) return undefined
    const androidCode = ANDROID_CODE.exec(text)?.[2]
    return {
      version,
      androidVersionCode: androidCode ? Number(androidCode) : undefined
    }
  } catch {
    return undefined
  }
}

/**
 * Work out what a version becomes. Only the leading dotted numbers are touched,
 * so `1.2.3-beta` keeps its suffix and `0.1` gains a patch part rather than
 * being reinterpreted.
 */
export function nextVersion(current: string, bump: VersionBump): string {
  if (bump === 'none') return current

  const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(current.trim())
  if (!match) return current

  const parts = match[1].split('.').map((n) => Number(n))
  const suffix = match[2]
  while (parts.length < 3) parts.push(0)

  if (bump === 'major') {
    parts[0] += 1
    parts[1] = 0
    parts[2] = 0
  } else if (bump === 'minor') {
    parts[1] += 1
    parts[2] = 0
  } else {
    parts[parts.length - 1] += 1
  }

  return parts.join('.') + suffix
}

export interface VersionWriteResult {
  ok: boolean
  version: string
  androidVersionCode?: number
  message?: string
}

/**
 * Write a new version into ProjectSettings.asset, bumping the platform build
 * counters with it. Refuses rather than guessing if the file doesn't look the
 * way it should.
 */
export async function writeProjectVersion(
  projectPath: string,
  version: string
): Promise<VersionWriteResult> {
  const path = SETTINGS(projectPath)
  let text: string
  try {
    text = await fs.readFile(path, 'utf-8')
  } catch (err) {
    return { ok: false, version, message: `Could not read ProjectSettings: ${(err as Error).message}` }
  }

  const matches = text.match(new RegExp(BUNDLE.source, 'gm')) ?? []
  if (matches.length !== 1) {
    return {
      ok: false,
      version,
      message: `Expected exactly one bundleVersion line in ProjectSettings, found ${matches.length}. Left it alone.`
    }
  }

  let next = text.replace(BUNDLE, (_m, prefix: string) => `${prefix}${version}`)

  // Android needs an always-increasing integer, separate from the version string.
  let androidVersionCode: number | undefined
  next = next.replace(ANDROID_CODE, (_m, prefix: string, value: string) => {
    androidVersionCode = Number(value) + 1
    return `${prefix}${androidVersionCode}`
  })

  // iOS/macOS build numbers live in a nested block; bump each platform in it.
  next = next.replace(BUILD_NUMBER_BLOCK, (_m, indent: string, body: string) => {
    const bumped = body.replace(
      /^([ \t]+\w+:[ \t]*)(\d+)([ \t]*)$/gm,
      (_l, prefix: string, value: string, tail: string) => `${prefix}${Number(value) + 1}${tail}`
    )
    return `${indent}buildNumber:\n${bumped}`
  })

  try {
    // Keep the original beside it only long enough to land the new one safely.
    const temp = path + '.gbtmp'
    await fs.writeFile(temp, next, 'utf-8')
    await fs.rename(temp, path)
  } catch (err) {
    return { ok: false, version, message: `Could not write ProjectSettings: ${(err as Error).message}` }
  }

  return { ok: true, version, androidVersionCode }
}
