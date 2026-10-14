import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { AppData, CreateProjectRequest, CreateProjectResult, Project } from '@shared/types'
import { findEngine } from '@shared/engines'
import { gitignoreFor, GITATTRIBUTES_LFS } from '@shared/gitignore'
import { exists, resolveUnityEditor } from './resolve'
import { scanProjects } from './scanner'
import { newId } from './store'

const execFileAsync = promisify(execFile)

type OnLine = (line: string) => void

async function git(cwd: string, args: string[], onLine: OnLine): Promise<boolean> {
  try {
    await execFileAsync('git', args, { cwd, windowsHide: true })
    return true
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    onLine(`git ${args[0]} failed: ${(err.stderr || err.message || '').trim().split('\n')[0]}`)
    return false
  }
}

/** Run Unity's -createProject and stream its batchmode log. */
function unityCreate(editor: string, dir: string, onLine: OnLine): Promise<boolean> {
  return new Promise((resolve) => {
    onLine(`$ ${editor} -createProject "${dir}" -quit -batchmode`)
    const child = spawn(
      editor,
      ['-createProject', dir, '-quit', '-batchmode', '-nographics', '-logFile', '-'],
      { windowsHide: true }
    )
    const onData = (buf: Buffer): void => {
      for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) onLine(line.trimEnd())
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (e) => onLine(`Error: ${e.message}`))
    child.on('close', (code) => resolve(code === 0))
  })
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*]+/g, '_')
}

export async function createProject(
  req: CreateProjectRequest,
  data: AppData,
  onLine: OnLine
): Promise<CreateProjectResult> {
  const name = sanitizeName(req.name)
  if (!name) return { ok: false, message: 'Please enter a project name.' }
  if (!req.location || !(await exists(req.location))) {
    return { ok: false, message: 'Choose a valid parent folder.' }
  }
  const dir = join(req.location, name)
  if (await exists(dir)) {
    return { ok: false, message: `A folder named "${name}" already exists here.` }
  }

  const engine = findEngine(data.settings.engines, req.engineId)
  if (!engine) return { ok: false, message: 'Pick an engine for the new project.' }

  onLine(`Creating "${name}" (${engine.name}) in ${dir}`)

  // 1. Create the engine project.
  if (engine.kind === 'unity') {
    const editor = await resolveUnityEditor(req.engineVersion, data.settings.engineConfig)
    if (!editor) {
      return { ok: false, message: 'No Unity editor found. Install one via Settings → Unity editors.' }
    }
    onLine('Creating Unity project (importing packages — this can take a minute)…')
    const ok = await unityCreate(editor, dir, onLine)
    if (!ok || !(await exists(join(dir, 'ProjectSettings')))) {
      return { ok: false, message: 'Unity failed to create the project. See the log.' }
    }
  } else {
    // Unreal has no create CLI; custom engines have no template — scaffold the folder.
    await fs.mkdir(dir, { recursive: true })
    if (engine.kind === 'unreal') {
      onLine('Created folder + git scaffolding. Create the .uproject from the Unreal Editor, then re-scan.')
    } else {
      onLine('Created project folder.')
    }
  }

  // 2. Git + housekeeping files.
  if (req.gitignore) {
    await fs.writeFile(join(dir, '.gitignore'), gitignoreFor(engine.kind), 'utf-8')
    onLine('Wrote .gitignore')
  }
  if (req.gitattributes) {
    await fs.writeFile(join(dir, '.gitattributes'), GITATTRIBUTES_LFS, 'utf-8')
    onLine('Wrote .gitattributes (Git LFS)')
  }
  if (req.readme) {
    await fs.writeFile(join(dir, 'README.md'), `# ${req.name.trim()}\n\nA ${engine.name} project.\n`, 'utf-8')
    onLine('Wrote README.md')
  }
  if (req.initGit) {
    if (await git(dir, ['init', '-b', 'main'], onLine)) {
      onLine('Initialised git repository')
      if (req.initialCommit) {
        await git(dir, ['add', '-A'], onLine)
        if (await git(dir, ['commit', '-m', 'Initial commit'], onLine)) {
          onLine('Created initial commit')
        }
      }
    }
  }

  // 3. Register the project (classify to pick up version + launch file).
  const [detected] = await scanProjects([dir], data.settings.engines)
  const project: Project = detected ?? {
    id: newId(),
    name: req.name.trim(),
    path: dir,
    engineId: req.engineId,
    tags: []
  }
  project.name = req.name.trim()
  project.engineId = req.engineId
  if (detected) project.id = newId()

  onLine(`Done — added "${project.name}" to your library.`)
  return { ok: true, message: `Created "${project.name}"`, project }
}

/**
 * Point a project at a different engine version. Unity migrates on open (nothing to
 * write). For Unreal we rewrite EngineAssociation in the .uproject.
 */
export async function updateProjectVersion(project: Project, version: string): Promise<void> {
  const uproject = project.launchFile
  if (uproject && uproject.toLowerCase().endsWith('.uproject') && (await exists(uproject))) {
    try {
      const json = JSON.parse(await fs.readFile(uproject, 'utf-8'))
      json.EngineAssociation = version
      await fs.writeFile(uproject, JSON.stringify(json, null, 2), 'utf-8')
    } catch {
      /* leave the file as-is if it can't be parsed */
    }
  }
}
