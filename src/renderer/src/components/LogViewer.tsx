import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Clock,
  Copy,
  Info,
  Regex,
  Search,
  Terminal,
  WrapText,
  X,
  XCircle
} from 'lucide-react'
import {
  buildMatcher,
  entryText,
  matches,
  parseLog,
  tokenize,
  type LogEntry,
  type LogLevel,
  type SourceLine,
  type Token
} from '../lib/logParse'

export type LogMode = 'pretty' | 'compact' | 'raw'

/** Rows beyond this are hidden behind a "show all" button to keep the DOM sane. */
const RENDER_CAP = 600

/* ------------------------------------------------------------ level styling */

interface LevelStyle {
  label: string
  /** Row background + left rule. */
  row: string
  icon: JSX.Element
  text: string
  chip: string
}

const ICON = 12

const LEVELS: Record<LogLevel, LevelStyle> = {
  error: {
    label: 'Errors',
    row: 'bg-danger/[0.06] border-l-danger',
    icon: <XCircle size={ICON} className="text-danger" />,
    text: 'text-[#f7c9cb]',
    chip: 'border-danger/30 bg-danger/10 text-danger'
  },
  warn: {
    label: 'Warnings',
    row: 'bg-warn/[0.05] border-l-warn',
    icon: <AlertTriangle size={ICON} className="text-warn" />,
    text: 'text-[#f6e6b4]',
    chip: 'border-warn/30 bg-warn/10 text-warn'
  },
  success: {
    label: 'Success',
    row: 'bg-ok/[0.05] border-l-ok/70',
    icon: <CheckCircle2 size={ICON} className="text-ok" />,
    text: 'text-[#cceec4]',
    chip: 'border-ok/30 bg-ok/10 text-ok'
  },
  info: {
    label: 'Info',
    row: 'border-l-transparent',
    icon: <Info size={ICON} className="text-fg-faint" />,
    text: 'text-fg-muted',
    chip: 'border-line bg-bg-soft text-fg-subtle'
  },
  debug: {
    label: 'Debug',
    row: 'border-l-transparent',
    icon: <Bug size={ICON} className="text-fg-faint/60" />,
    text: 'text-fg-subtle',
    chip: 'border-line bg-bg-soft text-fg-faint'
  },
  system: {
    label: 'System',
    row: 'bg-accent/[0.07] border-l-accent',
    icon: <Terminal size={ICON} className="text-accent" />,
    text: 'text-accent',
    chip: 'border-accent/30 bg-accent/10 text-accent'
  }
}

const TOKEN_CLASS: Record<Token['k'], string> = {
  text: '',
  url: 'text-info underline decoration-info/40',
  path: 'text-[#7fd1a8]',
  str: 'text-[#e6c07b]',
  num: 'text-[#e8a06a]',
  addr: 'text-[#c49bdd]',
  ns: 'text-fg-subtle',
  class: 'text-[#79b8ff]',
  method: 'text-[#a99bf0]',
  key: 'text-fg-muted',
  punct: 'text-fg-faint'
}

/** Filter chips, in the order they appear in the toolbar. */
const CHIP_ORDER: LogLevel[] = ['error', 'warn', 'info', 'debug']

/* ------------------------------------------------------------------- prefs */

function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('gb.log.' + key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        try {
          localStorage.setItem('gb.log.' + key, JSON.stringify(next))
        } catch {
          /* private mode / quota — prefs just won't stick */
        }
        return next
      })
    },
    [key]
  )
  return [value, set]
}

/* -------------------------------------------------------------- rendering */

/** Split text on search hits so they can be marked up. */
function highlight(text: string, re: RegExp | null, active: boolean): React.ReactNode {
  if (!re) return text
  re.lastIndex = 0
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <mark
        key={n++}
        className={
          active ? 'rounded-sm bg-warn text-black' : 'rounded-sm bg-warn/25 text-[#f6e6b4]'
        }
      >
        {m[0]}
      </mark>
    )
    last = m.index + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Colored({
  text,
  re,
  active,
  plain
}: {
  text: string
  re: RegExp | null
  active: boolean
  plain?: boolean
}): JSX.Element {
  if (plain) return <>{highlight(text, re, active)}</>
  return (
    <>
      {tokenize(text).map((t, i) => (
        <span key={i} className={TOKEN_CLASS[t.k]}>
          {highlight(t.v, re, active)}
        </span>
      ))}
    </>
  )
}

interface RowProps {
  entry: LogEntry
  /** Consecutive duplicates folded into this row (compact mode). */
  count: number
  mode: LogMode
  wrap: boolean
  showTime: boolean
  re: RegExp | null
  activeMatch: boolean
  expanded: boolean
  onToggle: (index: number) => void
}

const LogRow = memo(function LogRow({
  entry,
  count,
  mode,
  wrap,
  showTime,
  re,
  activeMatch,
  expanded,
  onToggle
}: RowProps): JSX.Element {
  const s = LEVELS[entry.level]
  const raw = mode === 'raw'
  const hasStack = entry.stack.length > 0
  const body = raw ? entry.raw : entry.message

  return (
    <div
      data-log-index={entry.index}
      className={`group border-l-2 ${s.row} ${
        activeMatch ? 'ring-1 ring-inset ring-warn/60' : ''
      } hover:bg-white/[0.02]`}
    >
      <div className="flex items-start gap-2 pl-1.5 pr-3 py-[1px]">
        {/* Fold control / severity marker */}
        <button
          onClick={() => hasStack && onToggle(entry.index)}
          className={`mt-[3px] shrink-0 ${hasStack ? 'text-fg-subtle hover:text-fg' : 'cursor-default'}`}
          title={hasStack ? (expanded ? 'Collapse trace' : 'Expand trace') : undefined}
          tabIndex={hasStack ? 0 : -1}
        >
          {hasStack ? (
            expanded ? (
              <ChevronDown size={ICON} />
            ) : (
              <ChevronRight size={ICON} />
            )
          ) : (
            s.icon
          )}
        </button>

        {hasStack && <span className="mt-[3px] shrink-0">{s.icon}</span>}

        {mode !== 'compact' && (
          <span className="mt-[1px] w-10 shrink-0 select-none text-right tabular-nums text-fg-faint/60">
            {entry.index + 1}
          </span>
        )}

        {/* Raw keeps the timestamp inside the line, so no gutter for it there. */}
        {showTime && mode === 'pretty' && entry.time && (
          <span className="mt-[1px] shrink-0 tabular-nums text-fg-faint">{entry.time}</span>
        )}

        {!raw && entry.category && (
          <span className="mt-[1px] max-w-[10rem] shrink-0 truncate text-[#79b8ff]/70">
            {entry.category}
          </span>
        )}

        <span
          className={`min-w-0 flex-1 ${s.text} ${
            wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
          }`}
        >
          <Colored text={body} re={re} active={activeMatch} plain={raw} />
        </span>

        {count > 1 && (
          <span className="mt-[1px] shrink-0 rounded-full bg-bg-hover px-1.5 text-2xs text-fg-muted">
            ×{count}
          </span>
        )}

        {hasStack && !expanded && (
          <button
            onClick={() => onToggle(entry.index)}
            className="mt-[1px] shrink-0 rounded-full border border-line bg-bg-soft px-1.5 text-2xs text-fg-subtle hover:text-fg"
          >
            {entry.stack.length} frame{entry.stack.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {hasStack && expanded && (
        <div className="mb-1 ml-6 mr-3 rounded-md border border-line bg-black/40 px-2 py-1">
          {entry.stack.map((f, i) => (
            <div
              key={i}
              className={`text-fg-subtle ${
                wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
              }`}
            >
              <Colored text={f} re={re} active={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

/* ------------------------------------------------------------------ viewer */

interface Row {
  entry: LogEntry
  count: number
}

export function LogViewer({ lines }: { lines: SourceLine[] }): JSX.Element {
  const [mode, setMode] = usePref<LogMode>('mode', 'pretty')
  const [hidden, setHidden] = usePref<LogLevel[]>('hidden', [])
  const [wrap, setWrap] = usePref<boolean>('wrap', true)
  const [showTime, setShowTime] = usePref<boolean>('time', true)
  const [useRegex, setUseRegex] = usePref<boolean>('regex', false)

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [follow, setFollow] = useState(true)
  const [matchIdx, setMatchIdx] = useState(0)
  const [copied, setCopied] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const entries = useMemo(() => parseLog(lines), [lines])

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = {
      error: 0,
      warn: 0,
      success: 0,
      info: 0,
      debug: 0,
      system: 0
    }
    for (const e of entries) c[e.level]++
    return c
  }, [entries])

  const re = useMemo(() => buildMatcher(query, useRegex, false), [query, useRegex])
  const regexInvalid = useRegex && query.trim().length > 0 && re === null

  /** Level filtering only — search navigation needs these even when not filtering. */
  const levelled = useMemo(() => {
    if (!hidden.length) return entries
    const drop = new Set(hidden)
    // "Info" also covers success + system, so those hide with it.
    return entries.filter((e) => {
      const bucket: LogLevel =
        e.level === 'success' || e.level === 'system' ? 'info' : (e.level as LogLevel)
      return !drop.has(bucket)
    })
  }, [entries, hidden])

  const matched = useMemo(
    () => (re ? levelled.filter((e) => matches(e, re)) : []),
    [levelled, re]
  )

  const rows: Row[] = useMemo(() => {
    const base = re ? matched : levelled
    if (mode !== 'compact') return base.map((entry) => ({ entry, count: 1 }))
    const out: Row[] = []
    for (const entry of base) {
      const prev = out[out.length - 1]
      if (prev && prev.entry.level === entry.level && prev.entry.message === entry.message) {
        prev.count++
        continue
      }
      out.push({ entry, count: 1 })
    }
    return out
  }, [levelled, matched, re, mode])

  const capped = showAll || rows.length <= RENDER_CAP
  const visible = capped ? rows : rows.slice(-RENDER_CAP)

  const activeMatchIndex = matched.length ? matched[matchIdx % matched.length]?.index : -1

  /* Follow the tail unless the user has scrolled away from it. */
  useEffect(() => {
    if (!follow) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible.length, follow, mode, wrap])

  useEffect(() => setMatchIdx(0), [query, useRegex])

  const jumpTo = useCallback((index: number) => {
    setFollow(false)
    const el = scrollRef.current?.querySelector(`[data-log-index="${index}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [])

  const step = useCallback(
    (delta: number) => {
      if (!matched.length) return
      const next = (matchIdx + delta + matched.length) % matched.length
      setMatchIdx(next)
      jumpTo(matched[next].index)
    },
    [matched, matchIdx, jumpTo]
  )

  const stepError = useCallback(
    (delta: number) => {
      const errs = levelled.filter((e) => e.level === 'error')
      if (!errs.length) return
      const el = scrollRef.current
      const mid = el ? el.scrollTop + el.clientHeight / 2 : 0
      // Pick the error nearest the current viewport, then walk from there.
      let cur = 0
      for (let i = 0; i < errs.length; i++) {
        const node = el?.querySelector(`[data-log-index="${errs[i].index}"]`) as HTMLElement | null
        if (node && node.offsetTop <= mid) cur = i
      }
      const next = Math.min(Math.max(cur + delta, 0), errs.length - 1)
      jumpTo(errs[next].index)
    },
    [levelled, jumpTo]
  )

  const toggleLevel = useCallback(
    (l: LogLevel) => setHidden((h) => (h.includes(l) ? h.filter((x) => x !== l) : [...h, l])),
    [setHidden]
  )

  const toggleRow = useCallback((index: number) => {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleAllFolds = useCallback(() => {
    setExpandAll((v) => !v)
    setExpanded(new Set())
  }, [])

  const copyVisible = useCallback(() => {
    const text = visible.map((r) => entryText(r.entry)).join('\n')
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined
    )
  }, [visible])

  /* Ctrl/Cmd+F focuses the search box, like every other log tool. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])

  const toolBtn = (on: boolean): string =>
    `flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
      on ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:bg-bg-hover hover:text-fg'
    }`

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-sm">
        {/* Mode */}
        <div className="flex rounded-md border border-line bg-bg-soft p-0.5">
          {(['pretty', 'compact', 'raw'] as LogMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`h-5 rounded px-2 capitalize transition-colors ${
                mode === m ? 'bg-bg-active text-fg' : 'text-fg-subtle hover:text-fg-muted'
              }`}
              title={
                m === 'pretty'
                  ? 'Parsed — severities, folded traces, coloured symbols'
                  : m === 'compact'
                    ? 'Parsed, repeated lines folded into a counter'
                    : 'Exactly what the process wrote'
              }
            >
              {m}
            </button>
          ))}
        </div>

        {/* Level filters */}
        <div className="flex items-center gap-1">
          {CHIP_ORDER.map((l) => {
            const off = hidden.includes(l)
            const n = l === 'info' ? counts.info + counts.success + counts.system : counts[l]
            return (
              <button
                key={l}
                onClick={() => toggleLevel(l)}
                className={`flex h-6 items-center gap-1.5 rounded-md border px-1.5 transition-colors ${
                  off ? 'border-line bg-transparent text-fg-faint/60' : LEVELS[l].chip
                }`}
                title={off ? `Show ${LEVELS[l].label.toLowerCase()}` : `Hide ${LEVELS[l].label.toLowerCase()}`}
              >
                <span className={off ? 'opacity-40' : ''}>{LEVELS[l].icon}</span>
                <span className="tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div
          className={`flex h-6 min-w-[13rem] max-w-md flex-1 items-center gap-1.5 rounded-md border bg-bg-soft px-2 ${
            regexInvalid ? 'border-danger/60' : 'border-line focus-within:border-accent/60'
          }`}
        >
          <Search size={12} className="shrink-0 text-fg-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Filter lines…  (Ctrl+F)"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          />
          {query && (
            <>
              <span className="shrink-0 tabular-nums text-fg-subtle">
                {matched.length ? `${(matchIdx % matched.length) + 1}/${matched.length}` : '0'}
              </span>
              <button
                onClick={() => step(-1)}
                className="shrink-0 text-fg-faint hover:text-fg"
                title="Previous match (Shift+Enter)"
              >
                <ChevronDown size={13} className="rotate-180" />
              </button>
              <button
                onClick={() => step(1)}
                className="shrink-0 text-fg-faint hover:text-fg"
                title="Next match (Enter)"
              >
                <ChevronDown size={13} />
              </button>
              <button
                onClick={() => setQuery('')}
                className="shrink-0 text-fg-faint hover:text-fg"
                title="Clear"
              >
                <X size={13} />
              </button>
            </>
          )}
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={`shrink-0 rounded px-1 ${useRegex ? 'text-accent' : 'text-fg-faint hover:text-fg-muted'}`}
            title="Regular expression"
          >
            <Regex size={13} />
          </button>
        </div>

        {/* View toggles */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => stepError(-1)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-hover hover:text-danger"
            title="Previous error"
          >
            <ArrowDown size={13} className="rotate-180" />
          </button>
          <button
            onClick={() => stepError(1)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-hover hover:text-danger"
            title="Next error"
          >
            <ArrowDown size={13} />
          </button>
          <button onClick={toggleAllFolds} className={toolBtn(expandAll)} title="Expand all traces">
            <ChevronsDownUp size={13} />
          </button>
          <button
            onClick={() => setShowTime(!showTime)}
            className={toolBtn(showTime)}
            title="Show timestamps"
          >
            <Clock size={13} />
          </button>
          <button onClick={() => setWrap(!wrap)} className={toolBtn(wrap)} title="Wrap long lines">
            <WrapText size={13} />
          </button>
          <button
            onClick={copyVisible}
            className={toolBtn(copied)}
            title="Copy the lines currently shown"
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      {/* Log body */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto bg-bg py-1.5 font-mono text-[11.5px] leading-[1.6]"
        >
          {!capped && (
            <button
              onClick={() => setShowAll(true)}
              className="mx-3 mb-1.5 w-[calc(100%-1.5rem)] rounded-md border border-line bg-bg-soft py-1 text-fg-subtle hover:text-fg"
            >
              Showing the last {RENDER_CAP} of {rows.length} lines — load all
            </button>
          )}

          {rows.length === 0 ? (
            <p className="px-4 py-3 text-fg-subtle">
              {entries.length === 0
                ? '(no stdout/stderr — this game may not write to the console; the exit code will still appear here when it closes)'
                : 'No lines match the current filters.'}
            </p>
          ) : (
            visible.map((r) => (
              <LogRow
                key={r.entry.index}
                entry={r.entry}
                count={r.count}
                mode={mode}
                wrap={wrap}
                showTime={showTime}
                re={re}
                activeMatch={r.entry.index === activeMatchIndex}
                expanded={expandAll !== expanded.has(r.entry.index)}
                onToggle={toggleRow}
              />
            ))
          )}
        </div>

        {!follow && (
          <button
            onClick={() => setFollow(true)}
            className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full border border-line bg-bg-panel px-3 py-1.5 text-xs text-fg-muted shadow-panel hover:text-fg"
          >
            <ArrowDown size={12} /> Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}
