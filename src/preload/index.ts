import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AppData,
  AssetScanProgress,
  AssetScanResult,
  BuildDoneEvent,
  BuildLogEvent,
  BuildNeedsForceEvent,
  BuildPrecheck,
  BuildProgressEvent,
  BuildRecord,
  BuildRequest,
  CleanupActionResult,
  CleanupReport,
  JsonFileEntry,
  JsonReadResult,
  JsonWriteResult,
  ProjectVersion,
  PublishDoneEvent,
  PublishLogEvent,
  PublishStartResult,
  PublishStartedEvent,
  PackedAssetInfo,
  QuarantineEntry,
  EngineConfig,
  GitAction,
  GitActionResult,
  GitStatus,
  RunLogEvent,
  RunExitEvent,
  IDE,
  LaunchRequest,
  LaunchResult,
  Project,
  ScanResult,
  Settings,
  UnityBuildProfile,
  UnityEditor,
  UnityRelease,
  CreateProjectRequest,
  CreateProjectResult,
  InstallLogEvent,
  InstallDoneEvent,
  FabImportRequest,
  TransferProgressEvent,
  TransferRequest,
  TransferResult,
  UnrealScanResult
} from '@shared/types'

const api = {
  getData: (): Promise<AppData> => ipcRenderer.invoke('data:get'),
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings),
  detectEngines: (): Promise<EngineConfig> => ipcRenderer.invoke('settings:detect-engines'),
  detectIdes: (): Promise<IDE[]> => ipcRenderer.invoke('settings:detect-ides'),
  scanProjects: (): Promise<ScanResult> => ipcRenderer.invoke('projects:scan'),
  addProjectManually: (): Promise<Project | null> => ipcRenderer.invoke('projects:add-manual'),
  updateProject: (id: string, patch: Partial<Project>): Promise<Project | null> =>
    ipcRenderer.invoke('projects:update', id, patch),
  removeProject: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
  launch: (req: LaunchRequest): Promise<LaunchResult> => ipcRenderer.invoke('projects:launch', req),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder'),
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-exe'),
  addScanRoot: (): Promise<string | null> => ipcRenderer.invoke('dialog:add-scan-root'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),

  // Transfer (Unreal / Fab -> Unity)
  transferPickUproject: (): Promise<string | null> => ipcRenderer.invoke('transfer:pick-uproject'),
  transferPickArchive: (): Promise<string | null> => ipcRenderer.invoke('transfer:pick-archive'),
  transferScan: (uprojectPath: string, scanId: string): Promise<UnrealScanResult> =>
    ipcRenderer.invoke('transfer:scan', uprojectPath, scanId),
  transferStart: (req: TransferRequest, transferId: string): Promise<TransferResult> =>
    ipcRenderer.invoke('transfer:start', req, transferId),
  transferFab: (req: FabImportRequest, transferId: string): Promise<TransferResult> =>
    ipcRenderer.invoke('transfer:fab', req, transferId),
  transferCancel: (transferId: string): Promise<void> => ipcRenderer.invoke('transfer:cancel', transferId),
  transferReveal: (dir: string): Promise<boolean> => ipcRenderer.invoke('transfer:reveal', dir),
  /** Real path of a file dropped onto the window (File.path no longer exists). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onTransferProgress: (cb: (e: TransferProgressEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: TransferProgressEvent): void => cb(payload)
    ipcRenderer.on('transfer:progress', handler)
    return () => ipcRenderer.removeListener('transfer:progress', handler)
  },

  // Git
  gitStatus: (path: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', path),
  gitAction: (path: string, action: GitAction, message?: string): Promise<GitActionResult> =>
    ipcRenderer.invoke('git:action', path, action, message),

  // Build
  buildStart: (
    projectId: string,
    request?: BuildRequest
  ): Promise<{ ok: boolean; message: string; buildId?: string }> =>
    ipcRenderer.invoke('build:start', projectId, request),
  buildStop: (projectId: string): Promise<void> => ipcRenderer.invoke('build:stop', projectId),
  buildRunning: (): Promise<string[]> => ipcRenderer.invoke('build:running'),
  buildPrecheck: (projectId: string): Promise<BuildPrecheck> =>
    ipcRenderer.invoke('build:precheck', projectId),
  buildForceClose: (projectId: string, choice: 'force' | 'cancel'): Promise<void> =>
    ipcRenderer.invoke('build:force-close', projectId, choice),
  onBuildNeedsForce: (cb: (e: BuildNeedsForceEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BuildNeedsForceEvent): void => cb(payload)
    ipcRenderer.on('build:needs-force', handler)
    return () => ipcRenderer.removeListener('build:needs-force', handler)
  },
  buildActive: (): Promise<BuildRecord[]> => ipcRenderer.invoke('build:active'),
  buildProfiles: (projectId: string): Promise<UnityBuildProfile[]> =>
    ipcRenderer.invoke('build:profiles', projectId),
  buildHistory: (): Promise<BuildRecord[]> => ipcRenderer.invoke('build:history'),
  buildForget: (buildId: string): Promise<BuildRecord[]> =>
    ipcRenderer.invoke('build:forget', buildId),
  buildReveal: (buildId: string): Promise<boolean> => ipcRenderer.invoke('build:reveal', buildId),
  onBuildProgress: (cb: (e: BuildProgressEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BuildProgressEvent): void => cb(payload)
    ipcRenderer.on('build:progress', handler)
    return () => ipcRenderer.removeListener('build:progress', handler)
  },

  onBuildLog: (cb: (e: BuildLogEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BuildLogEvent): void => cb(payload)
    ipcRenderer.on('build:log', handler)
    return () => ipcRenderer.removeListener('build:log', handler)
  },
  onBuildDone: (cb: (e: BuildDoneEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: BuildDoneEvent): void => cb(payload)
    ipcRenderer.on('build:done', handler)
    return () => ipcRenderer.removeListener('build:done', handler)
  },
  // Asset analysis
  assetScan: (projectId: string): Promise<AssetScanResult | null> =>
    ipcRenderer.invoke('assets:scan', projectId),
  assetScanCancel: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('assets:cancel', projectId),
  onAssetScanProgress: (cb: (e: AssetScanProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: AssetScanProgress): void => cb(payload)
    ipcRenderer.on('assets:progress', handler)
    return () => ipcRenderer.removeListener('assets:progress', handler)
  },

  // Cleanup
  cleanupScan: (projectId: string, buildId?: string): Promise<CleanupReport | null> =>
    ipcRenderer.invoke('cleanup:scan', projectId, buildId),
  cleanupKeep: (projectId: string, paths: string[], keep: boolean): Promise<string[]> =>
    ipcRenderer.invoke('cleanup:keep', projectId, paths, keep),
  cleanupQuarantine: (projectId: string, paths: string[]): Promise<CleanupActionResult> =>
    ipcRenderer.invoke('cleanup:quarantine', projectId, paths),
  cleanupTrash: (projectId: string, paths: string[]): Promise<CleanupActionResult> =>
    ipcRenderer.invoke('cleanup:trash', projectId, paths),
  cleanupQuarantined: (): Promise<QuarantineEntry[]> => ipcRenderer.invoke('cleanup:quarantined'),

  // JSON data files
  jsonList: (projectId: string): Promise<JsonFileEntry[]> =>
    ipcRenderer.invoke('json:list', projectId),
  jsonRead: (path: string): Promise<JsonReadResult> => ipcRenderer.invoke('json:read', path),
  jsonWrite: (path: string, text: string): Promise<JsonWriteResult> =>
    ipcRenderer.invoke('json:write', path, text),
  jsonPick: (): Promise<string | null> => ipcRenderer.invoke('json:pick'),

  // Version + publishing
  versionRead: (projectId: string): Promise<(ProjectVersion & { next?: string }) | null> =>
    ipcRenderer.invoke('version:read', projectId),
  publishStart: (buildId: string, targetId: string): Promise<PublishStartResult> =>
    ipcRenderer.invoke('publish:start', buildId, targetId),
  publishCancel: (uploadId: string): Promise<void> =>
    ipcRenderer.invoke('publish:cancel', uploadId),
  onPublishLog: (cb: (e: PublishLogEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: PublishLogEvent): void => cb(payload)
    ipcRenderer.on('publish:log', handler)
    return () => ipcRenderer.removeListener('publish:log', handler)
  },
  onPublishStarted: (cb: (e: PublishStartedEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: PublishStartedEvent): void => cb(payload)
    ipcRenderer.on('publish:started', handler)
    return () => ipcRenderer.removeListener('publish:started', handler)
  },
  onPublishDone: (cb: (e: PublishDoneEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: PublishDoneEvent): void => cb(payload)
    ipcRenderer.on('publish:done', handler)
    return () => ipcRenderer.removeListener('publish:done', handler)
  },
  buildAssets: (buildId: string): Promise<PackedAssetInfo[]> =>
    ipcRenderer.invoke('build:assets', buildId),
  cleanupRestore: (ids: string[]): Promise<CleanupActionResult> =>
    ipcRenderer.invoke('cleanup:restore', ids),
  cleanupEmpty: (ids: string[]): Promise<CleanupActionResult> =>
    ipcRenderer.invoke('cleanup:empty', ids),

  // Run / game-output console
  runStop: (projectId: string): Promise<void> => ipcRenderer.invoke('run:stop', projectId),
  runRunning: (): Promise<string[]> => ipcRenderer.invoke('run:running'),
  runReattachable: (): Promise<string[]> => ipcRenderer.invoke('run:reattachable'),
  runReattach: (projectId: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('run:reattach', projectId),
  onRunLog: (cb: (e: RunLogEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: RunLogEvent): void => cb(payload)
    ipcRenderer.on('run:log', handler)
    return () => ipcRenderer.removeListener('run:log', handler)
  },
  onRunExit: (cb: (e: RunExitEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: RunExitEvent): void => cb(payload)
    ipcRenderer.on('run:exit', handler)
    return () => ipcRenderer.removeListener('run:exit', handler)
  },

  // New project creation + Unity editor management
  createProject: (req: CreateProjectRequest): Promise<CreateProjectResult> =>
    ipcRenderer.invoke('project:create', req),
  updateProjectVersion: (projectId: string, version: string): Promise<LaunchResult> =>
    ipcRenderer.invoke('project:update-version', projectId, version),
  unityRefreshInstalled: (): Promise<UnityEditor[]> => ipcRenderer.invoke('unity:refresh-installed'),
  unityReleases: (): Promise<UnityRelease[]> => ipcRenderer.invoke('unity:releases'),
  unityInstall: (version: string, modules: string[]): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('unity:install', version, modules),
  unityCancelInstall: (version: string): Promise<void> =>
    ipcRenderer.invoke('unity:cancel-install', version),
  onInstallLog: (cb: (e: InstallLogEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: InstallLogEvent): void => cb(payload)
    ipcRenderer.on('install:log', handler)
    return () => ipcRenderer.removeListener('install:log', handler)
  },
  onInstallDone: (cb: (e: InstallDoneEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: InstallDoneEvent): void => cb(payload)
    ipcRenderer.on('install:done', handler)
    return () => ipcRenderer.removeListener('install:done', handler)
  }
}

export type GameBridgeApi = typeof api

contextBridge.exposeInMainWorld('gamebridge', api)
