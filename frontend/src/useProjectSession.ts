import { useEffect, useRef, useState } from 'react'
import type { ParseResponse } from './floorplanUi'
import type { ProjectDetail, ProjectSummary } from './projects'
import { createProjectSession, type ProjectBusy, type ProjectSession } from './projectSession'

type ProjectSessionOptions = {
  document: ParseResponse | null
  geometryValidationError: string | null
  sourceFile: File | null
  onProjectSaved: () => void
  onProjectLoaded: (project: ProjectDetail, sourceImage: Blob) => void
}

type ProjectSessionState = Pick<ProjectSession, 'projectName' | 'currentProject' | 'projects' | 'projectMessage' | 'projectBusy'>

const initialState: ProjectSessionState = {
  projectName: '',
  currentProject: null,
  projects: [],
  projectMessage: '',
  projectBusy: null,
}

export type UseProjectSession = ProjectSession

/** React state boundary for durable project persistence. The stable controller
 * owns cancellation/request identity while App supplies the current canonical
 * document and applies a successfully loaded document to the editor. */
export function useProjectSession(options: ProjectSessionOptions): UseProjectSession {
  const [state, setState] = useState<ProjectSessionState>(initialState)
  const documentRef = useRef(options.document)
  const geometryErrorRef = useRef(options.geometryValidationError)
  const sourceFileRef = useRef(options.sourceFile)
  const savedRef = useRef(options.onProjectSaved)
  const loadedRef = useRef(options.onProjectLoaded)
  const stateRef = useRef(state)
  documentRef.current = options.document
  geometryErrorRef.current = options.geometryValidationError
  sourceFileRef.current = options.sourceFile
  savedRef.current = options.onProjectSaved
  loadedRef.current = options.onProjectLoaded
  stateRef.current = state

  const controllerRef = useRef<ReturnType<typeof createProjectSession> | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createProjectSession({
      document: () => documentRef.current,
      geometryValidationError: () => geometryErrorRef.current,
      sourceFile: () => sourceFileRef.current,
      projectName: () => stateRef.current.projectName,
      currentProject: () => stateRef.current.currentProject,
      projects: () => stateRef.current.projects,
      onProjectSaved: () => savedRef.current(),
      onProjectLoaded: (project, sourceImage) => loadedRef.current(project, sourceImage),
      onState: (next) => {
        setState((current) => ({ ...current, ...next }))
      },
    })
  }
  const controller = controllerRef.current

  useEffect(() => () => controller.dispose(), [controller])

  return {
    ...state,
    setProjectName: (projectName: string) => setState((current) => ({ ...current, projectName })),
    clearCurrentProject: () => setState((current) => ({ ...current, currentProject: null })),
    refreshProjects: controller.refreshProjects,
    saveProject: controller.saveProject,
    loadProject: controller.loadProject,
    dispose: controller.dispose,
  }
}

export type { ProjectBusy, ProjectDetail, ProjectSummary }
