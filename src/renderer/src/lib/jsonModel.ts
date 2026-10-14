/**
 * The shape of a JSON value, described in words a non-programmer can act on.
 *
 * The editor never shows "object" or "boolean" — it shows Group and Yes/No —
 * but the underlying JSON types are exactly preserved, because the game reading
 * the file very much does care about the difference between 3 and "3".
 */

export type JsonKind = 'text' | 'number' | 'switch' | 'group' | 'list' | 'empty'

/** Where a value sits in the document: [] is the root, then keys and indexes. */
export type JsonPath = (string | number)[]

export const KIND_LABEL: Record<JsonKind, string> = {
  text: 'Text',
  number: 'Number',
  switch: 'Yes / No',
  group: 'Group',
  list: 'List',
  empty: 'Empty'
}

export function kindOf(value: unknown): JsonKind {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return 'list'
  switch (typeof value) {
    case 'boolean':
      return 'switch'
    case 'number':
      return 'number'
    case 'object':
      return 'group'
    default:
      return 'text'
  }
}

/** A blank value of each kind, for adding fields and changing types. */
export function blankOf(kind: JsonKind): unknown {
  switch (kind) {
    case 'text':
      return ''
    case 'number':
      return 0
    case 'switch':
      return false
    case 'group':
      return {}
    case 'list':
      return []
    default:
      return null
  }
}

/**
 * Turn a field name into something readable: `maxHealthPoints` → `Max health
 * points`, `enemy_spawn_rate` → `Enemy spawn rate`. The raw name is still shown
 * next to it, because that is what the game actually looks for.
 */
export function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // maxHealth -> max Health
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer -> HTTP Server
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return key

  // Lower-case ordinary words so it reads as a sentence, but leave anything
  // that is all capitals alone — "playerHP" should stay "Player HP".
  return spaced
    .split(' ')
    .map((word, i) => {
      if (word.length > 1 && word === word.toUpperCase()) return word
      const lower = word.toLowerCase()
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

/**
 * Fields worth using as the title of a row, most human-readable first — a
 * display name beats an internal id for someone scanning a list.
 */
const TITLE_KEYS = ['displayName', 'name', 'title', 'label', 'id', 'key', 'type']

/**
 * One line describing a group or list, so a row means something before you
 * open it — "Goblin · 4 fields" beats "Object".
 */
export function summarise(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const titleKey = TITLE_KEYS.find(
      (k) => typeof record[k] === 'string' || typeof record[k] === 'number'
    )
    const count = Object.keys(record).length
    const fields = `${count} field${count === 1 ? '' : 's'}`
    return titleKey ? `${String(record[titleKey])} · ${fields}` : fields
  }
  return ''
}

/** Short preview of any value, for collapsed rows and search. */
export function preview(value: unknown, max = 60): string {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) + '…' : value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  return summarise(value)
}

/* ------------------------------------------------------------ path access */

export function getAt(root: unknown, path: JsonPath): unknown {
  let current = root
  for (const step of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[step]
  }
  return current
}

/** Copy a container one level, so edits never mutate what React is rendering. */
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (value && typeof value === 'object') return { ...(value as object) }
  return value
}

/** Immutably replace the value at `path`. */
export function setAt(root: unknown, path: JsonPath, next: unknown): unknown {
  if (path.length === 0) return next
  const copy = clone(root) as Record<string | number, unknown>
  const [head, ...rest] = path
  copy[head] = rest.length ? setAt(copy[head], rest, next) : next
  return copy
}

/** Immutably remove a key or index. */
export function removeAt(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return root
  const parentPath = path.slice(0, -1)
  const last = path[path.length - 1]
  const parent = getAt(root, parentPath)

  if (Array.isArray(parent)) {
    const next = parent.filter((_, i) => i !== Number(last))
    return setAt(root, parentPath, next)
  }
  if (parent && typeof parent === 'object') {
    const next = { ...(parent as Record<string, unknown>) }
    delete next[String(last)]
    return setAt(root, parentPath, next)
  }
  return root
}

/**
 * Rename a key, keeping its position — rebuilding the object in order rather
 * than deleting and re-adding, which would move the field to the end.
 */
export function renameKey(root: unknown, path: JsonPath, nextKey: string): unknown {
  const parentPath = path.slice(0, -1)
  const oldKey = String(path[path.length - 1])
  const parent = getAt(root, parentPath)
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return root

  const entries = Object.entries(parent as Record<string, unknown>)
  const rebuilt: Record<string, unknown> = {}
  for (const [key, value] of entries) rebuilt[key === oldKey ? nextKey : key] = value
  return setAt(root, parentPath, rebuilt)
}

/** Move a list item, for reordering. */
export function moveItem(root: unknown, listPath: JsonPath, from: number, to: number): unknown {
  const list = getAt(root, listPath)
  if (!Array.isArray(list)) return root
  if (to < 0 || to >= list.length) return root
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return setAt(root, listPath, next)
}

/** A key that doesn't collide, for the "add field" button. */
export function uniqueKey(parent: Record<string, unknown>, base = 'newField'): string {
  if (!(base in parent)) return base
  let n = 2
  while (`${base}${n}` in parent) n++
  return `${base}${n}`
}

/** Serialise for saving, keeping the file's own indentation. */
export function serialise(value: unknown, indent = '  '): string {
  return JSON.stringify(value, null, indent) + '\n'
}
