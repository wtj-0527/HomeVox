import type { ParseResponse } from './floorplanUi'
import { buildProjectResumeURL, clearProjectAccessFragment, consumeInitialProjectAccess, type ProjectAccess } from './projectAccess'
import type { ProjectSaveIntent } from './projectSaveCompletion'
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
export type ProjectConflictChoice = 'local' | 'remote' | 'merge'

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
  setProjectName: (name: string) => void
  clearCurrentProject: () => void
  saveProject: (intent?: ProjectSaveIntent) => Promise<void>
  queueAutoSave: (intent: ProjectSaveIntent) => Promise<void>
  retryProjectSave: () => Promise<void>
  resolveProjectConflict: (choice: ProjectConflictChoice) => Promise<void>
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
  onProjectConflictResolved: (project: ProjectDetail, choice: ProjectConflictChoice) => void
  onState: (next: Partial<Pick<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy' | 'projectSaveState'>>) => void
}, dependencies: ProjectSessionDependencies = defaultProjectSessionDependencies): Omit<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy' | 'projectSaveState' | 'setProjectName' | 'clearCurrentProject'> {
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

  const mergeByID = <T extends { id?: string }>(remote: readonly T[], local: readonly T[]): T[] => {
    const localByID = new Map(local.flatMap((item) => item.id ? [[item.id, item] as const] : []))
    const merged = remote.map((item) => item.id ? (localByID.get(item.id) ?? item) : item)
    const remoteIDs = new Set(remote.flatMap((item) => item.id ? [item.id] : []))
    return [...merged, ...local.filter((item) => !item.id || !remoteIDs.has(item.id))]
  }

  const mergeDocuments = (remote: ParseResponse, local: ParseResponse): ParseResponse => ({
    ...remote,
    ...local,
    result: {
      ...remote.result,
      ...local.result,
      rooms: local.result.rooms,
      walls: mergeByID(remote.result.walls, local.result.walls),
      doors: mergeByID(remote.result.doors, local.result.doors),
      windows: mergeByID(remote.result.windows, local.result.windows),
    },
  })

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
      onState({ currentProject: loaded, projectName: loaded.name, projectMessage: '项目已加载', projectMessageTone: 'success', projectSaveState: 'saved' })
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
        const conflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
        onState({
          projectMessage: conflict
            ? '项目已在其他页面更新，请选择本地版本、远端版本或生成合并版本'
            : `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
          projectMessageTone: 'error',
          projectSaveState: conflict ? 'conflict' : 'failed',
        })
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
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: existing ? '项目已保存' : '项目已创建',
          projectMessageTone: 'success',
          projectSaveState: 'saved',
        })
        onProjectSaved(saved, intent)
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) {
          const conflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
          if (conflict && durableDocument) failedAutoSave = { document: durableDocument, name, intent }
          onState({
          projectMessage: conflict
            ? '项目已在其他页面更新，请选择本地版本、远端版本或生成合并版本'
            : `项目保存失败：${error instanceof Error ? error.message : '未知错误'}`,
          projectMessageTone: 'error',
          projectSaveState: conflict ? 'conflict' : 'failed',
        })
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
    async resolveProjectConflict(choice) {
      const local = failedAutoSave
      const existing = knownProject ?? currentProject()
      if (!local || !existing || !access || access.id !== existing.id) {
        onState({ projectMessage: '冲突上下文已失效，请通过继续编辑链接重新打开', projectMessageTone: 'error', projectSaveState: 'failed' })
        return
      }
      const active = beginRequest()
      if (!active) return
      onState({
        projectBusy: choice === 'remote' ? 'load' : 'save',
        projectMessage: choice === 'merge' ? '合并版本保存中…' : choice === 'local' ? '本地版本保存中…' : '远端版本加载中…',
        projectMessageTone: 'success',
        projectSaveState: 'saving',
      })
      try {
        const remote = await dependencies.getProject(existing.id, access.capability, active.controller.signal)
        if (!isCurrent(active)) return
        knownProject = remote
        if (choice === 'remote') {
          const sourceImage = await dependencies.fetchSourceImage(remote.sourceImageURL, access.capability, active.controller.signal)
          if (!isCurrent(active)) return
          failedAutoSave = null
          onState({ currentProject: remote, projectName: remote.name, projectMessage: '已使用远端版本', projectMessageTone: 'success', projectSaveState: 'saved' })
          onProjectLoaded(remote, sourceImage)
          return
        }
        const nextDocument = choice === 'merge' ? mergeDocuments(remote.document, local.document) : local.document
        const saved = await dependencies.updateProject(
          remote.id,
          access.capability,
          local.name,
          nextDocument,
          remote.revision,
          active.controller.signal,
        )
        if (!isCurrent(active)) return
        knownProject = saved
        failedAutoSave = null
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: choice === 'merge' ? '合并版本已保存' : '本地版本已保存',
          projectMessageTone: 'success',
          projectSaveState: 'saved',
        })
        onProjectConflictResolved(saved, choice)
        onProjectSaved(saved, local.intent)
      } catch (error) {
        if (active.controller.signal.aborted || !isCurrent(active)) return
        const conflict = error instanceof ProjectAPIError && error.code === 'revision_conflict'
        onState({
          projectMessage: conflict
            ? '项目再次发生更新，请重新选择冲突版本'
            : `冲突处理失败：${error instanceof Error ? error.message : '未知错误'}`,
          projectMessageTone: 'error',
          projectSaveState: conflict ? 'conflict' : 'failed',
        })
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
		request?.controller.abort()
		sequence += 1
		request = null
		onState({ projectBusy: null, projectSaveState: 'idle' })
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
