import type { GameBridgeApi } from './index'

declare global {
  interface Window {
    gamebridge: GameBridgeApi
  }
}

export {}
