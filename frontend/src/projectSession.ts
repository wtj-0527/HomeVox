import type { ParseResponse } from './floorplanUi'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  type ProjectDetail,
  type ProjectSummary,
} from './projects'

export type ProjectBusy = 'list' | 'save' | 'load' | null

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
  listProjects: (signal?: AbortSignal) => Promise<ProjectSummary[]>
  getProject: (id: string, signal?: AbortSignal) => Promise<ProjectDetail>
  createProject: (
    name: string,
    document: ParseResponse,
    sourceImage: File,
    signal?: AbortSignal,
  ) => Promise<ProjectDetail>
  updateProject: (
    id: string,
    name: string,
    document: ParseResponse,
    expectedRevision: number,
    signal?: AbortSignal,
  ) => Promise<ProjectDetail>
  fetchSourceImage: (
    url: string,
    init: { signal: AbortSignal },
  ) => Promise<Response>
}

const defaultProjectSessionDependencies: ProjectSessionDependencies = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  fetchSourceImage: (url, init) => fetch(url, init),
}

export type ProjectSession = {
  projectName: string
  currentProject: ProjectDetail | null
  projects: readonly ProjectSummary[]
  projectMessage: string
  projectBusy: ProjectBusy
  setProjectName: (name: string) => void
  clearCurrentProject: () => void
  refreshProjects: () => Promise<void>
  saveProject: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  dispose: () => void
}

/** Persistence controller with request identity/abort ownership. Product and
 * editor state remain in App, but views receive only this controller's typed
 * commands rather than project API details. */
export function createProjectSession({
  document,
  geometryValidationError,
  sourceFile,
  projectName,
  currentProject,
  projects,
  onProjectSaved,
  onProjectLoaded,
  onState,
}: {
  document: () => ParseResponse | null
  geometryValidationError: () => string | null
  sourceFile: () => File | null
  projectName: () => string
  currentProject: () => ProjectDetail | null
  projects: () => readonly ProjectSummary[]
  onProjectSaved: () => void
  onProjectLoaded: (project: ProjectDetail, sourceImage: Blob) => void
  onState: (next: Partial<Pick<ProjectSession, 'projectName' | 'currentProject' | 'projects' | 'projectMessage' | 'projectBusy'>>) => void
}, dependencies: ProjectSessionDependencies = defaultProjectSessionDependencies): Omit<ProjectSession, 'projectName' | 'currentProject' | 'projects' | 'projectMessage' | 'projectBusy' | 'setProjectName' | 'clearCurrentProject'> {
  let request: Request | null = null
  let sequence = 0
  let disposed = false
  const beginRequest = (): Request | null => {
    if (disposed) return null
    request?.controller.abort()
    const next = { id: sequence + 1, controller: new AbortController() }
    sequence = next.id
    request = next
    return next
  }
  const isCurrent = (next: Request): boolean => !disposed && request?.id === next.id

  return {
    async refreshProjects() {
      const active = beginRequest()
      if (!active) return
      onState({ projectBusy: 'list' })
      try {
        const nextProjects = await dependencies.listProjects(active.controller.signal)
        if (isCurrent(active)) onState({ projects: nextProjects })
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) onState({ projectMessage: `项目列表加载失败：${error instanceof Error ? error.message : '未知错误'}` })
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    },
    async saveProject() {
      const issue = projectSaveIssue({
        document: document(),
        geometryValidationError: geometryValidationError(),
        projectName: projectName(),
        currentProject: currentProject(),
        sourceFile: sourceFile(),
      })
      if (issue) {
        onState({ projectMessage: issue })
        return
      }
      const active = beginRequest()
      if (!active) return
      const durableDocument = document()
      const existing = currentProject()
      const name = projectName()
      onState({ projectBusy: 'save', projectMessage: '' })
      try {
        const saved = existing
          ? await dependencies.updateProject(existing.id, name, durableDocument!, existing.revision, active.controller.signal)
          : await dependencies.createProject(name, durableDocument!, sourceFile()!, active.controller.signal)
        if (!isCurrent(active)) return
        onState({
          currentProject: saved,
          projectName: saved.name,
          projectMessage: existing ? '项目已保存' : '项目已创建',
          projects: [saved, ...projects().filter((item) => item.id !== saved.id)],
        })
        onProjectSaved()
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) onState({ projectMessage: `项目保存失败：${error instanceof Error ? error.message : '未知错误'}` })
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    },
    async loadProject(id: string) {
      const active = beginRequest()
      if (!active) return
      onState({ projectBusy: 'load', projectMessage: '' })
      try {
        const loaded = await dependencies.getProject(id, active.controller.signal)
        if (!isCurrent(active)) return
        const imageResponse = await dependencies.fetchSourceImage(loaded.sourceImageURL, { signal: active.controller.signal })
        if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}: 无法加载原始户型图`)
        const contentType = imageResponse.headers.get('content-type')?.toLowerCase() ?? ''
        if (!contentType.startsWith('image/')) throw new Error('原始户型图不是受支持的图片')
        const sourceImage = await imageResponse.blob()
        if (!isCurrent(active)) return
        onState({ currentProject: loaded, projectName: loaded.name, projectMessage: '项目已加载' })
        onProjectLoaded(loaded, sourceImage)
      } catch (error) {
        if (!active.controller.signal.aborted && isCurrent(active)) onState({ projectMessage: `项目加载失败：${error instanceof Error ? error.message : '未知错误'}` })
      } finally {
        if (isCurrent(active)) onState({ projectBusy: null })
      }
    },
    dispose() {
      disposed = true
      request?.controller.abort()
      request = null
    },
  }
}
