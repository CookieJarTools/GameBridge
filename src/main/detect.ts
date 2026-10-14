import { promises as fs } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { EngineConfig, IDE, UnrealInstall } from '@shared/types'
import { newId } from './store'
import { findUnityHub, listInstalledEditors } from './unityhub'

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
 * JetBrains IDEs, keyed by their launcher executable. Rider opens a solution;
 * the rest are happiest opening the project folder.
 */
const JETBRAINS_IDES: { name: string; exe: string; args: string }[] = [
  { name: 'Rider', exe: 'rider64.exe', args: '"{sln}"' },
  { name: 'CLion', exe: 'clion64.exe', args: '"{path}"' },
  { name: 'IntelliJ IDEA', exe: 'idea64.exe', args: '"{path}"' },
  { name: 'WebStorm', exe: 'webstorm64.exe', args: '"{path}"' },
  { name: 'PyCharm', exe: 'pycharm64.exe', args: '"{path}"' },
  { name: 'GoLand', exe: 'goland64.exe', args: '"{path}"' },
  { name: 'RustRover', exe: 'rustrover64.exe', args: '"{path}"' }
]

const PF = process.env['ProgramFiles'] || 'C:\\Program Files'
const PFX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const LOCALAPPDATA = process.env['LOCALAPPDATA'] || ''

/** Locate Unity Hub + editors and any installed Unreal engines. */
export async function detectEngines(existingHubPath?: string): Promise<EngineConfig> {
  const unityEditorsRoot = await firstExisting([
    join(PF, 'Unity', 'Hub', 'Editor'),
    join(PFX86, 'Unity', 'Hub', 'Editor')
  ])

  // Unity Hub gives us the authoritative installed-editor list (incl. custom dirs).
  const unityHubPath = await findUnityHub(existingHubPath)
  const unityEditors = unityHubPath ? await listInstalledEditors(unityHubPath) : []

  const unrealInstalls: UnrealInstall[] = []
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
      if (await exists(editorPath)) {
        unrealInstalls.push({ version: entry.replace('UE_', ''), editorPath })
      }
    }
  }

  return { unityEditorsRoot, unityHubPath, unityEditors, unrealInstalls }
}

/** Best-effort detection of common IDEs on Windows. */
export async function detectIdes(): Promise<IDE[]> {
  const found: IDE[] = []

  const vscode = await firstExisting([
    join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    join(PF, 'Microsoft VS Code', 'Code.exe')
  ])
  if (vscode) {
    found.push({ id: newId(), name: 'VS Code', executable: vscode, argsTemplate: '"{path}"' })
  }

  // JetBrains IDEs. Covers the Toolbox layout (%LOCALAPPDATA%\Programs\<Product>\bin)
  // and versioned Program Files folders (JetBrains\<Product 2024.1>\bin).
  const jetbrainsRoots = [join(LOCALAPPDATA, 'Programs'), join(PF, 'JetBrains')]
  const seenProducts = new Set<string>()
  for (const root of jetbrainsRoots) {
    for (const dir of await readDirSafe(root)) {
      for (const product of JETBRAINS_IDES) {
        if (seenProducts.has(product.name)) continue
        const exe = join(root, dir, 'bin', product.exe)
        if (await exists(exe)) {
          seenProducts.add(product.name)
          found.push({
            id: newId(),
            name: product.name,
            executable: exe,
            argsTemplate: product.args
          })
        }
      }
    }
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
