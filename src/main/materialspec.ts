/**
 * Turns an Unreal material description (texture parameters, scalars, vectors,
 * blend mode) into the handful of things a Unity Lit material needs: which
 * texture is the colour, the normal map, where metallic / roughness / AO live,
 * and a tint.
 *
 * Unreal materials are graphs and their parameter names are whatever the
 * author typed ("Base Texture", "BNormal", "MRA"), so roles are read from the
 * parameter name first and from the texture's suffix (_D, _N, _ORM…) second.
 */

export interface UnrealMaterialDescription {
  blend: string
  twoSided: boolean
  cutoff: number
  textures: { param: string; path: string }[]
  scalars: { name: string; value: number }[]
  vectors: { name: string; value: number[] }[]
}

/** Mirrors GameBridgeMaterialSpec.cs; texture paths are relative to the transfer root, without extension. */
export interface UnityMaterialSpec {
  name: string
  path: string
  blend: 'opaque' | 'masked' | 'transparent' | 'additive'
  twoSided: boolean
  cutoff: number
  baseMap: string
  normalMap: string
  emissionMap: string
  metallicMap: string
  metallicChannel: number
  occlusionMap: string
  occlusionChannel: number
  roughnessMap: string
  roughnessChannel: number
  tint: number[]
  metallic: number
  roughness: number
  emission: number
}

type Role = 'base' | 'normal' | 'packed' | 'metallic' | 'roughness' | 'occlusion' | 'emission'

interface Classified {
  role: Role
  /** For packed maps: the channel each of metallic, roughness and AO lives in. */
  channels?: { metallic: number; roughness: number; occlusion: number }
}

const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Reads a packed-map layout from its letters: ORM is AO/roughness/metallic in
 * R/G/B, MRA is metallic/roughness/AO. A, O and "AO" all mean occlusion.
 */
function packedChannels(token: string): Classified['channels'] | null {
  const letters = token.toLowerCase().replace(/ao/g, 'o').replace(/a/g, 'o')
  if (!/^[orm]{3}$/.test(letters) || new Set(letters).size !== 3) return null
  return { occlusion: letters.indexOf('o'), roughness: letters.indexOf('r'), metallic: letters.indexOf('m') }
}

/** "OcclusionRoughnessMetallic" and friends, spelled out. */
function spelledOutChannels(name: string): Classified['channels'] | null {
  const n = flat(name)
  const at = { occlusion: n.search(/occlusion|ao/), roughness: n.indexOf('rough'), metallic: n.indexOf('metal') }
  if (at.occlusion < 0 || at.roughness < 0 || at.metallic < 0) return null
  const order = (Object.keys(at) as (keyof typeof at)[]).sort((a, b) => at[a] - at[b])
  return { occlusion: order.indexOf('occlusion'), roughness: order.indexOf('roughness'), metallic: order.indexOf('metallic') }
}

function fromParam(param: string): Classified | null {
  const n = flat(param)
  if (!n) return null
  const channels = packedChannels(n) ?? spelledOutChannels(param)
  if (channels) return { role: 'packed', channels }
  if (n.includes('normal') || n === 'nrm' || n === 'n') return { role: 'normal' }
  if (/emiss|emission|glow/.test(n)) return { role: 'emission' }
  if (n.includes('rough')) return { role: 'roughness' }
  if (n.includes('metal')) return { role: 'metallic' }
  if (n.includes('occlusion') || n === 'ao') return { role: 'occlusion' }
  if (/basecolor|albedo|diffuse|basetexture|basemap|maintex|colou?r(map|texture)?$|^base$|^d$/.test(n)) return { role: 'base' }
  return null
}

function fromTextureName(path: string): Classified | null {
  const name = path.split('/').pop() ?? ''
  const suffix = name.split('_').pop() ?? ''
  const s = suffix.toLowerCase()
  const channels = packedChannels(s)
  if (channels) return { role: 'packed', channels }
  if (['d', 'bc', 'basecolor', 'albedo', 'diffuse', 'col', 'color', 'colour', 'c'].includes(s)) return { role: 'base' }
  if (['n', 'bn', 'nrm', 'nor', 'normal', 'normals'].includes(s)) return { role: 'normal' }
  if (['r', 'rough', 'roughness'].includes(s)) return { role: 'roughness' }
  if (['m', 'metal', 'metallic', 'metalness'].includes(s)) return { role: 'metallic' }
  if (['ao', 'o', 'occlusion'].includes(s)) return { role: 'occlusion' }
  if (['e', 'emissive', 'emission', 'glow'].includes(s)) return { role: 'emission' }
  return null
}

const IGNORED_SCALAR = /paint|logo|detail|rim|fresnel|cutout|blend|offset|scale|tiling|pos/

function scalar(desc: UnrealMaterialDescription, test: (n: string) => boolean): number | undefined {
  return desc.scalars.find((s) => !IGNORED_SCALAR.test(flat(s.name)) && test(flat(s.name)))?.value
}

const TINT_NAMES = ['basecolor', 'basecolortint', 'color', 'colour', 'tint', 'albedo', 'albedotint', 'diffusecolor', 'colortint']
const NOT_A_TINT = /emiss|logo|detail|rim|fresnel|subsurface|sss|fog|offset/

function tint(desc: UnrealMaterialDescription): number[] {
  const exact = desc.vectors.find((v) => TINT_NAMES.includes(flat(v.name)))
  const loose = desc.vectors.find((v) => /(tint|colou?r)$/.test(flat(v.name)) && !NOT_A_TINT.test(flat(v.name)))
  const found = exact ?? loose
  return found ? found.value.map((c) => Math.max(0, Math.min(1, c))) : [1, 1, 1, 1]
}

function unityBlend(blend: string): UnityMaterialSpec['blend'] {
  if (blend === 'masked') return 'masked'
  if (blend === 'additive') return 'additive'
  if (blend === 'opaque') return 'opaque'
  return 'transparent' // translucent, modulate, alphacomposite, alphaholdout
}

/** "/Game/Props/T_Crate_D" -> "Props/T_Crate_D"; engine content can't be transferred. */
const contentPath = (pkg: string): string => (pkg.startsWith('/Game/') ? pkg.slice('/Game/'.length) : '')

export function toUnitySpec(path: string, desc: UnrealMaterialDescription): UnityMaterialSpec {
  const spec: UnityMaterialSpec = {
    name: path.split('/').pop() ?? path,
    path,
    blend: unityBlend(desc.blend),
    twoSided: desc.twoSided,
    cutoff: desc.cutoff > 0 ? desc.cutoff : 0.3333,
    baseMap: '',
    normalMap: '',
    emissionMap: '',
    metallicMap: '',
    metallicChannel: -1,
    occlusionMap: '',
    occlusionChannel: -1,
    roughnessMap: '',
    roughnessChannel: -1,
    tint: tint(desc),
    metallic: scalar(desc, (n) => /^(metallic|metalness|metal)$/.test(n)) ?? 0,
    roughness: scalar(desc, (n) => /^roughness$|^rough$/.test(n)) ?? 0.5,
    emission: 1
  }

  // Parameters before graph-wired textures: the author named those on purpose.
  const ordered = [...desc.textures].sort((a, b) => Number(!a.param) - Number(!b.param))
  for (const tex of ordered) {
    const path = contentPath(tex.path)
    if (!path) continue
    const found = fromParam(tex.param) ?? fromTextureName(path)
    if (found) assign(spec, found, path)
  }

  const strength = scalar(desc, (n) => /emiss|emission/.test(n) && /power|intensity|strength|brightness|multiplier/.test(n))
  if (strength !== undefined && strength > 0) spec.emission = strength
  return spec
}

function assign(spec: UnityMaterialSpec, found: Classified, path: string): void {
  if (found.role === 'base' && !spec.baseMap) spec.baseMap = path
  else if (found.role === 'normal' && !spec.normalMap) spec.normalMap = path
  else if (found.role === 'emission' && !spec.emissionMap) spec.emissionMap = path
  else if (found.role === 'packed' && found.channels && !spec.metallicMap && !spec.roughnessMap) {
    spec.metallicMap = path
    spec.metallicChannel = found.channels.metallic
    spec.roughnessMap = path
    spec.roughnessChannel = found.channels.roughness
    spec.occlusionMap = path
    spec.occlusionChannel = found.channels.occlusion
  } else if (found.role === 'metallic' && !spec.metallicMap) {
    spec.metallicMap = path
    spec.metallicChannel = 0
  } else if (found.role === 'roughness' && !spec.roughnessMap) {
    spec.roughnessMap = path
    spec.roughnessChannel = 0
  } else if (found.role === 'occlusion' && !spec.occlusionMap) {
    spec.occlusionMap = path
    spec.occlusionChannel = 0
  }
}
