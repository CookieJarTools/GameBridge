import type { AssetStore } from './types'

/**
 * Asset marketplaces. Fab, Unity Asset Store, Sketchfab and itch.io are shown as
 * embedded web views. Poly Haven, Kenney and OpenGameArt are free/CC0 sources.
 * None of the big stores expose a public catalog API, so we embed the storefront.
 */
export const ASSET_STORES: AssetStore[] = [
  {
    id: 'fab',
    name: 'Fab',
    kind: 'webview',
    url: 'https://www.fab.com/',
    blurb: "Epic's unified marketplace — replaced the UE Marketplace, Sketchfab & Quixel. Cross-engine.",
    engines: ['unreal', 'unity', 'custom']
  },
  {
    id: 'unity-asset-store',
    name: 'Unity Asset Store',
    kind: 'webview',
    url: 'https://assetstore.unity.com/',
    blurb: 'The official Unity Asset Store.',
    engines: ['unity']
  },
  {
    id: 'sketchfab',
    name: 'Sketchfab',
    kind: 'webview',
    url: 'https://sketchfab.com/store',
    blurb: '3D model marketplace (now part of Epic/Fab).',
    engines: ['unity', 'unreal', 'custom']
  },
  {
    id: 'itch',
    name: 'itch.io',
    kind: 'webview',
    url: 'https://itch.io/game-assets',
    blurb: 'Indie game assets, tools and packs. Has a real public API.',
    engines: ['unity', 'unreal', 'custom']
  },
  {
    id: 'polyhaven',
    name: 'Poly Haven',
    kind: 'webview',
    url: 'https://polyhaven.com/',
    blurb: 'Free CC0 HDRIs, textures and models. Public API available.',
    engines: ['unity', 'unreal', 'custom']
  },
  {
    id: 'kenney',
    name: 'Kenney',
    kind: 'webview',
    url: 'https://kenney.nl/assets',
    blurb: 'Free game assets (CC0), great for prototyping.',
    engines: ['unity', 'unreal', 'custom']
  },
  {
    id: 'opengameart',
    name: 'OpenGameArt',
    kind: 'webview',
    url: 'https://opengameart.org/',
    blurb: 'Community library of free game art.',
    engines: ['unity', 'unreal', 'custom']
  }
]
