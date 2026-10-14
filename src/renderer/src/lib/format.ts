/** Shared number/size formatting for the build and asset panels. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function bytes(n: number | undefined): string {
  if (!n || n < 0) return '0 B'
  let value = n
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`
}

export function duration(seconds: number | undefined): string {
  if (!seconds || seconds < 0) return '0s'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Deterministic colour per category, so the same type keeps its colour. */
const CATEGORY_COLORS = [
  '#6d8bff',
  '#2dd4bf',
  '#f472b6',
  '#facc15',
  '#38bdf8',
  '#a3e635',
  '#fb7185',
  '#c084fc',
  '#fb923c',
  '#94a3b8'
]

export function categoryColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length]
}
