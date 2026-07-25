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
  if (!currentProject && !sourceFile) return '创建项目需要原始户型图'
  return null
}

type Request = { id: number; controller: AbortController }

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
}): Omit<ProjectSession, 'projectName' | 'currentProject' | 'projects' | 'projectMessage' | 'projectBusy' | 'setProjectName' | 'clearCurrentProject'> {
  let request: Request | null = null
  let sequence = 0
  const beginRequest = (): Request => {
    request?.controller.abort()
    const next = { id: sequence + 1, controller: new AbortController() }
    sequence = next.id
    request = next
    return next
  }
  const isCurrent = (next: Request): boolean => request?.id === next.id

  return {
    async refreshProjects() {
      const active = beginRequest()
      onState({ projectBusy: 'list' })
      try {
        const projects = await listProjects(active.controller.signal)
        if (isCurrent(active)) onState({ projects })
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
      const durableDocument = document()
      const existing = currentProject()
      const name = projectName()
      onState({ projectBusy: 'save', projectMessage: '' })
      try {
        const saved = existing
          ? await updateProject(existing.id, name, durableDocument!, existing.revision, active.controller.signal)
          : await createProject(name, durableDocument!, sourceFile()!, active.controller.signal)
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
      onState({ projectBusy: 'load', projectMessage: '' })
      try {
        const loaded = await getProject(id, active.controller.signal)
        const imageResponse = await fetch(loaded.sourceImageURL, { signal: active.controller.signal })
        if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}: 无法加载原始户型图`)
        const sourceImage = await imageResponse.blob()
        if (!sourceImage.type.startsWith('image/')) throw new Error('原始户型图不是受支持的图片')
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
      request?.controller.abort()
      request = null
    },
  }
}
