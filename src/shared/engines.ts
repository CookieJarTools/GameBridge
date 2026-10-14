import type { Engine, EngineKind } from './types'

/** Unity and Unreal are always present and cannot be removed. */
export const BUILTIN_ENGINES: Engine[] = [
  { id: 'unity', name: 'Unity', kind: 'unity', builtin: true, color: '#4b9fe1' },
  { id: 'unreal', name: 'Unreal', kind: 'unreal', builtin: true, color: '#f28c28' }
]

/** Coarse colour per launch kind (used for asset-store relevance dots). */
export const KIND_COLORS: Record<EngineKind, string> = {
  unity: '#4b9fe1',
  unreal: '#f28c28',
  custom: '#9b7bff'
}

/**
 * Default build command per engine kind. {exe} is the resolved engine executable,
 * {path} the project folder, {file} the launch file, {args} the project's build args.
 * These are starting points — Unity needs a real build method and Unreal a real
 * target, so expect to tweak them per engine/project.
 */
export const DEFAULT_BUILD_TEMPLATES: Record<EngineKind, string> = {
  unity:
    '"{exe}" -quit -batchmode -nographics -projectPath "{path}" -executeMethod BuildScript.PerformBuild -logFile - {args}',
  unreal: '"{exe}" "{file}" {args}',
  custom: '"{exe}" {args}'
}

/** Palette cycled through when creating new custom engines. */
export const ENGINE_PALETTE = [
  '#9b7bff',
  '#2dd4bf',
  '#f472b6',
  '#facc15',
  '#38bdf8',
  '#fb7185',
  '#a3e635',
  '#c084fc'
]

/** Built-in engines plus the user-defined ones. */
export function allEngines(userEngines: Engine[]): Engine[] {
  return [...BUILTIN_ENGINES, ...userEngines]
}

export function findEngine(userEngines: Engine[], id: string): Engine | undefined {
  return allEngines(userEngines).find((e) => e.id === id)
}

export function nextEngineColor(userEngines: Engine[]): string {
  return ENGINE_PALETTE[userEngines.length % ENGINE_PALETTE.length]
}
