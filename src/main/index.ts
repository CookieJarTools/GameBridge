import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename } from 'path'
import { hardenWebContents, lockAppWindow, openExternalSafe } from './security'
import { readFile } from 'fs/promises'
import type {
  AppData,
  AssetScanResult,
  BuildPrecheck,
  CleanupActionResult,
  CleanupReport,
  JsonFileEntry,
  JsonReadResult,
  JsonWriteResult,
  ProjectVersion,
  PublishStartResult,
  PublishTarget,
  VersionBump,
  PackedAssetInfo,
  UnityBuildProfile,
  QuarantineEntry,
  BuildRecord,
  BuildRequest,
  CreateProjectRequest,
  CreateProjectResult,
  EngineConfig,
  GitAction,
  GitActionResult,
  GitStatus,
  IDE,
  LaunchRequest,
  LaunchResult,
  Project,
  ScanResult,
  Settings,
  UnityEditor,
  UnityRelease,
  FabImportRequest,
  TransferRequest,
  TransferResult,
  UnrealScanResult
} from '@shared/types'
import { loadData, mutate, newId } from './store'
import { detectEngines, detectIdes, readEpicLauncherInstalls } from './detect'
import { scanProjects } from './scanner'
import { launchProject } from './launch'
import { gitStatus, runGitAction } from './git'
import {
  setBuildEmitter,
  setEditorReopener,
  startBuild,
  stopBuild,
  stopAllBuilds,
  runningBuilds,
  runningBuildRecords,
  outputFolderOf,
  precheckBuild,
  resolveForceClose
} from './build'
import { setRunEmitter, stopRun, stopAllRuns, runningRuns, reattachRun, reattachableRuns } from './run'
import { loadHistory, removeRecord, reportPathFor } from './buildhistory'
import { scanAssets, cancelAssetScan, setAssetEmitter } from './assetscan'
import { findBuildProfiles } from './buildprofiles'
import { listJsonFiles, readJsonFile, writeJsonFile } from './jsonfiles'
import { readProjectVersion, nextVersion } from './version'
import { cancelAllUploads, cancelUpload, setPublishEmitter, startUpload } from './publish'
import {
  cancelAllTransfers,
  cancelTransfer,
  importFabArchive,
  runTransfer,
  scanUnrealProject,
  setTransferEmitter
} from './transfer'
import { outputFolderOf as buildOutputFolder } from './build'
import {
  computeCleanup,
  loadQuarantine,
  quarantineAssets,
  restoreQuarantined,
  trashAssets,
  trashQuarantined
} from './cleanup'
import { findUnityHub, listInstalledEditors, listReleases, installEditor, cancelInstall } from './unityhub'
import { createProject, updateProjectVersion } from './create'
import { findEngine } from '@shared/engines'

let mainWindow: BrowserWindow | null = null

type Emit = (channel: string, payload: unknown) => void
let emitInstall: Emit = () => {}

/** GameBridge window/taskbar icon — bundled beside the app resources when packaged. */
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(__dirname, '../../build/icon.ico')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    icon: ICON_PATH,
    webPreferences: {
      // electron-vite emits an ESM preload (index.mjs) under "type": "module";
      // ESM preload scripts require the sandbox to be disabled.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  lockAppWindow(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Last scan per .uproject, so a transfer can work from what the user saw. */
const unrealScans = new Map<string, UnrealScanResult>()

function registerIpc(): void {
  ipcMain.handle('data:get', async (): Promise<AppData> => loadData())

  ipcMain.handle('settings:save', async (_e, settings: Settings): Promise<Settings> => {
    const data = await mutate((d) => {
      d.settings = settings
    })
    return data.settings
  })

  ipcMain.handle('settings:detect-engines', async (): Promise<EngineConfig> => {
    const current = await loadData()
    const detected = await detectEngines(current.settings.engineConfig.unityHubPath)
    const data = await mutate((d) => {
      d.settings.engineConfig.unityEditorsRoot =
        detected.unityEditorsRoot ?? d.settings.engineConfig.unityEditorsRoot
      d.settings.engineConfig.unityHubPath =
        detected.unityHubPath ?? d.settings.engineConfig.unityHubPath
      if (detected.unityEditors.length) d.settings.engineConfig.unityEditors = detected.unityEditors
      // Merge unreal installs by version.
      const byVersion = new Map(d.settings.engineConfig.unrealInstalls.map((u) => [u.version, u]))
      for (const u of detected.unrealInstalls) byVersion.set(u.version, u)
      d.settings.engineConfig.unrealInstalls = [...byVersion.values()]
    })
    return data.settings.engineConfig
  })

  // --- Unity editor management (via Unity Hub) ---
  ipcMain.handle('unity:refresh-installed', async (): Promise<UnityEditor[]> => {
    const data = await loadData()
    const hub = await findUnityHub(data.settings.engineConfig.unityHubPath)
    if (!hub) return data.settings.engineConfig.unityEditors
    const editors = await listInstalledEditors(hub)
    const updated = await mutate((d) => {
      d.settings.engineConfig.unityHubPath = hub
      if (editors.length) d.settings.engineConfig.unityEditors = editors
    })
    return updated.settings.engineConfig.unityEditors
  })

  ipcMain.handle('unity:releases', async (): Promise<UnityRelease[]> => {
    const data = await loadData()
    const hub = await findUnityHub(data.settings.engineConfig.unityHubPath)
    return hub ? listReleases(hub) : []
  })

  ipcMain.handle(
    'unity:install',
    async (_e, version: string, modules: string[]): Promise<{ ok: boolean; message: string }> => {
      const data = await loadData()
      const hub = await findUnityHub(data.settings.engineConfig.unityHubPath)
      if (!hub) return { ok: false, message: 'Unity Hub not found.' }
      installEditor(
        hub,
        version,
        modules ?? [],
        (line) => emitInstall('install:log', { key: version, line }),
        async (ok, message) => {
          if (ok) {
            const editors = await listInstalledEditors(hub)
            await mutate((d) => {
              if (editors.length) d.settings.engineConfig.unityEditors = editors
            })
          }
          emitInstall('install:done', { key: version, ok, message })
        }
      )
      return { ok: true, message: `Installing Unity ${version}…` }
    }
  )

  ipcMain.handle('unity:cancel-install', async (_e, version: string): Promise<void> => {
    cancelInstall(version)
  })

  // --- New project creation ---
  ipcMain.handle(
    'project:create',
    async (_e, req: CreateProjectRequest): Promise<CreateProjectResult> => {
      const data = await loadData()
      const result = await createProject(req, data, (line) =>
        emitInstall('install:log', { key: 'create-project', line })
      )
      if (result.ok && result.project) {
        await mutate((d) => {
          d.projects.push(result.project as Project)
        })
      }
      return result
    }
  )

  // --- Update a project's engine version (warn-only; opens to migrate) ---
  ipcMain.handle(
    'project:update-version',
    async (_e, projectId: string, version: string): Promise<LaunchResult> => {
      const data = await loadData()
      const project = data.projects.find((p) => p.id === projectId)
      if (!project) return { ok: false, message: 'Project not found.' }
      await updateProjectVersion(project, version)
      await mutate((d) => {
        const p = d.projects.find((x) => x.id === projectId)
        if (p) {
          p.engineVersion = version
          p.lastOpened = Date.now()
        }
      })
      const fresh = await loadData()
      const p = fresh.projects.find((x) => x.id === projectId)!
      return launchProject(p, fresh, 'project')
    }
  )

  ipcMain.handle('settings:detect-ides', async (): Promise<IDE[]> => {
    const detected = await detectIdes()
    const data = await mutate((d) => {
      const byExe = new Map(d.settings.ides.map((i) => [i.executable.toLowerCase(), i]))
      for (const ide of detected) {
        if (!byExe.has(ide.executable.toLowerCase())) {
          d.settings.ides.push(ide)
          byExe.set(ide.executable.toLowerCase(), ide)
        }
      }
      // Set a sensible default IDE if none chosen yet.
      if (!d.settings.defaultIdeId && d.settings.ides.length) {
        d.settings.defaultIdeId = d.settings.ides[0].id
      }
    })
    return data.settings.ides
  })

  ipcMain.handle('projects:scan', async (): Promise<ScanResult> => {
    const data = await loadData()
    const found = await scanProjects(data.settings.scanRoots, data.settings.engines)
    const existing = new Set(data.projects.map((p) => p.path.toLowerCase()))
    const added = found.filter((p) => !existing.has(p.path.toLowerCase()))
    const updated = await mutate((d) => {
      d.projects.push(...added)
    })
    return { added, total: updated.projects.length }
  })

  ipcMain.handle('projects:update', async (_e, id: string, patch: Partial<Project>): Promise<Project | null> => {
    let result: Project | null = null
    await mutate((d) => {
      const p = d.projects.find((x) => x.id === id)
      if (p) {
        Object.assign(p, patch)
        result = p
      }
    })
    return result
  })

  ipcMain.handle('projects:remove', async (_e, id: string): Promise<void> => {
    await mutate((d) => {
      d.projects = d.projects.filter((p) => p.id !== id)
    })
  })

  ipcMain.handle('projects:add-manual', async (): Promise<Project | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    const data = await loadData()
    if (data.projects.some((p) => p.path.toLowerCase() === dir.toLowerCase())) {
      return data.projects.find((p) => p.path.toLowerCase() === dir.toLowerCase()) ?? null
    }
    // Reuse the scanner on just this folder (depth 0 by pointing a root at it).
    const [detected] = await scanProjects([dir], data.settings.engines)
    const project: Project =
      detected ??
      ({
        id: newId(),
        name: basename(dir),
        path: dir,
        engineId: '',
        tags: [],
        launchFile: undefined
      } as Project)
    await mutate((d) => {
      d.projects.push(project)
    })
    return project
  })

  ipcMain.handle('projects:launch', async (_e, req: LaunchRequest): Promise<LaunchResult> => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === req.projectId)
    if (!project) return { ok: false, message: 'Project not found.' }
    const result = await launchProject(project, data, req.mode, req.extraArgs)
    if (result.ok) {
      await mutate((d) => {
        const p = d.projects.find((x) => x.id === req.projectId)
        if (p) p.lastOpened = Date.now()
      })
    }
    return result
  })

  ipcMain.handle('dialog:pick-folder', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:pick-exe', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk'] }]
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:add-scan-root', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    await mutate((d) => {
      if (!d.settings.scanRoots.some((r) => r.toLowerCase() === dir.toLowerCase())) {
        d.settings.scanRoots.push(dir)
      }
    })
    return dir
  })

  ipcMain.handle('shell:open-external', async (_e, url: string): Promise<void> => {
    await openExternalSafe(url)
  })

  // --- Git ---
  ipcMain.handle('git:status', async (_e, path: string): Promise<GitStatus> => gitStatus(path))

  ipcMain.handle(
    'git:action',
    async (_e, path: string, action: GitAction, message?: string): Promise<GitActionResult> =>
      runGitAction(path, action, message)
  )

  // --- Build ---
  ipcMain.handle('build:start', async (_e, projectId: string, request?: BuildRequest) => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return { ok: false, message: 'Project not found.' }
    return startBuild(project, data, { request })
  })

  ipcMain.handle('build:stop', async (_e, projectId: string): Promise<void> => {
    stopBuild(projectId)
  })

  ipcMain.handle('build:running', async (): Promise<string[]> => runningBuilds())

  /** Asked before starting, so the UI can offer to close an open editor. */
  ipcMain.handle('build:precheck', async (_e, projectId: string): Promise<BuildPrecheck> => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return { ok: false, message: 'Project not found.' }
    return precheckBuild(project, data)
  })

  /** Answer to "the editor still hasn't closed" — force it, or drop the build. */
  ipcMain.handle(
    'build:force-close',
    async (_e, projectId: string, choice: 'force' | 'cancel'): Promise<void> => {
      resolveForceClose(projectId, choice)
    }
  )

  ipcMain.handle('build:active', async (): Promise<BuildRecord[]> => runningBuildRecords())

  /** Unity 6 Build Profiles found in the project, for the build dialog. */
  ipcMain.handle('build:profiles', async (_e, projectId: string): Promise<UnityBuildProfile[]> => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return []
    const engine = findEngine(data.settings.engines, project.engineId)
    if (engine?.kind !== 'unity') return []
    return findBuildProfiles(project.path)
  })

  ipcMain.handle('build:history', async (): Promise<BuildRecord[]> => loadHistory())

  ipcMain.handle('build:forget', async (_e, buildId: string): Promise<BuildRecord[]> =>
    removeRecord(buildId)
  )

  /** Reveal a finished build's artifact in the OS file manager. */
  ipcMain.handle('build:reveal', async (_e, buildId: string): Promise<boolean> => {
    const record = (await loadHistory()).find((r) => r.id === buildId)
    const folder = record && outputFolderOf(record)
    if (!folder) return false
    const err = await shell.openPath(folder)
    return !err
  })

  // --- Transfer (Unreal / Fab -> Unity) ---
  ipcMain.handle('transfer:pick-uproject', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Unreal project', extensions: ['uproject'] }]
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  ipcMain.handle('transfer:pick-archive', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Fab download', extensions: ['zip', 'unitypackage'] }]
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  ipcMain.handle(
    'transfer:scan',
    async (_e, uprojectPath: string, scanId: string): Promise<UnrealScanResult> => {
      const data = await loadData()
      const installs = [...data.settings.engineConfig.unrealInstalls]
      for (const found of await readEpicLauncherInstalls()) {
        if (!installs.some((i) => i.editorPath.toLowerCase() === found.editorPath.toLowerCase())) installs.push(found)
      }
      const scan = await scanUnrealProject(uprojectPath, installs, scanId)
      unrealScans.set(uprojectPath.toLowerCase(), scan)
      await mutate((d) => {
        const recent = (d.settings.recentUnrealProjects ?? []).filter(
          (p) => p.toLowerCase() !== uprojectPath.toLowerCase()
        )
        d.settings.recentUnrealProjects = [uprojectPath, ...recent].slice(0, 8)
      })
      return scan
    }
  )

  ipcMain.handle(
    'transfer:start',
    async (_e, req: TransferRequest, transferId: string): Promise<TransferResult> => {
      const scan = unrealScans.get(req.uprojectPath.toLowerCase())
      if (!scan) throw new Error('Scan the Unreal project first.')
      return runTransfer(req, scan, transferId)
    }
  )

  ipcMain.handle(
    'transfer:fab',
    async (_e, req: FabImportRequest, transferId: string): Promise<TransferResult> => importFabArchive(req, transferId)
  )

  ipcMain.handle('transfer:cancel', async (_e, transferId: string): Promise<void> => cancelTransfer(transferId))

  ipcMain.handle('transfer:reveal', async (_e, dir: string): Promise<boolean> => !(await shell.openPath(dir)))

  // --- Asset analysis ---
  ipcMain.handle('assets:scan', async (_e, projectId: string): Promise<AssetScanResult | null> => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    if (!project) return null
    const engine = findEngine(data.settings.engines, project.engineId)
    return scanAssets(project.id, project.path, engine?.kind)
  })

  ipcMain.handle('assets:cancel', async (_e, projectId: string): Promise<void> => {
    cancelAssetScan(projectId)
  })

  // --- Cleanup: what the project can lose, and acting on it ---

  /** Compares the project against a build's report when one is given. */
  ipcMain.handle(
    'cleanup:scan',
    async (_e, projectId: string, buildId?: string): Promise<CleanupReport | null> => {
      const data = await loadData()
      const project = data.projects.find((p) => p.id === projectId)
      if (!project) return null
      const engine = findEngine(data.settings.engines, project.engineId)

      const record = buildId ? (await loadHistory()).find((r) => r.id === buildId) : undefined
      const usable = record && record.phase === 'succeeded' ? record : undefined
      const label = usable
        ? `${usable.target ?? 'build'} · ${new Date(usable.startedAt).toLocaleString()}`
        : undefined

      return computeCleanup(
        project,
        engine?.kind,
        usable ? reportPathFor(usable.id) : undefined,
        label,
        usable?.id
      )
    }
  )

  /** Mark assets as needed (or unmark them) so they stop being suggested. */
  ipcMain.handle(
    'cleanup:keep',
    async (_e, projectId: string, paths: string[], keep: boolean): Promise<string[]> => {
      let result: string[] = []
      await mutate((d) => {
        const p = d.projects.find((x) => x.id === projectId)
        if (!p) return
        const current = new Set(p.keepAssets ?? [])
        for (const path of paths) {
          if (keep) current.add(path)
          else current.delete(path)
        }
        p.keepAssets = [...current].sort()
        result = p.keepAssets
      })
      return result
    }
  )

  ipcMain.handle(
    'cleanup:quarantine',
    async (_e, projectId: string, paths: string[]): Promise<CleanupActionResult> => {
      const data = await loadData()
      const project = data.projects.find((p) => p.id === projectId)
      if (!project) {
        return { ok: false, count: 0, bytes: 0, failed: [], message: 'Project not found.' }
      }
      return quarantineAssets(project, paths)
    }
  )

  ipcMain.handle(
    'cleanup:trash',
    async (_e, projectId: string, paths: string[]): Promise<CleanupActionResult> => {
      const data = await loadData()
      const project = data.projects.find((p) => p.id === projectId)
      if (!project) {
        return { ok: false, count: 0, bytes: 0, failed: [], message: 'Project not found.' }
      }
      return trashAssets(project, paths)
    }
  )

  /** The full packed-asset list for a build — the record only keeps the top 500. */
  ipcMain.handle('build:assets', async (_e, buildId: string): Promise<PackedAssetInfo[]> => {
    try {
      const raw = await readFile(reportPathFor(buildId), 'utf-8')
      const parsed = JSON.parse(raw) as { assets?: PackedAssetInfo[] }
      return Array.isArray(parsed.assets) ? parsed.assets : []
    } catch {
      return []
    }
  })

  // --- JSON data files ---

  ipcMain.handle('json:list', async (_e, projectId: string): Promise<JsonFileEntry[]> => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    return project ? listJsonFiles(project.path) : []
  })

  ipcMain.handle('json:read', async (_e, path: string): Promise<JsonReadResult> => readJsonFile(path))

  ipcMain.handle(
    'json:write',
    async (_e, path: string, text: string): Promise<JsonWriteResult> => writeJsonFile(path, text)
  )

  /** Open a JSON file from anywhere, not just the selected project. */
  // --- Version + publishing ---

  /** The project's current version and what the chosen bump would make it. */
  ipcMain.handle(
    'version:read',
    async (_e, projectId: string): Promise<(ProjectVersion & { next?: string }) | null> => {
      const data = await loadData()
      const project = data.projects.find((p) => p.id === projectId)
      if (!project) return null
      const engine = findEngine(data.settings.engines, project.engineId)
      const current = await readProjectVersion(project.path, engine?.kind)
      if (!current) return null
      const bump: VersionBump = project.versionBump ?? 'none'
      return { ...current, next: nextVersion(current.version, bump) }
    }
  )

  /**
   * Upload one finished build to one named target. Always an explicit request —
   * nothing here runs on its own after a build.
   */
  ipcMain.handle(
    'publish:start',
    async (_e, buildId: string, targetId: string): Promise<PublishStartResult> => {
      const data = await loadData()
      const record = (await loadHistory()).find((r) => r.id === buildId)
      if (!record) return { ok: false, message: 'That build is no longer in the history.' }
      if (record.phase !== 'succeeded') {
        return { ok: false, message: 'Only a build that succeeded can be uploaded.' }
      }
      const project = data.projects.find((p) => p.id === record.projectId)
      if (!project) return { ok: false, message: 'That project is no longer in your library.' }
      const target = (project.publishTargets ?? []).find((t: PublishTarget) => t.id === targetId)
      if (!target) return { ok: false, message: 'That publish target no longer exists.' }

      const folder = buildOutputFolder(record)
      if (!folder) return { ok: false, message: 'That build has no output folder to upload.' }
      return startUpload(project, record, target, folder, record.version ?? '0.0.0')
    }
  )

  ipcMain.handle('publish:cancel', async (_e, uploadId: string): Promise<void> => {
    cancelUpload(uploadId)
  })

  ipcMain.handle('json:pick', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle('cleanup:quarantined', async (): Promise<QuarantineEntry[]> => loadQuarantine())

  ipcMain.handle(
    'cleanup:restore',
    async (_e, ids: string[]): Promise<CleanupActionResult> => restoreQuarantined(ids)
  )

  ipcMain.handle(
    'cleanup:empty',
    async (_e, ids: string[]): Promise<CleanupActionResult> => trashQuarantined(ids)
  )

  // --- Run (game output console) ---
  ipcMain.handle('run:stop', async (_e, projectId: string): Promise<void> => {
    stopRun(projectId)
  })

  ipcMain.handle('run:running', async (): Promise<string[]> => runningRuns())

  ipcMain.handle('run:reattachable', async (): Promise<string[]> => reattachableRuns())

  ipcMain.handle('run:reattach', async (_e, projectId: string) => reattachRun(projectId))
}

app.whenReady().then(() => {
  hardenWebContents()
  // Ensures Windows groups the app under our identity/icon instead of electron.exe.
  if (process.platform === 'win32') app.setAppUserModelId('com.gamebridge.launcher')
  const send = (channel: string, payload: unknown): void => {
    mainWindow?.webContents.send(channel, payload)
  }
  setBuildEmitter(send)
  setRunEmitter(send)
  setAssetEmitter(send)
  setPublishEmitter(send)
  setTransferEmitter(send)
  // Reopening after a build reuses the normal launch path (log capture and all).
  setEditorReopener(async (projectId) => {
    const data = await loadData()
    const project = data.projects.find((p) => p.id === projectId)
    if (project) await launchProject(project, data, 'project')
  })
  emitInstall = send
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cancelAllUploads()
  cancelAllTransfers()
  stopAllBuilds()
  stopAllRuns()
})
