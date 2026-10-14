/**
 * Log parsing for the Console.
 *
 * Turns raw stdout / stderr / editor-log lines into structured entries: a
 * severity, an optional timestamp + category, and any continuation lines
 * (stack frames, native callstacks, inner exceptions) folded into the entry
 * that owns them.
 *
 * Deliberately heuristic — it has to cope with Unity editor logs, Unreal's
 * categorised format, MSBuild/compiler diagnostics and arbitrary game stdout,
 * none of which agree on anything.
 */

export type LogLevel = 'error' | 'warn' | 'success' | 'info' | 'debug' | 'system'

export interface SourceLine {
  line: string
  stream: 'out' | 'err' | 'sys'
}

export interface LogEntry {
  /** Index of the first source line — stable React key + gutter number. */
  index: number
  level: LogLevel
  stream: 'out' | 'err' | 'sys'
  /** The original, untouched first line (what Raw mode shows). */
  raw: string
  /** Message with timestamp / level / category prefix stripped. */
  message: string
  time?: string
  /** Unreal category (LogTemp), or a compiler code (CS0103, MSB3073). */
  category?: string
  /** Continuation lines belonging to this entry, collapsed by default. */
  stack: string[]
}

/* ------------------------------------------------------------------ levels */

const RE_UNREAL = /^\[(\d{4}\.\d{2}\.\d{2}-[\d.:]+)\]\[\s*\d+\]([A-Za-z_]\w*):\s*(.*)$/
const RE_UNREAL_PLAIN = /^(Log[A-Z]\w*):\s*(.*)$/
const RE_UNREAL_VERB = /^(Error|Warning|Fatal|Display|Verbose|VeryVerbose|Log):\s*(.*)$/

const RE_ISO_TIME = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?Z?)\]?[\s|-]*/
const RE_CLOCK = /^\[?(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\]?[\s|-]+/

const RE_LEVEL_TAG =
  /^\[?(ERR(?:OR)?|WARN(?:ING)?|INFO|DEBUG|TRACE|VERBOSE|FATAL|CRIT(?:ICAL)?|NOTICE|SUCCESS)\]?\s*[:|-]?\s+/i
const RE_DIAG = /\b(error|warning)\s+([A-Z]{1,5}\d{3,5})\s*:/i

/** "0 Error(s)" / "no warnings" must not turn a summary line red. */
const RE_NEGATED = /\b(?:0|no)\s+(?:error|warning)/i
const RE_COUNTED = /\b[1-9]\d*\s+(?:error|warning)/i

const RE_ERROR =
  /(?:^|[^\w])(?:errors?|failed|failure|fatal|exceptions?|critical|assert(?:ion)?\s+failed|unhandled|segmentation\s+fault|access\s+violation|null\s*reference|panic|crashed?|abort(?:ed)?|denied|refused|unable\s+to)(?:[^\w]|$)/i
/** A thrown type name, which carries no separate "error" word: `NullReferenceException: …` */
const RE_THROWN = /\w*(?:Exception|Error)\s*:/
const RE_WARN =
  /(?:^|[^\w])(?:warn(?:ings?|ed)?|deprecated|obsolete|fallback|retrying|skipped|missing)(?:[^\w]|$)/i
const RE_SUCCESS =
  /(?:^|[^\w])(?:succeeded|successful(?:ly)?|success|build\s+complete|up\s+to\s+date)(?:[^\w]|$)/i
const RE_DEBUG = /(?:^|[^\w])(?:debug|verbose|trace)(?:[^\w]|$)/i

function unrealVerbToLevel(v: string): LogLevel {
  const s = v.toLowerCase()
  if (s === 'error' || s === 'fatal') return 'error'
  if (s === 'warning') return 'warn'
  if (s === 'verbose' || s === 'veryverbose') return 'debug'
  return 'info'
}

function tagToLevel(tag: string): LogLevel {
  const s = tag.toLowerCase()
  if (s.startsWith('err') || s === 'fatal' || s.startsWith('crit')) return 'error'
  if (s.startsWith('warn')) return 'warn'
  if (s === 'debug' || s === 'trace' || s === 'verbose') return 'debug'
  if (s === 'success') return 'success'
  return 'info'
}

/**
 * Engine chatter that names a failure without one having happened. These come
 * up on nearly every Unity run and drown out the errors that matter.
 */
const RE_BENIGN =
  /Access token is unavailable|failed to query info queue|has failed validation; ignoring|Curl error \d+|Unable to listen on \d+|No Data Received|Failed to load player data from player/i

/**
 * Severity is judged on this rather than the raw line. Command lines are full
 * of words that look alarming but say nothing about what happened —
 * `--continue-on-failure` is an argument, not a failure — so flags, quoted
 * arguments and absolute paths come out first.
 */
function severityProbe(line: string): string {
  return line
    .replace(/(?:^|\s)--?[A-Za-z][\w-]*(?:=\S*)?/g, ' ') // -flag, --continue-on-failure, --x=y
    .replace(/"[^"]*"/g, ' ') // quoted arguments and paths
    .replace(/(?:[A-Za-z]:[\\/]|\/)\S+/g, ' ') // absolute paths
}

/** Last-resort severity guess from the words in the line. */
function inferLevel(text: string, stream: SourceLine['stream']): LogLevel {
  if (stream === 'sys') return 'system'
  if (RE_BENIGN.test(text)) return 'info'

  const probe = severityProbe(text)
  if (RE_THROWN.test(probe)) return 'error'
  const negated = RE_NEGATED.test(probe) && !RE_COUNTED.test(probe)
  if (!negated && RE_ERROR.test(probe)) return 'error'
  if (!negated && RE_WARN.test(probe)) return 'warn'
  if (RE_SUCCESS.test(probe)) return 'success'
  if (stream === 'err') return 'error'
  if (RE_DEBUG.test(probe)) return 'debug'
  return 'info'
}

/* ------------------------------------------------------------ stack frames */

/**
 * Lines that are part of the entry above rather than events of their own.
 * Unity does not indent its managed stack traces, hence the shape-based rules.
 */
const STACK_RULES: RegExp[] = [
  /^\s*at\s+\S/, // .NET / JS / Java
  /\(at\s+[^)]+:\d+\)\s*$/, // Unity:  Player:Update () (at Assets/Player.cs:42)
  /^\s*[\w.<>+`[\]]+:[\w<>`.]+\s*\(/, // Unity:  UnityEngine.Debug:LogError (object)
  /^\s*(?:--->|---\s+End of|Rethrow as\b)/i,
  /^\s*in\s+.+:(?:line\s+)?\d+\s*$/i,
  /^\s*\[Callstack\]/i,
  /^\s*0x[0-9A-Fa-f]{6,}/, // native addresses
  /^\s*#\d+\s+0x/, // gdb / lldb
  /^\s*\w[\w.+-]*\.(?:dll|so|dylib|exe)!/i, // module!Symbol
  /^\s*File\s+"[^"]+",\s+line\s+\d+/, // python
  /^\s*(?:UnrealEditor|UE4Editor|UnityPlayer|ntdll|KERNEL(?:BASE|32)|ucrtbase|libc)[\w.-]*[!.]/i
]

function isStackFrame(line: string): boolean {
  return STACK_RULES.some((re) => re.test(line))
}

/** Should `line` be folded into the previous entry? */
function isContinuation(line: string, prev: LogEntry): boolean {
  if (!line.trim()) return false
  if (prev.stream === 'sys') return false
  if (isStackFrame(line)) return true
  // An indented line under an error/warning, or under an already-started trace,
  // is a detail of it — but never if it carries its own timestamp/category.
  if (!/^\s{2,}\S/.test(line)) return false
  if (RE_UNREAL.test(line) || RE_ISO_TIME.test(line.trimStart())) return false
  return prev.stack.length > 0 || prev.level === 'error' || prev.level === 'warn'
}

/* ----------------------------------------------------------------- parsing */

function makeEntry(src: SourceLine, index: number): LogEntry {
  const raw = src.line
  if (src.stream === 'sys') {
    return { index, level: 'system', stream: 'sys', raw, message: raw, stack: [] }
  }

  let rest = raw
  let time: string | undefined
  let category: string | undefined
  let level: LogLevel | undefined

  // Unreal: [2024.01.01-12.00.00:000][123]LogTemp: Warning: message
  const ue = RE_UNREAL.exec(rest)
  if (ue) {
    time = ue[1]
    category = ue[2]
    rest = ue[3]
  } else {
    const iso = RE_ISO_TIME.exec(rest)
    if (iso) {
      time = iso[1]
      rest = rest.slice(iso[0].length)
    } else {
      const clock = RE_CLOCK.exec(rest)
      if (clock) {
        time = clock[1]
        rest = rest.slice(clock[0].length)
      }
    }
    const uep = RE_UNREAL_PLAIN.exec(rest)
    if (uep) {
      category = uep[1]
      rest = uep[2]
    }
  }

  // "Warning: ..." / "Error: ..." verbosity, as Unreal writes after a category.
  const verb = RE_UNREAL_VERB.exec(rest)
  if (verb && category) {
    level = unrealVerbToLevel(verb[1])
    rest = verb[2]
  }

  if (!level) {
    const tag = RE_LEVEL_TAG.exec(rest)
    if (tag) {
      level = tagToLevel(tag[1])
      rest = rest.slice(tag[0].length)
    }
  }

  // Compiler / MSBuild diagnostics carry both the severity and a code.
  const diag = RE_DIAG.exec(rest)
  if (diag) {
    level = diag[1].toLowerCase() === 'error' ? 'error' : 'warn'
    category = category ?? diag[2]
  }

  return {
    index,
    level: level ?? inferLevel(raw, src.stream),
    stream: src.stream,
    raw,
    message: rest.length ? rest : raw,
    time,
    category,
    stack: []
  }
}

/**
 * Parse the whole buffer. Append-only updates reuse the previous result, so a
 * live run only pays for the lines that actually arrived — and untouched
 * entries keep their identity, which stops memoised rows re-rendering.
 */
let cacheSource: SourceLine[] = []
let cacheEntries: LogEntry[] = []

export function parseLog(lines: SourceLine[]): LogEntry[] {
  const n = cacheSource.length
  const appended =
    n > 0 && lines.length >= n && lines[0] === cacheSource[0] && lines[n - 1] === cacheSource[n - 1]

  const entries = appended ? cacheEntries.slice() : []
  for (let i = appended ? n : 0; i < lines.length; i++) {
    const src = lines[i]
    const prev = entries[entries.length - 1]
    if (prev && isContinuation(src.line, prev)) {
      // Copy-on-write so memoised rows notice the entry changed.
      entries[entries.length - 1] = { ...prev, stack: [...prev.stack, src.line] }
      continue
    }
    entries.push(makeEntry(src, i))
  }

  cacheSource = lines
  cacheEntries = entries
  return entries
}

/* -------------------------------------------------------------- tokenising */

export type TokenKind =
  | 'text'
  | 'url'
  | 'path'
  | 'str'
  | 'num'
  | 'addr'
  | 'ns'
  | 'class'
  | 'method'
  | 'key'
  | 'punct'

export interface Token {
  k: TokenKind
  v: string
}

const TOKEN_RE = new RegExp(
  [
    '(?<url>\\bhttps?://[^\\s"\'<>)\\]]+)',
    // Any path with a separator and an extension, plus :line or (line,col).
    '(?<path>(?:[A-Za-z]:[\\\\/]|/)?(?:[\\w.$@~+%-]+[\\\\/])+[\\w.$@~+%-]+\\.[A-Za-z0-9_]{1,10}(?::\\d+(?::\\d+)?|\\(\\d+(?:,\\d+)?\\))?)',
    '(?<str>"[^"\\n]{0,400}"|\'[^\'\\n]{0,200}\')',
    '(?<addr>\\b0[xX][0-9a-fA-F]{2,}\\b)',
    // Foo.Bar.Baz / UnityEngine.Debug:LogError / Outer+Inner
    '(?<qual>[A-Za-z_][\\w`]*(?:[.:+][A-Za-z_][\\w`<>]*)+)',
    '(?<key>\\b[A-Za-z_]\\w*(?=\\s*=\\s*[^\\s=]))',
    '(?<num>\\b\\d+(?:\\.\\d+)?(?:ms|s|fps|f|%|px|[KMG]i?B)?\\b)'
  ].join('|'),
  'g'
)

/**
 * Split a qualified name into namespace / class / method parts.
 * `methodCall` is true when the match is immediately followed by "(".
 */
function qualTokens(v: string, methodCall: boolean): Token[] {
  const parts = v.split(/([.:+])/) // keeps the separators at odd indices
  const lastName = parts.length - 1
  // `Type:Method` (Unity) or a trailing "(" means the last part is a method.
  const isMethod = methodCall || parts[lastName - 1] === ':'
  const classIdx = isMethod ? lastName - 2 : lastName

  return parts.map((p, i) => {
    if (i % 2 === 1) return { k: 'punct', v: p }
    if (isMethod && i === lastName) return { k: 'method', v: p }
    if (i === classIdx && /^[A-Z_]/.test(p)) return { k: 'class', v: p }
    return { k: 'ns', v: p }
  })
}

/** Colour-code a line into spans. Cached — the same lines re-render a lot. */
const tokenCache = new Map<string, Token[]>()

export function tokenize(text: string): Token[] {
  const hit = tokenCache.get(text)
  if (hit) return hit

  const out: Token[] = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) out.push({ k: 'text', v: text.slice(last, m.index) })
    const g = m.groups as Record<string, string | undefined>
    if (g.qual) {
      // A method call may be separated from its "(" by whitespace.
      const after = text.slice(m.index + m[0].length)
      out.push(...qualTokens(g.qual, /^\s*\(/.test(after)))
    }
    else if (g.url) out.push({ k: 'url', v: m[0] })
    else if (g.path) out.push({ k: 'path', v: m[0] })
    else if (g.str) out.push({ k: 'str', v: m[0] })
    else if (g.addr) out.push({ k: 'addr', v: m[0] })
    else if (g.key) out.push({ k: 'key', v: m[0] })
    else out.push({ k: 'num', v: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ k: 'text', v: text.slice(last) })

  if (tokenCache.size > 4000) tokenCache.clear()
  tokenCache.set(text, out)
  return out
}

/* ------------------------------------------------------------------ search */

/** Null when the query is empty, or a regex the user hasn't finished typing. */
export function buildMatcher(
  query: string,
  useRegex: boolean,
  caseSensitive: boolean
): RegExp | null {
  const q = query.trim()
  if (!q) return null
  const flags = caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    return null
  }
}

export function entryText(e: LogEntry): string {
  return e.stack.length ? e.raw + '\n' + e.stack.join('\n') : e.raw
}

export function matches(e: LogEntry, re: RegExp): boolean {
  re.lastIndex = 0
  return re.test(entryText(e))
}
