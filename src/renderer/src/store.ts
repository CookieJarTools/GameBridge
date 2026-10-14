import { create } from 'zustand'
import type {
  AppData,
  AssetScanProgress,
  AssetScanResult,
  BuildDoneEvent,
  BuildLogEvent,
  BuildNeedsForceEvent,
  BuildProgressEvent,
  BuildRecord,
  BuildRequest,
  CleanupActionResult,
  CleanupReport,
  OpenEditorInfo,
  PublishDoneEvent,
  PublishLogEvent,
  PublishStartedEvent,
  QuarantineEntry,
  GitAction,
  GitActionResult,
  GitStatus,
  LaunchMode,
  Project,
  RunExitEvent,
  RunLogEvent,
  Settings
} from '@shared/types'

export type View = 'library' | 'stores' | 'instances' | 'data' | 'settings'

/** Runs and builds share one list, so selection has to say which kind it is. */
export interface InstanceRef {
  kind: 'run' | 'build'
  id: string
}

/** A build held back because an editor has the project open. */
export interface PendingBuild {
  project: Project
  request: Omit<BuildRequest, 'projectId'>
  editor: OpenEditorInfo
}

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error'
}

/** A build record plus everything that only matters while it's on screen. */
export interface BuildUi extends BuildRecord {
  running: boolean
  percent: number
  /** What the engine is doing right now, straight from its log. */
  activity?: string
  imported?: number
  errorCount?: number
  warnCount?: number
  lines: RunLine[]
}

export interface RunLine {
  line: string
  stream: 'out' | 'err' | 'sys'
}

/** A publish in progress, with its streamed output. */
export interface UploadUi {
  id: string
  buildId: string
  targetId: string
  targetName: string
  version: string
  startedAt: number
  running: boolean
  ok?: boolean
  message?: string
  lines: RunLine[]
}

export interface RunUi {
  running: boolean
  lines: RunLine[]
  exitCode?: number | null
  signal?: string | null
  crashed?: boolean
  /** We stopped watching an editor log that can be picked back up. */
  canReattach?: boolean
}

interface AppState {
  loaded: boolean
  projects: Project[]
  settings: Settings | null

  view: View
  search: string
  activeTags: string[]
  /** 'all' or an engineId. */
  engineFilter: string
  scanning: boolean
  toasts: Toast[]

  gitStatus: Record<string, GitStatus>
  /** Keyed by buildId — running builds and persisted history together. */
  builds: Record<string, BuildUi>
  /** Build ids, newest first. */
  buildOrder: string[]
  /** projectId -> the most recent build for that project. */
  buildByProject: Record<string, string>
  selectedBuildId: string | null
  /** The instance shown in the detail pane, run or build. */
  selectedInstance: InstanceRef | null
  /** Waiting on the user to agree we may close their editor. */
  pendingBuild: PendingBuild | null
  /** A build whose editor refused to close in time. */
  forcePrompt: BuildNeedsForceEvent | null
  assetScans: Record<string, AssetScanResult>
  assetScanning: Record<string, { files: number; current: string }>
  /** Removal candidates per project. */
  cleanup: Record<string, CleanupReport>
  cleanupScanning: Record<string, boolean>
  /** Everything currently sitting in a quarantine folder, all projects. */
  quarantine: QuarantineEntry[]
  /** The upload in flight, if any — only one runs at a time. */
  upload: UploadUi | null
  runs: Record<string, RunUi>
  selectedRunId: string | null

  load: () => Promise<void>
  refreshData: () => Promise<void>
  updateVersion: (project: Project, version: string) => Promise<void>
  setView: (v: View) => void
  setSearch: (s: string) => void
  toggleTag: (t: string) => void
  setEngineFilter: (e: string) => void

  scan: () => Promise<void>
  addManual: () => Promise<void>
  launch: (project: Project, mode: LaunchMode) => Promise<void>
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>
  removeProject: (id: string) => Promise<void>
  saveSettings: (settings: Settings) => Promise<void>
  addGlobalTag: (tag: string) => Promise<void>
  removeGlobalTag: (tag: string) => Promise<void>

  refreshGit: (project: Project) => Promise<void>
  gitAct: (project: Project, action: GitAction, message?: string) => Promise<GitActionResult>

  startBuild: (project: Project, request?: Omit<BuildRequest, 'projectId'>) => Promise<void>
  stopBuild: (projectId: string) => void
  clearBuild: (projectId: string) => void
  forgetBuild: (buildId: string) => Promise<void>
  selectBuild: (buildId: string) => void
  selectInstance: (ref: InstanceRef) => void
  confirmCloseEditor: () => Promise<void>
  cancelPendingBuild: () => void
  answerForcePrompt: (choice: 'force' | 'cancel') => void
  ingestNeedsForce: (e: BuildNeedsForceEvent) => void
  revealBuild: (buildId: string) => Promise<void>
  loadBuilds: () => Promise<void>
  ingestBuildLog: (e: BuildLogEvent) => void
  ingestBuildProgress: (e: BuildProgressEvent) => void
  ingestBuildDone: (e: BuildDoneEvent) => void

  scanAssets: (projectId: string) => Promise<void>
  cancelAssetScan: (projectId: string) => void
  ingestAssetProgress: (e: AssetScanProgress) => void

  scanCleanup: (projectId: string, buildId?: string) => Promise<void>
  markNeeded: (projectId: string, paths: string[], keep: boolean) => Promise<void>
  quarantineAssets: (projectId: string, paths: string[], buildId?: string) => Promise<void>
  trashAssets: (projectId: string, paths: string[], buildId?: string) => Promise<void>
  loadQuarantine: () => Promise<void>
  startUpload: (buildId: string, targetId: string) => Promise<void>
  cancelUpload: () => void
  dismissUpload: () => void
  ingestPublishStarted: (e: PublishStartedEvent) => void
  ingestPublishLog: (e: PublishLogEvent) => void
  ingestPublishDone: (e: PublishDoneEvent) => void
  restoreQuarantined: (ids: string[], projectId?: string, buildId?: string) => Promise<void>
  emptyQuarantine: (ids: string[]) => Promise<void>

  stopRun: (projectId: string) => void
  reattachRun: (projectId: string) => Promise<void>
  clearRun: (projectId: string) => void
  syncRunningRuns: () => Promise<void>
  ingestRunLog: (e: RunLogEvent) => void
  ingestRunExit: (e: RunExitEvent) => void

  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

/** Every cleanup action reports the same way: a toast, and failures named. */
function afterCleanupAction(get: () => AppState, res: CleanupActionResult): void {
  get().toast(res.message, res.ok ? 'ok' : 'error')
  for (const f of res.failed.slice(0, 3)) get().toast(`${f.path}: ${f.error}`, 'error')
}

/** Fire a build off and focus it. Shared by the direct and post-confirm paths. */
async function runBuild(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  project: Project,
  request: Omit<BuildRequest, 'projectId'>
): Promise<void> {
  const res = await window.gamebridge.buildStart(project.id, { projectId: project.id, ...request })
  get().toast(res.message, res.ok ? 'ok' : 'error')
  if (!res.ok) return
  set({ view: 'instances' })
  if (res.buildId) {
    set({ selectedBuildId: res.buildId, selectedInstance: { kind: 'build', id: res.buildId } })
  }
}

/**
 * Build events can arrive before the IPC call that started the build resolves,
 * so every ingester upserts rather than assuming the record already exists.
 */
function upsertBuild(
  state: AppState,
  buildId: string,
  projectId: string
): Pick<AppState, 'builds' | 'buildOrder' | 'buildByProject'> {
  const builds = { ...state.builds }
  const existing = builds[buildId]
  const project = state.projects.find((p) => p.id === projectId)
  builds[buildId] = existing
    ? { ...existing }
    : {
        id: buildId,
        projectId,
        projectName: project?.name ?? 'Project',
        engineId: project?.engineId ?? '',
        startedAt: Date.now(),
        phase: 'starting',
        running: true,
        percent: 0,
        lines: []
      }
  return {
    builds,
    buildOrder: existing ? state.buildOrder : [buildId, ...state.buildOrder],
    buildByProject: { ...state.buildByProject, [projectId]: buildId }
  }
}

let toastSeq = 1

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  projects: [],
  settings: null,

  view: 'library',
  search: '',
  activeTags: [],
  engineFilter: 'all',
  scanning: false,
  toasts: [],
  gitStatus: {},
  builds: {},
  buildOrder: [],
  buildByProject: {},
  selectedBuildId: null,
  selectedInstance: null,
  pendingBuild: null,
  forcePrompt: null,
  assetScans: {},
  assetScanning: {},
  cleanup: {},
  cleanupScanning: {},
  quarantine: [],
  upload: null,
  runs: {},
  selectedRunId: null,

  load: async () => {
    const data: AppData = await window.gamebridge.getData()
    set({ projects: data.projects, settings: data.settings, loaded: true })
  },

  refreshData: async () => {
    const data = await window.gamebridge.getData()
    set({ projects: data.projects, settings: data.settings })
  },

  updateVersion: async (project, version) => {
    const res = await window.gamebridge.updateProjectVersion(project.id, version)
    get().toast(res.message, res.ok ? 'ok' : 'error')
    await get().refreshData()
  },

  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  toggleTag: (t) =>
    set((s) => ({
      activeTags: s.activeTags.includes(t)
        ? s.activeTags.filter((x) => x !== t)
        : [...s.activeTags, t]
    })),
  setEngineFilter: (engineFilter) => set({ engineFilter }),

  scan: async () => {
    set({ scanning: true })
    try {
      const res = await window.gamebridge.scanProjects()
      const data = await window.gamebridge.getData()
      set({ projects: data.projects })
      get().toast(
        res.added.length
          ? `Found ${res.added.length} new project${res.added.length === 1 ? '' : 's'}.`
          : 'No new projects found.'
      )
    } finally {
      set({ scanning: false })
    }
  },

  addManual: async () => {
    const project = await window.gamebridge.addProjectManually()
    if (!project) return
    const data = await window.gamebridge.getData()
    set({ projects: data.projects })
    get().toast(`Added "${project.name}".`)
  },

  launch: async (project, mode) => {
    const res = await window.gamebridge.launch({ projectId: project.id, mode })
    get().toast(res.message, res.ok ? 'ok' : 'error')
    if (res.ok) {
      const data = await window.gamebridge.getData()
      set({ projects: data.projects })
    }
  },

  updateProject: async (id, patch) => {
    await window.gamebridge.updateProject(id, patch)
    const data = await window.gamebridge.getData()
    set({ projects: data.projects })
  },

  removeProject: async (id) => {
    await window.gamebridge.removeProject(id)
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
  },

  saveSettings: async (settings) => {
    const saved = await window.gamebridge.saveSettings(settings)
    set({ settings: saved })
  },

  addGlobalTag: async (tag) => {
    const t = tag.trim()
    const s = get().settings
    if (!t || !s || s.tags.includes(t)) return
    await get().saveSettings({ ...s, tags: [...s.tags, t].sort() })
  },

  removeGlobalTag: async (tag) => {
    const s = get().settings
    if (!s) return
    await get().saveSettings({ ...s, tags: s.tags.filter((x) => x !== tag) })
  },

  refreshGit: async (project) => {
    const status = await window.gamebridge.gitStatus(project.path)
    set((s) => ({ gitStatus: { ...s.gitStatus, [project.id]: status } }))
  },

  gitAct: async (project, action, message) => {
    const res = await window.gamebridge.gitAction(project.path, action, message)
    get().toast(res.message, res.ok ? 'ok' : 'error')
    await get().refreshGit(project)
    return res
  },

  /**
   * Checks for an editor holding the project first. Depending on the setting
   * that either asks, closes it silently, or lets the build fail saying why.
   */
  startBuild: async (project, request = {}) => {
    const policy = get().settings?.closeEditorForBuild ?? 'ask'
    const pre = await window.gamebridge.buildPrecheck(project.id)
    if (!pre.ok) {
      get().toast(pre.message ?? 'Cannot build this project.', 'error')
      return
    }
    if (pre.editor && policy === 'ask') {
      set({ pendingBuild: { project, request, editor: pre.editor } })
      return
    }
    await runBuild(set, get, project, {
      ...request,
      closeEditor: pre.editor ? policy === 'always' : undefined
    })
  },

  confirmCloseEditor: async () => {
    const pending = get().pendingBuild
    if (!pending) return
    set({ pendingBuild: null })
    await runBuild(set, get, pending.project, { ...pending.request, closeEditor: true })
  },

  cancelPendingBuild: () => set({ pendingBuild: null }),

  answerForcePrompt: (choice) => {
    const prompt = get().forcePrompt
    if (!prompt) return
    set({ forcePrompt: null })
    window.gamebridge.buildForceClose(prompt.projectId, choice)
  },

  ingestNeedsForce: (e) => set({ forcePrompt: e }),

  stopBuild: (projectId) => {
    window.gamebridge.buildStop(projectId)
  },

  /** Dismiss the panel on a project card without touching the stored history. */
  clearBuild: (projectId) =>
    set((s) => {
      const buildByProject = { ...s.buildByProject }
      delete buildByProject[projectId]
      return { buildByProject }
    }),

  forgetBuild: async (buildId) => {
    const history = await window.gamebridge.buildForget(buildId)
    set((s) => {
      const builds = { ...s.builds }
      delete builds[buildId]
      const buildOrder = s.buildOrder.filter((id) => id !== buildId)
      const keep = new Set(history.map((r) => r.id))
      const buildByProject = { ...s.buildByProject }
      for (const [pid, id] of Object.entries(buildByProject)) {
        if (id === buildId && !keep.has(id)) delete buildByProject[pid]
      }
      return {
        builds,
        buildOrder,
        buildByProject,
        selectedBuildId: s.selectedBuildId === buildId ? (buildOrder[0] ?? null) : s.selectedBuildId
      }
    })
  },

  selectBuild: (buildId) =>
    set({ selectedBuildId: buildId, selectedInstance: { kind: 'build', id: buildId } }),

  selectInstance: (ref) =>
    set(
      ref.kind === 'build'
        ? { selectedInstance: ref, selectedBuildId: ref.id }
        : { selectedInstance: ref, selectedRunId: ref.id }
    ),

  revealBuild: async (buildId) => {
    const ok = await window.gamebridge.buildReveal(buildId)
    if (!ok) get().toast('No output folder for this build yet.', 'error')
  },

  /** Pull persisted history plus anything already building, e.g. after a reload. */
  loadBuilds: async () => {
    const [history, active] = await Promise.all([
      window.gamebridge.buildHistory(),
      window.gamebridge.buildActive()
    ])
    set((s) => {
      const builds = { ...s.builds }
      const live = new Set(active.map((r) => r.id))
      for (const record of [...history, ...active]) {
        const cur = builds[record.id]
        builds[record.id] = {
          ...record,
          running: live.has(record.id),
          percent: cur?.percent ?? (live.has(record.id) ? 0 : 100),
          activity: cur?.activity,
          lines: cur?.lines ?? []
        }
      }
      const buildOrder = Object.values(builds)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((b) => b.id)
      const buildByProject = { ...s.buildByProject }
      for (const id of [...buildOrder].reverse()) buildByProject[builds[id].projectId] = id
      return {
        builds,
        buildOrder,
        buildByProject,
        selectedBuildId: s.selectedBuildId ?? buildOrder[0] ?? null
      }
    })
  },

  ingestBuildLog: (e) =>
    set((s) => {
      if (!e.buildId) return {}
      const patch = upsertBuild(s, e.buildId, e.projectId)
      const cur = patch.builds[e.buildId]
      cur.lines = [...cur.lines, { line: e.line, stream: e.stream ?? 'out' }].slice(-8000)
      if (e.percent != null) cur.percent = Math.max(cur.percent, e.percent)
      return patch
    }),

  ingestBuildProgress: (e) =>
    set((s) => {
      const patch = upsertBuild(s, e.buildId, e.projectId)
      const cur = patch.builds[e.buildId]
      cur.phase = e.phase
      if (e.activity) cur.activity = e.activity
      if (e.percent != null) cur.percent = Math.max(cur.percent, e.percent)
      if (e.imported != null) cur.imported = e.imported
      if (e.errors != null) cur.errorCount = e.errors
      if (e.warnings != null) cur.warnCount = e.warnings
      return patch
    }),

  ingestBuildDone: (e) =>
    set((s) => {
      if (!e.buildId) return {}
      const patch = upsertBuild(s, e.buildId, e.projectId)
      const cur = patch.builds[e.buildId]
      Object.assign(cur, e.record ?? {})
      cur.running = false
      cur.percent = e.ok ? 100 : cur.percent
      cur.activity = e.ok ? 'Build succeeded' : (e.message ?? 'Build failed')
      return patch
    }),

  scanAssets: async (projectId) => {
    set((s) => ({ assetScanning: { ...s.assetScanning, [projectId]: { files: 0, current: '' } } }))
    try {
      const result = await window.gamebridge.assetScan(projectId)
      if (result) set((s) => ({ assetScans: { ...s.assetScans, [projectId]: result } }))
    } finally {
      set((s) => {
        const assetScanning = { ...s.assetScanning }
        delete assetScanning[projectId]
        return { assetScanning }
      })
    }
  },

  cancelAssetScan: (projectId) => {
    window.gamebridge.assetScanCancel(projectId)
  },

  /** Work out what this project could lose, comparing against a build if given. */
  scanCleanup: async (projectId, buildId) => {
    set((s) => ({ cleanupScanning: { ...s.cleanupScanning, [projectId]: true } }))
    try {
      const report = await window.gamebridge.cleanupScan(projectId, buildId)
      if (report) set((s) => ({ cleanup: { ...s.cleanup, [projectId]: report } }))
    } finally {
      set((s) => {
        const cleanupScanning = { ...s.cleanupScanning }
        delete cleanupScanning[projectId]
        return { cleanupScanning }
      })
    }
  },

  markNeeded: async (projectId, paths, keep) => {
    await window.gamebridge.cleanupKeep(projectId, paths, keep)
    await get().refreshData()
    const report = get().cleanup[projectId]
    await get().scanCleanup(projectId, report?.buildId)
  },

  quarantineAssets: async (projectId, paths, buildId) => {
    const res = await window.gamebridge.cleanupQuarantine(projectId, paths)
    afterCleanupAction(get, res)
    await get().loadQuarantine()
    await get().scanCleanup(projectId, buildId)
  },

  trashAssets: async (projectId, paths, buildId) => {
    const res = await window.gamebridge.cleanupTrash(projectId, paths)
    afterCleanupAction(get, res)
    await get().scanCleanup(projectId, buildId)
  },

  loadQuarantine: async () => {
    set({ quarantine: await window.gamebridge.cleanupQuarantined() })
  },

  /** Uploads are never automatic — this only runs from an explicit confirm. */
  startUpload: async (buildId, targetId) => {
    const res = await window.gamebridge.publishStart(buildId, targetId)
    if (!res.ok) get().toast(res.message, 'error')
    else get().toast(res.message)
  },

  cancelUpload: () => {
    const upload = get().upload
    if (upload?.running) window.gamebridge.publishCancel(upload.id)
  },

  dismissUpload: () => set({ upload: null }),

  ingestPublishStarted: (e) =>
    set({
      upload: {
        id: e.uploadId,
        buildId: e.buildId,
        targetId: e.targetId,
        targetName: e.targetName,
        version: e.version,
        startedAt: e.startedAt,
        running: true,
        lines: []
      }
    }),

  ingestPublishLog: (e) =>
    set((s) =>
      s.upload && s.upload.id === e.uploadId
        ? {
            upload: {
              ...s.upload,
              lines: [...s.upload.lines, { line: e.line, stream: e.stream }].slice(-4000)
            }
          }
        : {}
    ),

  ingestPublishDone: (e) => {
    get().toast(e.message, e.ok ? 'ok' : 'error')
    set((s) =>
      s.upload && s.upload.id === e.uploadId
        ? { upload: { ...s.upload, running: false, ok: e.ok, message: e.message } }
        : {}
    )
  },

  restoreQuarantined: async (ids, projectId, buildId) => {
    const res = await window.gamebridge.cleanupRestore(ids)
    afterCleanupAction(get, res)
    await get().loadQuarantine()
    if (projectId) await get().scanCleanup(projectId, buildId)
  },

  emptyQuarantine: async (ids) => {
    const res = await window.gamebridge.cleanupEmpty(ids)
    afterCleanupAction(get, res)
    await get().loadQuarantine()
  },

  ingestAssetProgress: (e) =>
    set((s) =>
      s.assetScanning[e.projectId]
        ? {
            assetScanning: {
              ...s.assetScanning,
              [e.projectId]: { files: e.files, current: e.current }
            }
          }
        : {}
    ),

  stopRun: (projectId) => {
    window.gamebridge.runStop(projectId)
  },

  reattachRun: async (projectId) => {
    const res = await window.gamebridge.runReattach(projectId)
    get().toast(res.message, res.ok ? 'ok' : 'error')
  },

  clearRun: (projectId) =>
    set((s) => {
      const runs = { ...s.runs }
      delete runs[projectId]
      const selectedRunId =
        s.selectedRunId === projectId ? (Object.keys(runs)[0] ?? null) : s.selectedRunId
      return { runs, selectedRunId }
    }),

  syncRunningRuns: async () => {
    const ids = await window.gamebridge.runRunning()
    set((s) => {
      const runs = { ...s.runs }
      for (const id of ids) if (!runs[id]) runs[id] = { running: true, lines: [] }
      return { runs }
    })
  },

  ingestRunLog: (e) =>
    set((s) => {
      const isNew = !s.runs[e.projectId]
      const cur = s.runs[e.projectId] ?? { running: true, lines: [] }
      const lines = [...cur.lines, { line: e.line, stream: e.stream }].slice(-5000)
      return {
        runs: { ...s.runs, [e.projectId]: { ...cur, running: true, canReattach: false, lines } },
        // First output from a new run: focus it and open the merged view.
        selectedRunId: isNew ? e.projectId : s.selectedRunId,
        selectedInstance: isNew ? { kind: 'run' as const, id: e.projectId } : s.selectedInstance,
        view: isNew ? ('instances' as const) : s.view
      }
    }),

  ingestRunExit: (e) =>
    set((s) => {
      const cur = s.runs[e.projectId] ?? { running: false, lines: [] }
      const crashed = !!e.signal || (e.code != null && e.code !== 0)
      return {
        runs: {
          ...s.runs,
          [e.projectId]: {
            ...cur,
            running: false,
            exitCode: e.code,
            signal: e.signal,
            crashed,
            canReattach: !!e.canReattach
          }
        }
      }
    }),

  toast: (text, kind = 'ok') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
