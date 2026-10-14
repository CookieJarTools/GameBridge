import { useMemo } from 'react'
import type { Engine } from '@shared/types'
import { allEngines, findEngine } from '@shared/engines'
import { useStore } from '../store'

/** Built-in + user-defined engines from the current settings. */
export function useEngines(): Engine[] {
  const userEngines = useStore((s) => s.settings?.engines ?? [])
  return useMemo(() => allEngines(userEngines), [userEngines])
}

export function useEngine(engineId: string): Engine | undefined {
  const userEngines = useStore((s) => s.settings?.engines ?? [])
  return useMemo(() => findEngine(userEngines, engineId), [userEngines, engineId])
}

export function timeAgo(ts?: number): string {
  if (!ts) return 'Never opened'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'Just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
