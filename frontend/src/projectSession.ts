import type { ParseResponse } from './floorplanUi'
import { buildProjectResumeURL, consumeInitialProjectAccess, type ProjectAccess } from './projectAccess'
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
  setProjectName: (name: string) => void
  clearCurrentProject: () => void
  saveProject: () => Promise<void>
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
  onState,
}: {
  document: () => ParseResponse | null
  geometryValidationError: () => string | null
  sourceFile: () => File | null
  projectName: () => string
  currentProject: () => ProjectDetail | null
  initialAccess: ProjectAccess | null
  onProjectSaved: (project: ProjectDetail) => void
  onProjectLoaded: (project: ProjectDetail, sourceImage: Blob) => void
  onState: (next: Partial<Pick<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy'>>) => void
}, dependencies: ProjectSessionDependencies = defaultProjectSessionDependencies): Omit<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy' | 'setProjectName' | 'clearCurrentProject'> {
  let request: Request | null = null
  let sequence = 0
  let disposed = false
  let access = initialAccess
  let initialLoadComplete = false

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
      onState({ currentProject: loaded, projectName: loaded.name, projectMessage: '项目已加载', projectMessageTone: 'success' })
      onProjectLoaded(loaded, sourceImage)
      return true
      } catch (error) {
      if (!active.controller.signal.aborted && isCurrent(active)) onState({ projectMessage: `项目加载失败：${error instanceof Error ? error.message : '未知错误'}`, projectMessageTone: 'error' })
      return false
    } finally {
      if (isCurrent(active)) onState({ projectBusy: null })
    }
  }

  return {
    async saveProject() {
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
      const existing = currentProject()
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
        if (!isCurrent(active)) return
		if (createdAccess) access = createdAccess
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: existing ? '项目已保存' : '项目已创建',
          projectMessageTone: 'success',
        })
        onProjectSaved(saved)
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) onState({
          projectMessage: error instanceof ProjectAPIError && error.code === 'revision_conflict'
            ? error.message
            : `项目保存失败：${error instanceof Error ? error.message : '未知错误'}`,
          projectMessageTone: 'error',
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
		request?.controller.abort()
		sequence += 1
		request = null
		onState({ projectBusy: null })
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
