import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { UnityMaterialSpec } from './materialspec'
import builder from './unitymaterials/GameBridgeMaterialBuilder.cs?raw'
import channelSource from './unitymaterials/GameBridgeChannelSource.cs?raw'
import maskPacker from './unitymaterials/GameBridgeMaskPacker.cs?raw'
import textureLoader from './unitymaterials/GameBridgeTextureLoader.cs?raw'
import manifestType from './unitymaterials/Data/GameBridgeMaterialManifest.cs?raw'
import materialSpec from './unitymaterials/Data/GameBridgeMaterialSpec.cs?raw'
import materialTextures from './unitymaterials/Data/GameBridgeMaterialTextures.cs?raw'
import meshSpec from './unitymaterials/Data/GameBridgeMeshSpec.cs?raw'
import slotSpec from './unitymaterials/Data/GameBridgeSlotSpec.cs?raw'
import builtInLit from './unitymaterials/Shaders/GameBridgeBuiltInLit.cs?raw'
import highDefinitionLit from './unitymaterials/Shaders/GameBridgeHighDefinitionLit.cs?raw'
import pipelineEnum from './unitymaterials/Shaders/GameBridgePipeline.cs?raw'
import pipelines from './unitymaterials/Shaders/GameBridgePipelines.cs?raw'
import shaderValues from './unitymaterials/Shaders/GameBridgeShaderValues.cs?raw'
import universalLit from './unitymaterials/Shaders/GameBridgeUniversalLit.cs?raw'

/**
 * Unreal materials are graphs and can't be converted, so GameBridge rebuilds
 * them in Unity instead: it writes a manifest of what each material uses and a
 * small editor script that turns it into real materials the next time Unity
 * compiles. The script uses Unity's own material APIs, which set up shader
 * keywords properly in a way a hand-written .mat file can't, and it deletes
 * itself when it's done.
 */

export interface UnityMeshSlots {
  path: string
  slots: { name: string; material: string }[]
}

export interface UnityMaterialManifest {
  /** The transfer's destination, relative to the Unity project, e.g. "Assets/From Unreal/MyProject". */
  root: string
  materials: UnityMaterialSpec[]
  meshes: UnityMeshSlots[]
}

const SCRIPT_FOLDER = 'Assets/GameBridge/Editor/Materials'

const SCRIPTS: Record<string, string> = {
  'GameBridgeMaterialBuilder.cs': builder,
  'GameBridgeChannelSource.cs': channelSource,
  'GameBridgeMaskPacker.cs': maskPacker,
  'GameBridgeTextureLoader.cs': textureLoader,
  'Data/GameBridgeMaterialManifest.cs': manifestType,
  'Data/GameBridgeMaterialSpec.cs': materialSpec,
  'Data/GameBridgeMaterialTextures.cs': materialTextures,
  'Data/GameBridgeMeshSpec.cs': meshSpec,
  'Data/GameBridgeSlotSpec.cs': slotSpec,
  'Shaders/GameBridgeBuiltInLit.cs': builtInLit,
  'Shaders/GameBridgeHighDefinitionLit.cs': highDefinitionLit,
  'Shaders/GameBridgePipeline.cs': pipelineEnum,
  'Shaders/GameBridgePipelines.cs': pipelines,
  'Shaders/GameBridgeShaderValues.cs': shaderValues,
  'Shaders/GameBridgeUniversalLit.cs': universalLit
}

/** Writes the builder (refreshing any copy already waiting) and adds this transfer's manifest to its queue. */
export async function queueMaterialBuild(
  unityProjectPath: string,
  manifest: UnityMaterialManifest,
  transferId: string
): Promise<void> {
  const folder = join(unityProjectPath, SCRIPT_FOLDER)
  for (const [rel, source] of Object.entries(SCRIPTS)) {
    const file = join(folder, rel)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, source.replace(/\r\n/g, '\n'), 'utf-8')
  }
  const pending = join(folder, 'Pending')
  await fs.mkdir(pending, { recursive: true })
  await fs.writeFile(join(pending, `${transferId}.json`), JSON.stringify(manifest), 'utf-8')
}
