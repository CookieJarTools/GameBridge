import type { BuildTargetDef } from './types'

/**
 * Unity build targets GameBridge can drive headlessly. `cli` is what Unity's
 * -buildTarget switch wants (it uses different names from the BuildTarget enum
 * that our injected script parses).
 *
 * Targets still need the matching editor module installed — Unity fails the
 * build with a clear message if it isn't, which we surface in the log.
 */
export const UNITY_BUILD_TARGETS: BuildTargetDef[] = [
  {
    id: 'StandaloneWindows64',
    label: 'Windows (x64)',
    cli: 'Win64',
    ext: '.exe',
    hosts: ['win32', 'darwin', 'linux']
  },
  {
    id: 'StandaloneOSX',
    label: 'macOS',
    cli: 'OSXUniversal',
    ext: '.app',
    hosts: ['darwin']
  },
  {
    id: 'StandaloneLinux64',
    label: 'Linux (x64)',
    cli: 'Linux64',
    ext: '.x86_64',
    hosts: ['win32', 'darwin', 'linux']
  },
  {
    id: 'Android',
    label: 'Android',
    cli: 'Android',
    ext: '.apk',
    hosts: ['win32', 'darwin', 'linux']
  },
  { id: 'iOS', label: 'iOS (Xcode project)', cli: 'iOS', ext: '', hosts: ['darwin'] },
  { id: 'WebGL', label: 'WebGL', cli: 'WebGL', ext: '', hosts: ['win32', 'darwin', 'linux'] }
]

export function findBuildTarget(id: string | undefined): BuildTargetDef | undefined {
  return UNITY_BUILD_TARGETS.find((t) => t.id === id)
}

/** The target we preselect: whatever matches the machine we're running on. */
export function defaultBuildTarget(platform: string): BuildTargetDef {
  if (platform === 'darwin') return UNITY_BUILD_TARGETS[1]
  if (platform === 'linux') return UNITY_BUILD_TARGETS[2]
  return UNITY_BUILD_TARGETS[0]
}

/** Strip characters Windows and Unity both dislike in an output file name. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Build'
}

/**
 * Default artifact path for a build: <project>/Builds/<folder>/<Name><ext>,
 * where the folder is the target id unless something better is given — a build
 * profile passes its own name. Folder targets (WebGL, iOS) get the directory
 * itself, which is why callers must not try to patch this path by hand.
 */
export function defaultOutputPath(
  projectPath: string,
  projectName: string,
  target: BuildTargetDef,
  sep = '\\',
  folder?: string
): string {
  const dir = [projectPath, 'Builds', safeFileName(folder ?? target.id)].join(sep)
  return target.ext ? `${dir}${sep}${safeFileName(projectName)}${target.ext}` : dir
}

/**
 * Each build gets its own numbered folder — `0007_1.2.3` — so nothing is ever
 * overwritten and Explorer sorts them in the order they were made. The counter
 * is zero-padded to four digits, which sorts correctly up to 9999 builds and
 * keeps going (unsorted) after that rather than failing.
 */
export function buildFolderName(sequence: number, version?: string): string {
  const padded = String(sequence).padStart(4, '0')
  const clean = version ? safeFileName(version) : ''
  return clean ? `${padded}_${clean}` : padded
}

/** Pull the sequence number back out of a folder name, for finding the newest. */
export function parseBuildFolder(name: string): number | undefined {
  const match = /^(\d{4,})(?:_|$)/.exec(name)
  return match ? Number(match[1]) : undefined
}
