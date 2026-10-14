import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AppData, Settings } from '@shared/types'

const DATA_FILE = () => join(app.getPath('userData'), 'gamebridge-data.json')

export function defaultSettings(): Settings {
  return {
    scanRoots: [],
    tags: [],
    defaultIdeId: undefined,
    ideByEngine: {},
    buildByEngine: {},
    generateByEngine: {},
    generateBeforeBuild: {},
    toolchainBinByEngine: {},
    captureLogsByEngine: {},
    closeEditorForBuild: 'ask',
    ides: [],
    engines: [],
    engineConfig: {
      unityEditorsRoot: undefined,
      unityHubPath: undefined,
      unityEditors: [],
      unrealInstalls: []
    },
    theme: 'dark'
  }
}

/** Migrate data written by pre-engine-registry builds. */
function migrate(data: AppData): AppData {
  const anySettings = data.settings as unknown as Record<string, unknown>
  if (Array.isArray(anySettings.customEngines) && !anySettings.engines) {
    data.settings.engines = (anySettings.customEngines as Record<string, unknown>[]).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? 'Engine'),
      kind: 'custom' as const,
      builtin: false,
      color: typeof c.color === 'string' ? c.color : '#9b7bff',
      executable: c.executable as string | undefined,
      argsTemplate: c.argsTemplate as string | undefined,
      detectExtension: c.detectExtension as string | undefined
    }))
    delete anySettings.customEngines
  }
  for (const p of data.projects) {
    const anyP = p as unknown as Record<string, unknown>
    if (p.engineId == null && typeof anyP.engine === 'string') {
      p.engineId =
        anyP.engine === 'custom' ? String(anyP.customEngineId ?? '') : (anyP.engine as string)
      delete anyP.engine
      delete anyP.customEngineId
    }
  }

  // Fields added after the first releases may be missing from older engineConfig objects.
  if (!Array.isArray(data.settings.engineConfig.unityEditors)) {
    data.settings.engineConfig.unityEditors = []
  }
  // Maps added in later versions may be missing from older data.
  data.settings.generateByEngine ??= {}
  data.settings.generateBeforeBuild ??= {}
  data.settings.toolchainBinByEngine ??= {}
  data.settings.closeEditorForBuild ??= 'ask'
  // captureLogs moved from the Engine object to a per-engineId map so built-ins can use it.
  if (!data.settings.captureLogsByEngine) data.settings.captureLogsByEngine = {}
  for (const eng of data.settings.engines) {
    const anyE = eng as unknown as Record<string, unknown>
    if (anyE.captureLogs === true) {
      data.settings.captureLogsByEngine[eng.id] = true
      delete anyE.captureLogs
    }
  }
  return data
}

function defaultData(): AppData {
  return { projects: [], settings: defaultSettings() }
}

let cache: AppData | null = null

export async function loadData(): Promise<AppData> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(DATA_FILE(), 'utf-8')
    const parsed = JSON.parse(raw) as AppData
    // Merge to tolerate older files missing new fields.
    cache = migrate({
      projects: parsed.projects ?? [],
      settings: { ...defaultSettings(), ...parsed.settings }
    })
  } catch {
    cache = defaultData()
  }
  return cache
}

export async function saveData(data: AppData): Promise<void> {
  cache = data
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(DATA_FILE(), JSON.stringify(data, null, 2), 'utf-8')
}

export async function mutate(fn: (d: AppData) => void | Promise<void>): Promise<AppData> {
  const data = await loadData()
  await fn(data)
  await saveData(data)
  return data
}

export function newId(): string {
  return randomUUID()
}
