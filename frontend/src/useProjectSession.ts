import { useEffect, useRef, useState } from 'react'
import type { ParseResponse } from './floorplanUi'
import type { ProjectDetail } from './projects'
import { createProjectSession, type ProjectBusy, type ProjectSession } from './projectSession'

type ProjectSessionOptions = {
  document: ParseResponse | null
  geometryValidationError: string | null
  sourceFile: File | null

  onProjectSaved: (project: ProjectDetail, intent: import('./projectSaveCompletion').ProjectSaveIntent) => void
  onProjectLoaded: (project: ProjectDetail, sourceImage: Blob) => void
}

type ProjectSessionState = Pick<ProjectSession, 'projectName' | 'currentProject' | 'projectMessage' | 'projectMessageTone' | 'projectBusy'>

const initialState: ProjectSessionState = {
  projectName: '',
  currentProject: null,
  projectMessage: '',
  projectMessageTone: 'success',
  projectBusy: null,
}

export type UseProjectSession = ProjectSession

/** React state boundary for durable project persistence. Capability plaintext
 * remains owned by the stable controller closure rather than React state. */
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
		initialAccess: null,
      onProjectSaved: (project, intent) => savedRef.current(project, intent),
      onProjectLoaded: (project, sourceImage) => loadedRef.current(project, sourceImage),
      onState: (next) => {
        setState((current) => ({ ...current, ...next }))
      },
    })
  }
  const controller = controllerRef.current

  useEffect(() => {
    controller.activate()
    return () => controller.dispose()
  }, [controller])

  return {
    ...state,
    setProjectName: (projectName: string) => setState((current) => ({ ...current, projectName })),
    clearCurrentProject: () => {
      controller.clearAccess()
      setState((current) => ({
        ...current,
        currentProject: null,
        projectMessage: '',
        projectMessageTone: 'success',
      }))
    },
    saveProject: controller.saveProject,
    loadProject: controller.loadProject,
		loadInitialProject: controller.loadInitialProject,
    reloadProject: controller.reloadProject,
    copyProjectResumeLink: controller.copyProjectResumeLink,
    clearAccess: controller.clearAccess,
    activate: controller.activate,
    dispose: controller.dispose,
  }
}

export type { ProjectBusy, ProjectDetail }
