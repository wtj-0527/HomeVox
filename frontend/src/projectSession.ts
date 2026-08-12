import type { ParseResponse } from './floorplanUi'
import { buildProjectResumeURL, clearProjectAccessFragment, consumeInitialProjectAccess, type ProjectAccess } from './projectAccess'
import type { ProjectSaveIntent } from './projectSaveCompletion'
import {
  buildProjectConflict,
  chooseProjectConflict,
  resolveProjectConflictDocument,
  type ProjectConflict,
  type ProjectConflictSelection,
} from './projectConflict'
export type { ProjectConflictSelection } from './projectConflict'
import {
  createProject,
  fetchProjectSourceImage,
  getProject,
  ProjectAPIError,
  updateProject,
  type CreatedProject,
  type ProjectDetail,
} from './projects'

export type ProjectBusy = 'save' | 'load' | null
export type ProjectMessageTone = 'success' | 'error'
export type ProjectSaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'
export type ProjectConflictState = {
  items: ProjectConflict['items']
  ready: boolean
}

export function projectSaveIssue({
  document,
  geometryValidationError,
  projectName,
  currentProject,
  sourceFile,
}: {
  document: ParseResponse | null
  geometryValidationError: string | null
  projectName: string
  currentProject: ProjectDetail | null
  sourceFile: File | null
}): string | null {
  if (!document) return '请先完成户型解析后再创建项目'
  if (geometryValidationError) return '当前户型几何无效，请返回 2D 校正后再保存'
  if (!projectName.trim()) return '请输入项目名称'
  if (!currentProject && !sourceFile) return '创建项目需要有效裁切户型图'
  if (!currentProject && sourceFile && (
    sourceFile.name !== document.filename ||
    sourceFile.type !== document.contentType ||
    sourceFile.size !== document.size
  )) return '待保存图片必须与解析后的有效裁切图一致'
  return null
}

type Request = { id: number; controller: AbortController }

export type ProjectSessionDependencies = {
  getProject: (id: string, capability: string, signal?: AbortSignal) => Promise<ProjectDetail>
  createProject: (
    name: string,
    document: ParseResponse,
    sourceImage: File,
    signal?: AbortSignal,
  ) => Promise<CreatedProject>
  updateProject: (
    id: string,
    capability: string,
    name: string,
    document: ParseResponse,
    expectedRevision: number,
    signal?: AbortSignal,
  ) => Promise<ProjectDetail>
  fetchSourceImage: (url: string, capability: string, signal?: AbortSignal) => Promise<Blob>
}

const defaultProjectSessionDependencies: ProjectSessionDependencies = {
  getProject,
  createProject,
  updateProject,
  fetchSourceImage: fetchProjectSourceImage,
}

export type ProjectSession = {
  projectName: string
  currentProject: ProjectDetail | null
  projectMessage: string
  projectMessageTone: ProjectMessageTone
  projectBusy: ProjectBusy
  projectSaveState: ProjectSaveState
  projectConflict: ProjectConflictState | null
  setProjectName: (name: string) => void
  clearCurrentProject: () => void
  saveProject: (intent?: ProjectSaveIntent) => Promise<void>
  queueAutoSave: (intent: ProjectSaveIntent) => Promise<void>
  retryProjectSave: () => Promise<void>
  chooseProjectConflict: (id: string, choice: ProjectConflictSelection) => void
  resolveProjectConflict: () => Promise<void>
  loadProject: (access: ProjectAccess) => Promise<void>
	loadInitialProject: () => Promise<void>
  reloadProject: () => Promise<void>
  copyProjectResumeLink: (baseURL: string, writeText: (value: string) => Promise<void>) => Promise<void>
  clearAccess: () => void
  activate: () => void
  dispose: () => void
}

/** Persistence controller with request identity/abort ownership. Capability
 * plaintext stays in this closure and is never merged into project/editor state. */
export function createProjectSession({
  document,
  geometryValidationError,
  sourceFile,
  projectName,
  currentProject,
  initialAccess,
  onProjectSaved,
  onProjectLoaded,
  onProjectConflictStarted,
  onProjectConflictResolved,
  onState,
}: {
  document: () => ParseResponse | null
  geometryValidationError: () => string | null
  sourceFile: () => File | null
  projectName: () => string
  currentProject: () => ProjectDetail | null
  initialAccess: ProjectAccess | null
  onProjectSaved: (project: ProjectDetail, intent: ProjectSaveIntent) => void
  onProjectLoaded: (project: ProjectDetail, sourceImage: Blob) => void
  onProjectConflictStarted: (confirmed: ProjectDetail) => void
  onProjectConflictResolved: (project: ProjectDetail) => void
  onState: (next: Partial<Pick<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy' | 'projectSaveState' | 'projectConflict'>>) => void
}, dependencies: ProjectSessionDependencies = defaultProjectSessionDependencies): Omit<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy' | 'projectSaveState' | 'projectConflict' | 'setProjectName' | 'clearCurrentProject'> {
  let request: Request | null = null
  let sequence = 0
  let disposed = false
  let access = initialAccess
  let initialLoadComplete = false
  let knownProject = currentProject()
  type AutoSaveRequest = { document: ParseResponse; name: string; intent: ProjectSaveIntent }
  let pendingAutoSave: AutoSaveRequest | null = null
  let failedAutoSave: AutoSaveRequest | null = null
  let autoSavePromise: Promise<void> | null = null
  let conflict: ProjectConflict | null = null
  let conflictBase: ProjectDetail | null = null

  const conflictState = (): ProjectConflictState | null => conflict ? {
    items: conflict.items,
    ready: conflict.items.every((item) => item.choice !== null),
  } : null

  const beginRequest = (): Request | null => {
    if (disposed) return null
    request?.controller.abort()
    const next = { id: sequence + 1, controller: new AbortController() }
    sequence = next.id
    request = next
    return next
  }
  const isCurrent = (next: Request): boolean => !disposed && request?.id === next.id

  const loadAccess = async (nextAccess: ProjectAccess): Promise<boolean> => {
    const active = beginRequest()
    if (!active) return false
    onState({ projectBusy: 'load', projectMessage: '', projectMessageTone: 'success' })
    try {
      const loaded = await dependencies.getProject(nextAccess.id, nextAccess.capability, active.controller.signal)
      if (!isCurrent(active)) return false
      const sourceImage = await dependencies.fetchSourceImage(loaded.sourceImageURL, nextAccess.capability, active.controller.signal)
      if (!isCurrent(active)) return false
      access = nextAccess
      knownProject = loaded
      failedAutoSave = null
      conflict = null
      conflictBase = null
      onState({ currentProject: loaded, projectName: loaded.name, projectMessage: '项目已加载', projectMessageTone: 'success', projectSaveState: 'saved', projectConflict: null })
      onProjectLoaded(loaded, sourceImage)
      if (typeof window !== 'undefined') clearProjectAccessFragment(window.location, (path) => window.history.replaceState(null, '', path))
      return true
      } catch (error) {
      if (!active.controller.signal.aborted && isCurrent(active)) onState({ projectMessage: `项目加载失败：${error instanceof Error ? error.message : '未知错误'}`, projectMessageTone: 'error' })
      return false
    } finally {
      if (isCurrent(active)) onState({ projectBusy: null })
    }
  }

  const runAutoSaveQueue = async (): Promise<void> => {
    while (!disposed && pendingAutoSave) {
      const queued = pendingAutoSave
      pendingAutoSave = null
      const existing = knownProject ?? currentProject()
      if (!existing || !access || access.id !== existing.id) {
        failedAutoSave = queued
        onState({
          projectMessage: '当前项目缺少有效访问凭据，请通过继续编辑链接重新打开',
          projectMessageTone: 'error',
          projectSaveState: 'failed',
        })
        return
      }
      const active = beginRequest()
      if (!active) return
      onState({ projectBusy: 'save', projectMessage: '保存中…', projectMessageTone: 'success', projectSaveState: 'saving' })
      try {
        const saved = await dependencies.updateProject(
          existing.id,
          access.capability,
          queued.name,
          queued.document,
          existing.revision,
          active.controller.signal,
        )
        if (!isCurrent(active)) return
        knownProject = saved
        failedAutoSave = null
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: '已保存',
          projectMessageTone: 'success',
          projectSaveState: 'saved',
        })
        onProjectSaved(saved, queued.intent)
      } catch (error) {
        if (active.controller.signal.aborted || !isCurrent(active)) return
        failedAutoSave = pendingAutoSave ?? queued
        pendingAutoSave = null
        const isConflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
        if (isConflict) {
          const remote = await dependencies.getProject(existing.id, access.capability, active.controller.signal)
          if (!isCurrent(active)) return
          conflictBase = existing
          knownProject = remote
          conflict = buildProjectConflict(existing.document, failedAutoSave.document, remote.document)
          onProjectConflictStarted(existing)
          onState({
            currentProject: remote,
            projectMessage: conflict.items.length ? '项目已在其他页面更新，请逐项处理冲突' : '检测到远端更新，可生成自动合并版本',
            projectMessageTone: 'error',
            projectSaveState: 'conflict',
            projectConflict: conflictState(),
          })
        } else {
          onState({ projectMessage: `保存失败：${error instanceof Error ? error.message : '未知错误'}`, projectMessageTone: 'error', projectSaveState: 'failed' })
        }
        return
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    }
  }

  const startAutoSaveQueue = (): Promise<void> => {
    if (!autoSavePromise) {
      autoSavePromise = runAutoSaveQueue().finally(() => {
        autoSavePromise = null
        if (pendingAutoSave && !disposed) startAutoSaveQueue()
      })
    }
    return autoSavePromise
  }

  return {
    async saveProject(intent: ProjectSaveIntent = { stage: 'snapshot', canonicalRevision: null }) {
      if (autoSavePromise) await autoSavePromise
      const issue = projectSaveIssue({
        document: document(),
        geometryValidationError: geometryValidationError(),
        projectName: projectName(),
        currentProject: currentProject(),
        sourceFile: sourceFile(),
      })
      if (issue) {
        onState({ projectMessage: issue, projectMessageTone: 'error' })
        return
      }
      const durableDocument = document()
      const existing = knownProject ?? currentProject()
      if (existing && (!access || access.id !== existing.id)) {
        onState({ projectMessage: '当前项目缺少有效访问凭据，请通过继续编辑链接重新打开', projectMessageTone: 'error' })
        return
      }
      const active = beginRequest()
      if (!active) return
      const name = projectName()
      onState({ projectBusy: 'save', projectMessage: '', projectMessageTone: 'success' })
      try {
        let saved: ProjectDetail
		let createdAccess: ProjectAccess | null = null
        if (existing) {
          saved = await dependencies.updateProject(existing.id, access!.capability, name, durableDocument!, existing.revision, active.controller.signal)
        } else {
          const created = await dependencies.createProject(name, durableDocument!, sourceFile()!, active.controller.signal)
          saved = created.project
			createdAccess = { id: saved.id, capability: created.capability }
        }
        // A server-confirmed create has issued the only recovery capability.
        // Retain it before observing UI cancellation; cancellation only stops UI updates.
        if (createdAccess) access = createdAccess
        if (!isCurrent(active)) return
        knownProject = saved
        failedAutoSave = null
        conflict = null
        conflictBase = null
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: existing ? '项目已保存' : '项目已创建',
          projectMessageTone: 'success',
          projectSaveState: 'saved',
          projectConflict: null,
        })
        onProjectSaved(saved, intent)
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) {
          const isConflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
          if (isConflict && durableDocument) {
            failedAutoSave = { document: durableDocument, name, intent }
            const remote = await dependencies.getProject(existing!.id, access!.capability, active.controller.signal)
            if (!isCurrent(active)) return
            conflictBase = existing!
            knownProject = remote
            conflict = buildProjectConflict(existing!.document, durableDocument, remote.document)
            onProjectConflictStarted(existing!)
            onState({ currentProject: remote, projectMessage: conflict.items.length ? '项目已在其他页面更新，请逐项处理冲突' : '检测到远端更新，可生成自动合并版本', projectMessageTone: 'error', projectSaveState: 'conflict', projectConflict: conflictState() })
          } else {
            onState({ projectMessage: `项目保存失败：${error instanceof Error ? error.message : '未知错误'}`, projectMessageTone: 'error', projectSaveState: 'failed' })
          }
        }
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    },
    queueAutoSave(intent) {
      const nextDocument = document()
      if (!nextDocument || geometryValidationError()) return Promise.resolve()
      pendingAutoSave = { document: nextDocument, name: projectName(), intent }
      failedAutoSave = null
      return startAutoSaveQueue()
    },
    retryProjectSave() {
      if (!failedAutoSave) return Promise.resolve()
      pendingAutoSave = failedAutoSave
      failedAutoSave = null
      return startAutoSaveQueue()
    },
    chooseProjectConflict(id, choice) {
      if (!conflict) return
      conflict = chooseProjectConflict(conflict, id, choice)
      onState({ projectConflict: conflictState() })
    },
    async resolveProjectConflict() {
      const local = failedAutoSave
      const existing = knownProject ?? currentProject()
      const nextDocument = conflict ? resolveProjectConflictDocument(conflict) : null
      if (!local || !existing || !access || access.id !== existing.id || !conflictBase || !nextDocument) {
        onState({ projectMessage: '冲突上下文已失效，请通过继续编辑链接重新打开', projectMessageTone: 'error', projectSaveState: 'failed' })
        return
      }
      const active = beginRequest()
      if (!active) return
      onState({
        projectBusy: 'save',
        projectMessage: '合并版本保存中…',
        projectMessageTone: 'success',
        projectSaveState: 'saving',
      })
      try {
        const saved = await dependencies.updateProject(
          existing.id,
          access.capability,
          local.name,
          nextDocument,
          existing.revision,
          active.controller.signal,
        )
        if (!isCurrent(active)) return
        knownProject = saved
        failedAutoSave = null
        conflict = null
        conflictBase = null
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: '合并版本已保存',
          projectMessageTone: 'success',
          projectSaveState: 'saved',
          projectConflict: null,
        })
        onProjectConflictResolved(saved)
        onProjectSaved(saved, local.intent)
      } catch (error) {
        if (active.controller.signal.aborted || !isCurrent(active)) return
        const isConflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
        if (isConflict) {
          const choices = new Map(conflict?.items.flatMap((item) => item.choice ? [[item.id, item.choice] as const] : []) ?? [])
          const remote = await dependencies.getProject(existing.id, access.capability, active.controller.signal)
          if (!isCurrent(active)) return
          const priorRemote = existing
          knownProject = remote
          conflictBase = priorRemote
          failedAutoSave = { ...local, document: nextDocument }
          conflict = buildProjectConflict(priorRemote.document, nextDocument, remote.document, choices)
          onState({ currentProject: remote, projectMessage: '项目再次发生更新，已保留本地意图与已有选择，请确认冲突项', projectMessageTone: 'error', projectSaveState: 'conflict', projectConflict: conflictState() })
        } else {
          onState({ projectMessage: `冲突处理失败：${error instanceof Error ? error.message : '未知错误'}`, projectMessageTone: 'error', projectSaveState: 'failed' })
        }
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    },
    async loadProject(nextAccess) {
      await loadAccess(nextAccess)
    },
    async loadInitialProject() {
      if (initialLoadComplete) return
      access ??= consumeInitialProjectAccess()
      if (access) initialLoadComplete = await loadAccess(access)
    },
    async reloadProject() {
      if (!access) {
        onState({ projectMessage: '当前项目缺少有效访问凭据，请通过继续编辑链接重新打开', projectMessageTone: 'error' })
        return
      }
      await loadAccess(access)
    },
    async copyProjectResumeLink(baseURL: string, writeText: (value: string) => Promise<void>) {
      if (!access) {
        onState({ projectMessage: '请先创建识别快照', projectMessageTone: 'error' })
        return
      }
      try {
        await writeText(buildProjectResumeURL(access, baseURL))
        onState({ projectMessage: '继续编辑链接已复制，请妥善保管', projectMessageTone: 'success' })
      } catch {
        onState({ projectMessage: '继续编辑链接复制失败，请检查浏览器剪贴板权限', projectMessageTone: 'error' })
      }
    },
    clearAccess() {
      access = null
      knownProject = null
      pendingAutoSave = null
      failedAutoSave = null
      conflict = null
      conflictBase = null
		request?.controller.abort()
		sequence += 1
		request = null
		onState({ projectBusy: null, projectSaveState: 'idle', projectConflict: null })
    },
    activate() {
      disposed = false
    },
    dispose() {
      disposed = true
      request?.controller.abort()
      request = null
    },
  }
}
