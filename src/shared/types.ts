/** How an engine is launched. Built-ins have bespoke logic; 'custom' uses a template. */
export type EngineKind = 'unity' | 'unreal' | 'custom'

/**
 * 'project'     — launch the game/editor only
 * 'project+ide' — launch it and open the assigned IDE
 * 'ide'         — open the IDE only (no build, no launch)
 */
export type LaunchMode = 'project' | 'project+ide' | 'ide'

/**
 * An engine definition. Unity and Unreal are built-in (builtin: true) and cannot
 * be removed. Everything else is user-defined and lives in Settings.engines.
 */
export interface Engine {
  id: string
  name: string
  kind: EngineKind
  builtin: boolean
  /** Hex colour used for the badge/dot. */
  color: string
  /** Absolute path to the engine/editor executable (custom engines). */
  executable?: string
  /**
   * Launch argument template (custom engines). Supported tokens:
   *   {exe}  -> executable path
   *   {path} -> project folder
   *   {file} -> project launch file (if any)
   *   {args} -> extra user args
   */
  argsTemplate?: string
  /** File extension used to auto-detect projects, e.g. ".godot" (custom engines). */
  detectExtension?: string
  /**
   * Custom engines: launching runs the engine's build command first (with live
   * progress) and only starts the executable if the build succeeds.
   */
  buildBeforeRun?: boolean
}

/** A game project discovered on disk or added manually. */
export interface Project {
  id: string
  name: string
  /** Root folder of the project. */
  path: string
  /** Which Engine (built-in or custom) this project uses. Empty string = unassigned. */
  engineId: string
  /** e.g. "2022.3.10f1" (Unity) or "5.4" (Unreal). */
  engineVersion?: string
  /** The primary file to launch, e.g. an absolute path to a .uproject. */
  launchFile?: string
  tags: string[]
  favorite?: boolean
  lastOpened?: number
  /** Optional path to a thumbnail image on disk. */
  thumbnail?: string
  /** Project-relative asset paths the user marked as needed, never recommended for removal. */
  keepAssets?: string[]
  /** What a build does to the project's version. Defaults to leaving it alone. */
  versionBump?: VersionBump
  /** Keep only the newest N build folders per target. 0 or unset keeps them all. */
  keepBuilds?: number
  /** Where finished builds can be uploaded. Never holds a password. */
  publishTargets?: PublishTarget[]
  /** Overrides the engine's build template for this project. */
  buildTemplateOverride?: string
  /** Extra args substituted into {args} when building. */
  buildArgs?: string
}

/** An IDE / code editor that can be opened alongside a project. */
export interface IDE {
  id: string
  name: string
  /** Absolute path to the IDE executable. */
  executable: string
  /**
   * Argument template. Supported tokens:
   *   {path} -> project folder
   *   {sln}  -> first .sln found in project (falls back to {path})
   *   {file} -> project launch file
   */
  argsTemplate: string
}

export interface UnrealInstall {
  version: string
  /** Absolute path to UnrealEditor.exe */
  editorPath: string
}

/** A Unity editor installed on the machine (from Unity Hub). */
export interface UnityEditor {
  version: string
  location: string
  architecture?: string
}

/** A Unity version available to install (promoted release from Unity Hub). */
export interface UnityRelease {
  version: string
  architecture?: string
}

export interface EngineConfig {
  /** Root that contains version-named Unity editor folders (Unity Hub layout). */
  unityEditorsRoot?: string
  /** Absolute path to "Unity Hub.exe" (enables editor listing/installing). */
  unityHubPath?: string
  /** Installed Unity editors, sourced from Unity Hub (covers custom install dirs). */
  unityEditors: UnityEditor[]
  /** Detected Unreal Engine installs. */
  unrealInstalls: UnrealInstall[]
}

export interface Settings {
  scanRoots: string[]
  /** Predefined tag vocabulary, selectable per project. */
  tags: string[]
  /** Fallback IDE used when an engine has no specific assignment. */
  defaultIdeId?: string
  /** engineId -> ideId */
  ideByEngine: Record<string, string>
  /** engineId -> build command template (falls back to a default per engine kind). */
  buildByEngine: Record<string, string>
  /** engineId -> a "generate project files" command (e.g. premake) run before building. */
  generateByEngine: Record<string, string>
  /** engineId -> run the generate command before each build. */
  generateBeforeBuild: Record<string, boolean>
  /** engineId -> dir(s) prepended to PATH for generate + build (e.g. a g++/make toolchain). */
  toolchainBinByEngine: Record<string, string>
  /** engineId -> capture launched output into the Console (works for built-in engines too). */
  captureLogsByEngine: Record<string, boolean>
  ides: IDE[]
  /**
   * What to do when a build starts and an editor already has the project open.
   * 'ask' prompts, 'always' closes and reopens without asking, 'never' lets the
   * build fail rather than touching the editor.
   */
  closeEditorForBuild: 'ask' | 'always' | 'never'
  /** User-defined engines only. Built-in engines are added at runtime. */
  engines: Engine[]
  engineConfig: EngineConfig
  theme: 'dark' | 'light' | 'system'
}

export interface AppData {
  projects: Project[]
  settings: Settings
}

export interface LaunchRequest {
  projectId: string
  mode: LaunchMode
  /** Extra args for custom engines (fills {args}). */
  extraArgs?: string
}

export interface LaunchResult {
  ok: boolean
  message: string
}

export interface ScanResult {
  added: Project[]
  total: number
}

export interface CreateProjectRequest {
  name: string
  /** Parent folder; the project is created at <location>/<name>. */
  location: string
  engineId: string
  /** Unity editor version to create with (defaults to newest installed). */
  engineVersion?: string
  initGit: boolean
  gitignore: boolean
  gitattributes: boolean
  readme: boolean
  initialCommit: boolean
}

export interface CreateProjectResult {
  ok: boolean
  message: string
  project?: Project
}

/** Streamed line from an editor install / project creation. */
export interface InstallLogEvent {
  /** Unity version being installed, or a projectId for creation. */
  key: string
  line: string
}

export interface InstallDoneEvent {
  key: string
  ok: boolean
  message: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  ahead: number
  behind: number
  dirty: boolean
  changedFiles: number
  hasUpstream: boolean
}

export type GitAction = 'fetch' | 'pull' | 'push' | 'commit'

export interface GitActionResult {
  ok: boolean
  message: string
}

/** Streamed line of build output. */
export interface BuildLogEvent {
  projectId: string
  line: string
  /** Parsed 0–100 progress if a percentage was detected in the output. */
  percent?: number
  buildId?: string
  stream?: 'out' | 'err' | 'sys'
}

export interface BuildDoneEvent {
  projectId: string
  code: number | null
  ok: boolean
  /** Overrides the default toast text, e.g. to explain a missing artifact. */
  message?: string
  buildId?: string
  /** The finished record, including the parsed build report when there is one. */
  record?: BuildRecord
}

/* --------------------------------------------------------------- building */

/** A platform GameBridge can build a Unity project for, outside the editor. */
export interface BuildTargetDef {
  /** Unity's BuildTarget enum name, passed to our injected build script. */
  id: string
  label: string
  /** Value for Unity's -buildTarget switch (different spelling from the enum). */
  cli: string
  /** Artifact extension; '' means the build produces a folder. */
  ext: string
  /** Host platforms that can produce this target ('win32', 'darwin', 'linux'). */
  hosts: string[]
}

/**
 * Coarse stage of a build. Unity doesn't report real progress in batchmode, so
 * these are derived from its log and drive a weighted progress estimate.
 */
export type BuildPhaseId =
  | 'closing-editor'
  | 'starting'
  | 'switching'
  | 'importing'
  | 'compiling'
  | 'building'
  | 'reporting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** A Unity 6 Build Profile asset found in the project. */
export interface UnityBuildProfile {
  /** AssetDatabase path, e.g. "Assets/Settings/Build Profiles/Windows.asset". */
  path: string
  name: string
  /** Platform the profile targets, when we could read it. */
  platform?: string
  /** Matching BuildTargetDef id, so the output path gets the right extension. */
  targetId?: string
}

export interface BuildRequest {
  projectId: string
  /**
   * Build with this Unity Build Profile instead of the platform dropdown. The
   * profile decides target, scenes and player settings.
   */
  profilePath?: string
  /** Unity BuildTarget name; ignored by other engines and when a profile is set. */
  target?: string
  development?: boolean
  /** Artifact path. Defaults to <project>/Builds/<Target>/<Name><ext>. */
  outputPath?: string
  /** The user agreed we may close an editor holding the project. */
  closeEditor?: boolean
  /** Reopen that editor once the build finishes. Defaults to true. */
  reopenEditor?: boolean
}

/** An editor process currently holding a project open. */
export interface OpenEditorInfo {
  projectId: string
  projectName: string
  pid: number
  version?: string
  /** True when the engine's own lock file is present, not just the process. */
  locked: boolean
}

/** Answer to "can I build this right now?", asked before a build starts. */
export interface BuildPrecheck {
  ok: boolean
  /** Set when an editor has the project open. */
  editor?: OpenEditorInfo
  /** Reason the build can't start at all (no engine, no editor installed…). */
  message?: string
}

/** The build is waiting for the user to decide about a stubborn editor. */
export interface BuildNeedsForceEvent {
  buildId: string
  projectId: string
  projectName: string
  pid: number
  /** Seconds we already waited for a graceful close. */
  waited: number
}

export interface BuildStepInfo {
  name: string
  seconds: number
  depth: number
  errors: number
  warnings: number
}

/** One asset as it was packed into the build. */
export interface PackedAssetInfo {
  path: string
  bytes: number
  type: string
}

export interface BuildReport {
  result: string
  platform: string
  outputPath: string
  totalBytes: number
  totalSeconds: number
  errors: number
  warnings: number
  steps: BuildStepInfo[]
  assets: PackedAssetInfo[]
  /** First few build errors/warnings, for the summary panel. */
  messages: { type: string; content: string }[]
}

/** A build, running or finished. Kept in history so reports survive a restart. */
export interface BuildRecord {
  id: string
  projectId: string
  projectName: string
  engineId: string
  target?: string
  /** The Build Profile used, if any. */
  profileName?: string
  development?: boolean
  outputPath?: string
  startedAt: number
  endedAt?: number
  phase: BuildPhaseId
  exitCode?: number | null
  message?: string
  report?: BuildReport
  /** GameBridge closed the editor for this build and reopened it afterwards. */
  closedEditor?: boolean
  /** The project version this build carries. */
  version?: string
}

/** Live "what is the engine doing right now" update. */
export interface BuildProgressEvent {
  buildId: string
  projectId: string
  phase: BuildPhaseId
  /** Human-readable current activity, e.g. "Importing Assets/Art/rock.png". */
  activity?: string
  /** Weighted 0–100 estimate. */
  percent?: number
  imported?: number
  errors?: number
  warnings?: number
}

/* -------------------------------------------------------- asset analysis */

export interface AssetCategoryTotal {
  category: string
  bytes: number
  files: number
}

export interface AssetFileInfo {
  path: string
  bytes: number
  category: string
}

export interface AssetFinding {
  id: string
  severity: 'error' | 'warn' | 'info'
  title: string
  detail: string
  /** Example asset paths (capped for display). */
  paths: string[]
  /** Bytes implicated, where that's meaningful. */
  bytes?: number
}

export interface AssetScanResult {
  projectId: string
  root: string
  scannedAt: number
  totalBytes: number
  totalFiles: number
  /** True when the scan hit its file cap and stopped early. */
  truncated: boolean
  categories: AssetCategoryTotal[]
  largest: AssetFileInfo[]
  findings: AssetFinding[]
  /** Non-shipping folders (Library, Temp, Builds…) worth knowing the size of. */
  overhead: AssetCategoryTotal[]
}

export interface AssetScanProgress {
  projectId: string
  files: number
  current: string
}

/** A line of output from a running game. */
export interface RunLogEvent {
  projectId: string
  line: string
  stream: 'out' | 'err' | 'sys'
}

export interface RunExitEvent {
  projectId: string
  code: number | null
  signal: string | null
  /**
   * True when we merely stopped watching an editor's log — the editor is still
   * running and the Console can reconnect to the log where it left off.
   */
  canReattach?: boolean
}

/** A store/marketplace surface shown in the Asset Store view. */
export interface AssetStore {
  id: string
  name: string
  kind: 'webview' | 'external'
  url: string
  /** Short blurb for the store picker. */
  blurb: string
  /** Which engine kinds this store is most relevant to. */
  engines: EngineKind[]
}

/* ------------------------------------------------------------- cleanup */

/** Why an asset turned up as a removal candidate. */
export type CleanupReason =
  | 'not-in-build'
  | 'duplicate'
  | 'source-art'
  | 'orphan-meta'
  | 'unused-scene'

/**
 * How much to trust the recommendation. Nothing is ever 'certain' — an asset
 * can always be loaded by a path we can't see.
 */
export type CleanupConfidence = 'high' | 'medium' | 'low'

export interface CleanupCandidate {
  /** Project-relative, forward slashes. Also the id for actions. */
  path: string
  bytes: number
  category: string
  reason: CleanupReason
  confidence: CleanupConfidence
  detail: string
}

export interface CleanupReport {
  projectId: string
  scannedAt: number
  /** The build compared against, when there was one. */
  buildId?: string
  buildLabel?: string
  /** No build report was available, so this is heuristics only. */
  heuristicsOnly: boolean
  /**
   * Things that make "not in the build" unreliable for this project —
   * Addressables, asset bundles, StreamingAssets and the like.
   */
  caveats: string[]
  candidates: CleanupCandidate[]
  totalBytes: number
  /** Paths marked as needed, excluded from candidates. */
  keep: string[]
}

/** A file moved out of the project, recoverable until it is emptied. */
export interface QuarantineEntry {
  id: string
  projectId: string
  projectName: string
  /** Absolute project root, so a restore doesn't have to guess it. */
  projectPath: string
  /** Project-relative path it came from. */
  originalPath: string
  /** Absolute path it now sits at. */
  quarantinePath: string
  bytes: number
  movedAt: number
  /** Its .meta moved alongside it. */
  hadMeta: boolean
}

export interface CleanupActionResult {
  ok: boolean
  /** How many files the action handled. */
  count: number
  bytes: number
  failed: { path: string; error: string }[]
  message: string
}

/* ----------------------------------------------------------- JSON editing */

/** A JSON file found in a project. */
export interface JsonFileEntry {
  /** Absolute path. */
  path: string
  /** Project-relative, forward slashes. */
  relativePath: string
  name: string
  /** Folder part of relativePath, '' at the project root. */
  folder: string
  bytes: number
  modifiedAt: number
}

export interface JsonReadResult {
  path: string
  name: string
  bytes: number
  /** The file's text, minus any byte-order mark. */
  text: string
  /** Indentation the file already uses, so saving keeps its shape. */
  indent?: string
  /** The file started with a BOM, which must be written back. */
  bom?: boolean
  /** Parsed contents; absent when the file is too large or doesn't parse. */
  value?: unknown
  /** Too big for the form editor — shown as text only. */
  tooLarge: boolean
  /** Why it couldn't be parsed. */
  error?: string
  /** Has integer-like field names, whose order JavaScript will not preserve. */
  numericKeys?: boolean
}

export interface JsonWriteResult {
  ok: boolean
  message: string
  bytes?: number
  modifiedAt?: number
}

/* --------------------------------------------------------- versioning */

/** What a build does to the project's version before it runs. */
export type VersionBump = 'none' | 'build' | 'minor' | 'major'

export interface ProjectVersion {
  /** Unity's bundleVersion, verbatim. */
  version: string
  /** Android's separate always-increasing integer. */
  androidVersionCode?: number
}

/* --------------------------------------------------------- publishing */

export type PublishKind = 'steam' | 'itch' | 'custom'

/**
 * Somewhere a build can be sent. Deliberately holds no secret: steamcmd and
 * butler each keep their own cached login, established once in a terminal.
 */
export interface PublishTarget {
  id: string
  name: string
  kind: PublishKind
  /** Path to steamcmd or butler. */
  toolPath?: string
  /** Upload without publishing, where the tool supports it. */
  dryRun?: boolean

  /* Steam */
  appId?: string
  depotId?: string
  username?: string
  /** Branch to set live, e.g. "beta". Empty means don't set any branch live. */
  branch?: string
  description?: string

  /* itch.io */
  /** user/game:channel */
  itchTarget?: string

  /* Custom */
  /** Tokens: {output} {outputDir} {version} {name} {target} {profile} */
  command?: string
}

export interface PublishStartResult {
  ok: boolean
  message: string
  uploadId?: string
}

export interface PublishLogEvent {
  uploadId: string
  line: string
  stream: 'out' | 'err' | 'sys'
}

export interface PublishStartedEvent {
  uploadId: string
  projectId: string
  buildId: string
  targetId: string
  targetName: string
  version: string
  startedAt: number
}

export interface PublishDoneEvent {
  uploadId: string
  ok: boolean
  code?: number | null
  message: string
}
