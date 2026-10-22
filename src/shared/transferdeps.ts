import type { UnrealAssetEntry } from './types'

/**
 * What a selection needs so its materials can be rebuilt in Unity: the
 * materials each model uses, and every texture those materials use.
 *
 * A material instance only lists the textures it overrides, so its parent
 * materials are followed for the rest. The parents themselves aren't added:
 * the instance already carries their values.
 */
export function withMaterialDependencies(assets: UnrealAssetEntry[], selected: Iterable<string>): Set<string> {
  const byPath = new Map(assets.map((a) => [a.path, a]))
  const out = new Set(selected)

  for (const path of [...out]) {
    const asset = byPath.get(path)
    if (asset?.kind !== 'staticMesh' && asset?.kind !== 'skeletalMesh') continue
    for (const ref of asset.refs) {
      if (byPath.get(ref)?.kind === 'material') out.add(ref)
    }
  }

  const addTextures = (materialPath: string, seen: Set<string>): void => {
    for (const ref of byPath.get(materialPath)?.refs ?? []) {
      const dep = byPath.get(ref)
      if (dep?.kind === 'texture') out.add(ref)
      if (dep?.kind === 'material' && !seen.has(ref)) {
        seen.add(ref)
        addTextures(ref, seen)
      }
    }
  }
  for (const path of [...out]) {
    if (byPath.get(path)?.kind === 'material') addTextures(path, new Set([path]))
  }
  return out
}
