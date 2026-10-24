import { promises as fs } from 'fs'
import type { UnrealAssetKind } from '@shared/types'

/**
 * Just enough of Unreal's package format to answer two questions without the
 * engine: what kind of asset is this, and does it still carry its original
 * source file (a WAV or PNG) that we can copy straight out?
 *
 * Only the package summary, the name table and the import table are read.
 * Those have kept a stable layout from UE 4.2x through UE 5.x, unlike the
 * export table, which changes shape between versions.
 */

const PACKAGE_TAG = 0x9e2a83c1
const PKG_FILTER_EDITOR_ONLY = 0x80000000

// Object versions that change the fields we read.
const UE4_SERIALIZE_TEXT_IN_PACKAGES = 459
const UE4_NAME_HASHES_SERIALIZED = 504
const UE4_LOCALIZATION_ID = 516
const UE4_NON_OUTER_PACKAGE_IMPORT = 520
const UE5_OPTIONAL_RESOURCES = 1003
const UE5_SOFT_OBJECT_PATH_LIST = 1008
const UE5_PACKAGE_SAVED_HASH = 1016

/** References worth following: meshes point at materials, materials at textures and parents. */
const REFERENCE_CLASSES = new Set(['Texture2D', 'Material', 'MaterialInstanceConstant'])

export interface PackageInfo {
  /** Every class an object inside this package is an instance of. */
  classes: string[]
  /** Packages this one points at through a texture or material import, e.g. "/Game/Props/T_Crate_D". */
  refs: string[]
  /** Engine version the package was saved with, for messages. */
  fileVersionUE4: number
  fileVersionUE5: number
}

class Reader {
  pos = 0
  private buf: Buffer

  constructor(buf: Buffer) {
    this.buf = buf
  }

  int32(): number {
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }

  uint32(): number {
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  skip(n: number): void {
    this.pos += n
  }

  /** FString: length prefix, negative for UTF-16, includes the terminator. */
  fstring(): string {
    const len = this.int32()
    if (len === 0) return ''
    if (len > 0) {
      if (len > 4096) throw new Error('bad string length')
      const s = this.buf.toString('latin1', this.pos, this.pos + len - 1)
      this.pos += len
      return s
    }
    const chars = -len
    if (chars > 4096) throw new Error('bad string length')
    const s = this.buf.toString('utf16le', this.pos, this.pos + (chars - 1) * 2)
    this.pos += chars * 2
    return s
  }
}

/** Reads the package header. Returns null for anything that isn't a readable package. */
export function readPackageInfo(buf: Buffer): PackageInfo | null {
  try {
    const r = new Reader(buf)
    if (r.uint32() !== PACKAGE_TAG) return null

    const legacy = r.int32()
    // -6 and older use custom-version layouts we don't need to support (pre-4.10).
    if (legacy > -7) return null
    if (legacy !== -4) r.int32() // LegacyUE3Version
    const ue4 = r.int32()
    const ue5 = legacy <= -8 ? r.int32() : 0
    r.int32() // licensee version

    // From 1016 the saved hash and header size come before the custom versions.
    if (ue5 >= UE5_PACKAGE_SAVED_HASH) r.skip(20 + 4)

    const customVersions = r.int32()
    if (customVersions < 0 || customVersions > 1000) return null
    r.skip(customVersions * 20) // FGuid + int32

    if (ue5 < UE5_PACKAGE_SAVED_HASH) r.int32() // TotalHeaderSize
    r.fstring() // PackageName
    const flags = r.uint32()
    const nameCount = r.int32()
    const nameOffset = r.int32()
    if (ue5 >= UE5_SOFT_OBJECT_PATH_LIST) r.skip(8)
    if (!(flags & PKG_FILTER_EDITOR_ONLY) && ue4 >= UE4_LOCALIZATION_ID) r.fstring()
    if (ue4 >= UE4_SERIALIZE_TEXT_IN_PACKAGES) r.skip(8)
    r.skip(8) // ExportCount, ExportOffset
    const importCount = r.int32()
    const importOffset = r.int32()

    if (nameCount <= 0 || nameCount > 200_000 || importCount < 0 || importCount > 200_000) return null

    const names: string[] = []
    r.pos = nameOffset
    for (let i = 0; i < nameCount; i++) {
      names.push(r.fstring())
      if (ue4 >= UE4_NAME_HASHES_SERIALIZED) r.skip(4)
    }
    const name = (): string => {
      const index = r.int32()
      r.int32() // FName number suffix
      return names[index] ?? ''
    }

    const imports: { className: string; outer: number; objectName: string }[] = []
    r.pos = importOffset
    for (let i = 0; i < importCount; i++) {
      name() // ClassPackage
      const className = name()
      const outer = r.int32()
      const objectName = name()
      if (ue4 >= UE4_NON_OUTER_PACKAGE_IMPORT && !(flags & PKG_FILTER_EDITOR_ONLY)) name()
      if (ue5 >= UE5_OPTIONAL_RESOURCES) r.int32()
      imports.push({ className, outer, objectName })
    }

    // An import whose class is "Class" is the class of an object in this package;
    // imports of any other class are references to other assets, whose outer
    // import is the package they live in.
    const classes = new Set<string>()
    const refs = new Set<string>()
    for (const imp of imports) {
      if (imp.className === 'Class') {
        classes.add(imp.objectName)
        continue
      }
      if (!REFERENCE_CLASSES.has(imp.className) || imp.outer >= 0) continue
      const pkg = imports[-imp.outer - 1]
      if (pkg?.className === 'Package') refs.add(pkg.objectName)
    }

    return { classes: [...classes], refs: [...refs], fileVersionUE4: ue4, fileVersionUE5: ue5 }
  } catch {
    return null
  }
}

/**
 * Asset classes in priority order. A package can hold several classes (a sound
 * cue also holds its node classes), so the first match wins.
 */
const KIND_BY_CLASS: [string[], UnrealAssetKind][] = [
  [['World'], 'level'],
  [['Blueprint', 'BlueprintGeneratedClass', 'WidgetBlueprint', 'AnimBlueprint'], 'blueprint'],
  [['MetaSoundSource', 'MetaSoundPatch'], 'metaSound'],
  [['SoundCue'], 'soundCue'],
  [['SoundWave'], 'sound'],
  [['AnimSequence'], 'animation'],
  [['AnimMontage', 'BlendSpace', 'BlendSpace1D', 'AimOffsetBlendSpace', 'AimOffsetBlendSpace1D'], 'animationAsset'],
  [['SkeletalMesh'], 'skeletalMesh'],
  [['StaticMesh'], 'staticMesh'],
  [['Skeleton'], 'skeleton'],
  [['PhysicsAsset'], 'physics'],
  [['Texture2D', 'TextureCube', 'VirtualTexture2D'], 'texture'],
  [['Material', 'MaterialInstanceConstant'], 'material'],
  [
    ['MaterialFunction', 'MaterialFunctionMaterialLayer', 'MaterialFunctionMaterialLayerBlend', 'MaterialParameterCollection'],
    'materialFunction'
  ]
]

export function kindFromClasses(classes: string[]): UnrealAssetKind {
  const set = new Set(classes)
  for (const [names, kind] of KIND_BY_CLASS) {
    if (names.some((n) => set.has(n))) return kind
  }
  return 'other'
}

export interface EmbeddedSource {
  ext: 'wav' | 'png'
  start: number
  length: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

/**
 * Editor packages keep the file that was originally imported: a sound wave
 * holds the WAV byte for byte, and a texture often holds a PNG. Finds it.
 */
export function findEmbeddedSource(buf: Buffer, kind: UnrealAssetKind): EmbeddedSource | null {
  if (kind === 'sound') {
    const at = buf.indexOf('RIFF')
    if (at < 0 || buf.toString('latin1', at + 8, at + 12) !== 'WAVE') return null
    const length = buf.readUInt32LE(at + 4) + 8
    if (at + length > buf.length) return null
    return { ext: 'wav', start: at, length }
  }
  if (kind === 'texture') {
    const at = buf.indexOf(PNG_SIGNATURE)
    if (at < 0) return null
    const end = buf.indexOf(PNG_IEND, at)
    if (end < 0) return null
    return { ext: 'png', start: at, length: end + PNG_IEND.length - at }
  }
  return null
}

/** Headers almost always fit in this; larger ones fall back to a full read. */
const HEADER_PROBE_BYTES = 1 << 20

export interface UnrealAssetInfo {
  kind: UnrealAssetKind
  size: number
  source: EmbeddedSource | null
  refs: string[]
}

/**
 * Reads only as much of the file as it needs: the header for the kind, and the
 * whole thing only for sounds and textures, which may carry their source file.
 */
export async function readUnrealAsset(path: string): Promise<UnrealAssetInfo> {
  const handle = await fs.open(path, 'r')
  try {
    const { size } = await handle.stat()
    let buf = Buffer.alloc(Math.min(size, HEADER_PROBE_BYTES))
    await handle.read(buf, 0, buf.length, 0)
    let info = readPackageInfo(buf)
    if (!info && buf.length < size) {
      buf = await fs.readFile(path)
      info = readPackageInfo(buf)
    }
    const kind = info ? kindFromClasses(info.classes) : 'other'
    const mayCarrySource = kind === 'sound' || kind === 'texture'
    if (mayCarrySource && buf.length < size) buf = await fs.readFile(path)
    return { kind, size, source: mayCarrySource ? findEmbeddedSource(buf, kind) : null, refs: info?.refs ?? [] }
  } finally {
    await handle.close()
  }
}

/** The original file stored inside a package, or null if it doesn't carry one. */
export async function extractEmbeddedSource(
  path: string,
  kind: UnrealAssetKind
): Promise<{ ext: EmbeddedSource['ext']; data: Buffer } | null> {
  const buf = await fs.readFile(path)
  const source = findEmbeddedSource(buf, kind)
  return source ? { ext: source.ext, data: buf.subarray(source.start, source.start + source.length) } : null
}
