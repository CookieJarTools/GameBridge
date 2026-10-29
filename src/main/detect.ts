import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import type { EngineConfig, IDE, UnrealInstall } from '@shared/types'
import { newId } from './store'
import { findUnityHub, listInstalledEditors } from './unityhub'
import { findOnPath, IS_WINDOWS, UNREAL_BINARIES_DIR, UNREAL_EDITOR_BINARY } from './platform'

const execFileAsync = promisify(execFile)

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const p of paths) {
    if (await exists(p)) return p
  }
  return undefined
}

async function readDirSafe(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p)
  } catch {
    return []
  }
}

/**
 * JetBrains IDEs, keyed by their launcher: `exe` on Windows, `bin` on Linux
 * (bin/<bin>.sh in the install, or <bin> on PATH). Rider opens a solution;
 * the rest are happiest opening the project folder.
 */
const JETBRAINS_IDES: { name: string; exe: string; bin: string; args: string }[] = [
  { name: 'Rider', exe: 'rider64.exe', bin: 'rider', args: '"{sln}"' },
  { name: 'CLion', exe: 'clion64.exe', bin: 'clion', args: '"{path}"' },
  { name: 'IntelliJ IDEA', exe: 'idea64.exe', bin: 'idea', args: '"{path}"' },
  { name: 'WebStorm', exe: 'webstorm64.exe', bin: 'webstorm', args: '"{path}"' },
  { name: 'PyCharm', exe: 'pycharm64.exe', bin: 'pycharm', args: '"{path}"' },
  { name: 'GoLand', exe: 'goland64.exe', bin: 'goland', args: '"{path}"' },
  { name: 'RustRover', exe: 'rustrover64.exe', bin: 'rustrover', args: '"{path}"' }
]

const PF = process.env['ProgramFiles'] || 'C:\\Program Files'
const PFX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const LOCALAPPDATA = process.env['LOCALAPPDATA'] || ''
const HOME = homedir()
const TOOLBOX = join(HOME, '.local', 'share', 'JetBrains', 'Toolbox')

/** Where the Hub puts editors unless told otherwise. */
const UNITY_EDITOR_ROOTS = IS_WINDOWS
  ? [join(PF, 'Unity', 'Hub', 'Editor'), join(PFX86, 'Unity', 'Hub', 'Editor')]
  : [join(HOME, 'Unity', 'Hub', 'Editor')]

/** A custom editors folder chosen in the Hub's preferences, if there is one. */
async function readHubInstallPath(): Promise<string[]> {
  try {
    const file = join(app.getPath('appData'), 'UnityHub', 'secondaryInstallPath.json')
    const path = JSON.parse(await fs.readFile(file, 'utf-8'))
    return typeof path === 'string' && path ? [path] : []
  } catch {
    return []
  }
}

/** Locate Unity Hub + editors and any installed Unreal engines. */
export async function detectEngines(existingHubPath?: string): Promise<EngineConfig> {
  const unityEditorsRoot = await firstExisting([...(await readHubInstallPath()), ...UNITY_EDITOR_ROOTS])

  // Unity Hub gives us the authoritative installed-editor list (incl. custom dirs).
  const unityHubPath = await findUnityHub(existingHubPath)
  const unityEditors = unityHubPath ? await listInstalledEditors(unityHubPath) : []

  const unrealInstalls = IS_WINDOWS ? await detectUnrealWindows() : await detectUnrealLinux()

  return { unityEditorsRoot, unityHubPath, unityEditors, unrealInstalls }
}

async function detectUnrealWindows(): Promise<UnrealInstall[]> {
  // The Epic launcher's own install list covers engines in custom folders
  // (e.g. D:\Unreal\UE_5.8); the Program Files scan below is the fallback.
  const unrealInstalls: UnrealInstall[] = await readEpicLauncherInstalls()
  for (const epicRoot of [join(PF, 'Epic Games'), join(PFX86, 'Epic Games')]) {
    if (!(await exists(epicRoot))) continue
    let entries: string[] = []
    try {
      entries = await fs.readdir(epicRoot)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('UE_')) continue
      const editorPath = join(epicRoot, entry, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
      if (unrealInstalls.some((u) => u.editorPath.toLowerCase() === editorPath.toLowerCase())) continue
      if (await exists(editorPath)) {
        unrealInstalls.push({ version: entry.replace('UE_', ''), editorPath })
      }
    }
  }
  return unrealInstalls
}

/**
 * Linux has no Epic launcher: engines are source builds or Epic's prebuilt
 * zip, kept wherever the user likes. Source builds register themselves in
 * Install.ini; otherwise look one folder into the usual places.
 */
async function detectUnrealLinux(): Promise<UnrealInstall[]> {
  const roots = new Set(await readLinuxEngineRegistry())
  for (const parent of [HOME, join(HOME, 'Unreal'), join(HOME, 'Epic Games'), '/opt']) {
    roots.add(parent)
    for (const dir of await readDirSafe(parent)) {
      if (!dir.startsWith('.')) roots.add(join(parent, dir))
    }
  }
  const installs: UnrealInstall[] = []
  for (const root of roots) {
    const editorPath = join(root, 'Engine', 'Binaries', UNREAL_BINARIES_DIR, UNREAL_EDITOR_BINARY)
    if (!(await exists(editorPath))) continue
    const version = await readEngineVersion(root)
    if (version) installs.push({ version, editorPath })
  }
  return installs
}

/** Engine folders listed under [Installations] in Unreal's Linux Install.ini. */
async function readLinuxEngineRegistry(): Promise<string[]> {
  let text: string
  try {
    text = await fs.readFile(join(HOME, '.config', 'Epic', 'UnrealEngine', 'Install.ini'), 'utf-8')
  } catch {
    return []
  }
  const roots: string[] = []
  let inInstallations = false
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line)
    if (section) inInstallations = section[1] === 'Installations'
    else if (inInstallations && line.includes('=')) roots.push(resolve(line.slice(line.indexOf('=') + 1).trim()))
  }
  return roots
}

/** "5.4" from Engine/Build/Build.version, the same form the Epic launcher uses. */
async function readEngineVersion(root: string): Promise<string | undefined> {
  try {
    const build = JSON.parse(await fs.readFile(join(root, 'Engine', 'Build', 'Build.version'), 'utf-8'))
    return build.MajorVersion != null ? `${build.MajorVersion}.${build.MinorVersion ?? 0}` : undefined
  } catch {
    return undefined
  }
}

/** Engines the Epic launcher installed, wherever they live. */
export async function readEpicLauncherInstalls(): Promise<UnrealInstall[]> {
  const programData = process.env['ProgramData'] ?? 'C:\\ProgramData'
  const file = join(programData, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat')
  let list: { InstallLocation?: string; AppName?: string }[] = []
  try {
    list = JSON.parse(await fs.readFile(file, 'utf-8')).InstallationList ?? []
  } catch {
    return []
  }
  const installs: UnrealInstall[] = []
  for (const item of list) {
    // Plugins share the engine's folder; only the engine entry itself is UE_<version>.
    if (!item.AppName?.startsWith('UE_') || !item.InstallLocation) continue
    const editorPath = join(item.InstallLocation, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
    if (await exists(editorPath)) installs.push({ version: item.AppName.slice(3), editorPath })
  }
  return installs
}

/** VS Code, or one of its open-source builds, from PATH (distro and AUR packages land there). */
async function findVsCodeLinux(): Promise<{ name: string; path: string } | undefined> {
  for (const [name, bin] of [
    ['VS Code', 'code'],
    ['Code - OSS', 'code-oss'],
    ['VSCodium', 'codium']
  ]) {
    const path = await findOnPath([bin])
    if (path) return { name, path }
  }
  return undefined
}

/** Best-effort detection of common IDEs on Windows and Linux. */
export async function detectIdes(): Promise<IDE[]> {
  const found: IDE[] = []

  if (IS_WINDOWS) {
    const vscode = await firstExisting([
      join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      join(PF, 'Microsoft VS Code', 'Code.exe')
    ])
    if (vscode) {
      found.push({ id: newId(), name: 'VS Code', executable: vscode, argsTemplate: '"{path}"' })
    }
  } else {
    const vscode = await findVsCodeLinux()
    if (vscode) {
      found.push({ id: newId(), name: vscode.name, executable: vscode.path, argsTemplate: '"{path}"' })
    }
  }

  // JetBrains IDEs. Covers the Toolbox layout (%LOCALAPPDATA%\Programs\<Product>\bin)
  // and versioned Program Files folders (JetBrains\<Product 2024.1>\bin). On Linux
  // that's Toolbox's apps folder and /opt, where tarballs and AUR packages go.
  const jetbrainsRoots = IS_WINDOWS
    ? [join(LOCALAPPDATA, 'Programs'), join(PF, 'JetBrains')]
    : [join(TOOLBOX, 'apps'), '/opt']
  const seenProducts = new Set<string>()
  const addJetBrains = (product: (typeof JETBRAINS_IDES)[number], exe: string): void => {
    seenProducts.add(product.name)
    found.push({ id: newId(), name: product.name, executable: exe, argsTemplate: product.args })
  }
  for (const root of jetbrainsRoots) {
    for (const dir of await readDirSafe(root)) {
      for (const product of JETBRAINS_IDES) {
        if (seenProducts.has(product.name)) continue
        const exe = join(root, dir, 'bin', IS_WINDOWS ? product.exe : `${product.bin}.sh`)
        if (await exists(exe)) addJetBrains(product, exe)
      }
    }
  }
  if (!IS_WINDOWS) {
    // Distro packages put a launcher on PATH; Toolbox writes its own into scripts.
    for (const product of JETBRAINS_IDES) {
      if (seenProducts.has(product.name)) continue
      const exe = (await findOnPath([product.bin])) ?? (await firstExisting([join(TOOLBOX, 'scripts', product.bin)]))
      if (exe) addJetBrains(product, exe)
    }
    return found
  }

  // Visual Studio via vswhere.
  const vswhere = join(PFX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (await exists(vswhere)) {
    try {
      const { stdout } = await execFileAsync(vswhere, [
        '-latest',
        '-property',
        'productPath',
        '-format',
        'value'
      ])
      const devenv = stdout.trim()
      if (devenv && (await exists(devenv))) {
        found.push({ id: newId(), name: 'Visual Studio', executable: devenv, argsTemplate: '"{sln}"' })
      }
    } catch {
      /* ignore */
    }
  }

  return found
}
