import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import { basename, extname } from 'path'

/**
 * Import settings for files GameBridge drops into a Unity project, written as
 * .meta files *before* the asset itself so Unity imports it right the first
 * time. Unity fills in every field a .meta leaves out, so these stay minimal.
 *
 * Verified against Unity 6000.4 with FBX files exported from UE 5.8:
 * - Unreal's centimetre scale comes through 1:1 with no settings at all.
 * - Axis conversion is deliberately NOT baked: baking turns Unreal characters
 *   to face -Z. Left alone they face +Z with a 270° rotation on the root.
 * - Animations get their own Humanoid avatar. Copying the mesh's avatar fails
 *   because Unreal names each FBX's root after the file, so paths never match.
 */

export type MetaKind = 'skeletalMesh' | 'animation' | 'texture' | 'other'

const NORMAL_MAP = /[_-](n|bn|nrm|norm|normal|normalmap)$/i
// Packed masks (ORM, ARM, RMA…) and single channels hold data, not colour.
const LINEAR_DATA = /[_-](orm|arm|rma|mra|msk|mask|masks|r|ao|m|h|rough|roughness|metal|metallic|metalness|occlusion|height|disp|displacement)$/i

const newGuid = (): string => randomBytes(16).toString('hex')

function modelMeta(kind: MetaKind, humanoid: boolean): string {
  const lines = ['ModelImporter:', '  serializedVersion: 22200']
  if (humanoid && (kind === 'skeletalMesh' || kind === 'animation')) {
    lines.push('  animationType: 3', '  avatarSetup: 1')
  }
  return lines.join('\n')
}

function textureMeta(fileName: string): string {
  const stem = basename(fileName, extname(fileName))
  const lines = ['TextureImporter:', '  serializedVersion: 13']
  if (NORMAL_MAP.test(stem)) lines.push('  textureType: 1')
  else if (LINEAR_DATA.test(stem)) lines.push('  mipmaps:', '    sRGBTexture: 0')
  return lines.join('\n')
}

function metaBody(filePath: string, kind: MetaKind, humanoid: boolean): string | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.fbx') return modelMeta(kind, humanoid)
  if (['.png', '.tga', '.jpg', '.jpeg', '.psd', '.exr', '.tif', '.tiff'].includes(ext)) return textureMeta(filePath)
  return null
}

/**
 * Writes `<file>.meta` if the file needs non-default settings and has no
 * .meta yet. An existing .meta is never touched: it holds the GUID that the
 * rest of the project references the asset by.
 */
export async function writeImportMeta(filePath: string, kind: MetaKind, humanoid: boolean): Promise<void> {
  const body = metaBody(filePath, kind, humanoid)
  if (!body) return
  const metaPath = `${filePath}.meta`
  try {
    await fs.access(metaPath)
    return
  } catch {
    // no .meta yet
  }
  await fs.writeFile(metaPath, `fileFormatVersion: 2\nguid: ${newGuid()}\n${body}\n`, 'utf-8')
}
