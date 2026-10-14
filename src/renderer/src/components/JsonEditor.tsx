import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CornerDownLeft,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import {
  KIND_LABEL,
  blankOf,
  getAt,
  humanise,
  kindOf,
  moveItem,
  preview,
  removeAt,
  renameKey,
  setAt,
  summarise,
  uniqueKey,
  type JsonKind,
  type JsonPath
} from '../lib/jsonModel'

interface Props {
  value: unknown
  onChange: (next: unknown) => void
  /** Structure edits (add, rename, delete, change type) are opt-in. */
  structure: boolean
  path: JsonPath
  onNavigate: (path: JsonPath) => void
}

const KIND_CHIP: Record<JsonKind, string> = {
  text: 'border-line bg-bg-soft text-fg-subtle',
  number: 'border-info/30 bg-info/10 text-info',
  switch: 'border-ok/30 bg-ok/10 text-ok',
  group: 'border-accent/30 bg-accent/10 text-accent',
  list: 'border-warn/30 bg-warn/10 text-warn',
  empty: 'border-line bg-bg-soft text-fg-faint'
}

/** The fields of whatever object or list the breadcrumb is currently on. */
export function JsonEditor({ value, onChange, structure, path, onNavigate }: Props): JSX.Element {
  const [filter, setFilter] = useState('')
  const current = getAt(value, path)
  const isList = Array.isArray(current)
  const isGroup = !isList && !!current && typeof current === 'object'

  const entries = useMemo(() => {
    if (isList) {
      return (current as unknown[]).map((item, i) => ({ key: String(i), value: item }))
    }
    if (isGroup) {
      return Object.entries(current as Record<string, unknown>).map(([key, v]) => ({
        key,
        value: v
      }))
    }
    return []
  }, [current, isList, isGroup])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        humanise(e.key).toLowerCase().includes(q) ||
        preview(e.value, 200).toLowerCase().includes(q)
    )
  }, [entries, filter])

  if (!isList && !isGroup) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-base text-fg-muted">
        This file holds a single {KIND_LABEL[kindOf(current)].toLowerCase()} value, not a set of
        fields. Use the Text view to edit it.
      </div>
    )
  }

  const set = (key: string | number, next: unknown): void =>
    onChange(setAt(value, [...path, key], next))

  const addField = (): void => {
    if (isList) {
      const list = current as unknown[]
      // New items copy the shape of the last one, so a list of monsters gets
      // another monster rather than an empty box.
      const template = list.length ? blankLike(list[list.length - 1]) : ''
      onChange(setAt(value, path, [...list, template]))
      return
    }
    const record = current as Record<string, unknown>
    onChange(setAt(value, [...path, uniqueKey(record)], ''))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {entries.length > 8 && (
        <div className="shrink-0 px-4 pt-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Search ${entries.length} ${isList ? 'items' : 'fields'}…`}
              className="input h-7 pl-8"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-base text-fg-muted">
            {entries.length === 0
              ? isList
                ? 'This list is empty.'
                : 'This group has no fields yet.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {shown.map((entry) => (
              <FieldRow
                key={entry.key}
                name={entry.key}
                value={entry.value}
                isListItem={isList}
                structure={structure}
                onValue={(next) => set(isList ? Number(entry.key) : entry.key, next)}
                onOpen={() => onNavigate([...path, isList ? Number(entry.key) : entry.key])}
                onRename={(next) => onChange(renameKey(value, [...path, entry.key], next))}
                onDelete={() =>
                  onChange(removeAt(value, [...path, isList ? Number(entry.key) : entry.key]))
                }
                onRetype={(kind) => set(isList ? Number(entry.key) : entry.key, blankOf(kind))}
                onMove={(delta) =>
                  onChange(moveItem(value, path, Number(entry.key), Number(entry.key) + delta))
                }
                canMoveUp={isList && Number(entry.key) > 0}
                canMoveDown={isList && Number(entry.key) < entries.length - 1}
              />
            ))}
          </div>
        )}

        {structure && (
          <button onClick={addField} className="btn-secondary mt-2">
            <Plus size={13} /> {isList ? 'Add item' : 'Add field'}
          </button>
        )}
      </div>
    </div>
  )
}

/** A blank value shaped like an existing one, for adding to a list. */
function blankLike(sample: unknown): unknown {
  if (Array.isArray(sample)) return []
  if (sample && typeof sample === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(sample as Record<string, unknown>)) {
      out[k] = blankOf(kindOf(v))
    }
    return out
  }
  return blankOf(kindOf(sample))
}

interface RowProps {
  name: string
  value: unknown
  isListItem: boolean
  structure: boolean
  onValue: (next: unknown) => void
  onOpen: () => void
  onRename: (next: string) => void
  onDelete: () => void
  onRetype: (kind: JsonKind) => void
  onMove: (delta: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
}

function FieldRow({
  name,
  value,
  isListItem,
  structure,
  onValue,
  onOpen,
  onRename,
  onDelete,
  onRetype,
  onMove,
  canMoveUp,
  canMoveDown
}: RowProps): JSX.Element {
  const kind = kindOf(value)
  const nested = kind === 'group' || kind === 'list'
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(name)

  return (
    <div className="group flex items-start gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-bg-hover/50">
      {/* Name */}
      <div className="w-[220px] shrink-0 pt-1">
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (draftName && draftName !== name) onRename(draftName)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraftName(name)
                setRenaming(false)
              }
            }}
            className="input h-7"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-base font-medium text-fg" title={name}>
                {isListItem ? `Item ${Number(name) + 1}` : humanise(name)}
              </span>
              {structure && !isListItem && (
                <button
                  onClick={() => {
                    setDraftName(name)
                    setRenaming(true)
                  }}
                  className="shrink-0 text-2xs text-fg-faint transition-colors hover:text-fg"
                  title="Rename this field"
                >
                  rename
                </button>
              )}
            </div>
            {!isListItem && (
              <div className="truncate font-mono text-2xs text-fg-faint" title={name}>
                {name}
              </div>
            )}
          </>
        )}
      </div>

      {/* Type */}
      <span className={`chip mt-1 shrink-0 ${KIND_CHIP[kind]}`}>{KIND_LABEL[kind]}</span>

      {/* Value */}
      <div className="min-w-0 flex-1">
        {nested ? (
          <button
            onClick={onOpen}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-base text-fg-muted hover:bg-bg-active hover:text-fg"
          >
            <span className="min-w-0 flex-1 truncate">{summarise(value)}</span>
            <span className="shrink-0 text-2xs text-fg-faint">open</span>
            <ChevronRight size={13} className="shrink-0" />
          </button>
        ) : (
          <ValueInput kind={kind} value={value} onChange={onValue} />
        )}
      </div>

      {/* Structure actions */}
      {structure && (
        <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
          {isListItem && (
            <>
              <button
                onClick={() => onMove(-1)}
                disabled={!canMoveUp}
                className="btn-icon h-6 w-6 disabled:opacity-20"
                title="Move up"
              >
                <ArrowUp size={12} />
              </button>
              <button
                onClick={() => onMove(1)}
                disabled={!canMoveDown}
                className="btn-icon h-6 w-6 disabled:opacity-20"
                title="Move down"
              >
                <ArrowDown size={12} />
              </button>
            </>
          )}
          <select
            value={kind}
            onChange={(e) => onRetype(e.target.value as JsonKind)}
            className="h-6 rounded border border-line bg-bg-soft px-1 text-2xs text-fg-subtle"
            title="Change what kind of value this is"
          >
            {(Object.keys(KIND_LABEL) as JsonKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button onClick={onDelete} className="icon-btn h-6 w-6" title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

/** The right control for the value's type — never a raw JSON box. */
function ValueInput({
  kind,
  value,
  onChange
}: {
  kind: JsonKind
  value: unknown
  onChange: (next: unknown) => void
}): JSX.Element {
  if (kind === 'switch') {
    const on = value === true
    return (
      <button
        onClick={() => onChange(!on)}
        className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
          on ? 'bg-ok/80' : 'bg-bg-active'
        }`}
        title={on ? 'Yes' : 'No'}
      >
        <span
          className={`h-5 w-5 rounded-full bg-fg transition-transform ${on ? 'translate-x-5' : ''}`}
        />
      </button>
    )
  }

  if (kind === 'number') {
    return (
      <input
        type="number"
        value={Number(value)}
        onChange={(e) => {
          const next = e.target.value === '' ? 0 : Number(e.target.value)
          if (!Number.isNaN(next)) onChange(next)
        }}
        className="input h-7 max-w-[200px] tabular-nums"
      />
    )
  }

  if (kind === 'empty') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-base text-fg-faint">Nothing set</span>
        <button onClick={() => onChange('')} className="btn-ghost h-6">
          <CornerDownLeft size={12} /> Give it a value
        </button>
      </div>
    )
  }

  const text = String(value ?? '')
  // Long or multi-line text gets room to breathe rather than a one-line box.
  if (text.includes('\n') || text.length > 80) {
    return (
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, text.split('\n').length + 1)}
        className="input resize-y font-normal"
      />
    )
  }
  return <input value={text} onChange={(e) => onChange(e.target.value)} className="input h-7" />
}
