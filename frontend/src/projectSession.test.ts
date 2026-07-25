import { describe, expect, it, vi } from 'vitest'
import { createProjectSession, projectSaveIssue, type ProjectSessionDependencies } from './projectSession'
import type { ProjectDetail, ProjectSummary } from './projects'

const document = {
  filename: 'plan.png',
  contentType: 'image/png',
  size: 12,
  result: { rooms: [], walls: [], doors: [], windows: [], scale: { unit: 'px' }, metadata: { source: 'fixture' } },
}

const project: ProjectDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Home',
  revision: 2,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  sourceImageURL: '/api/projects/00000000-0000-0000-0000-000000000001/source-image',
  sourceImageContentType: 'image/png',
  sourceImageSize: 12,
  document,
}

const projectSummary: ProjectSummary = {
  id: project.id,
  name: project.name,
  revision: project.revision,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  sourceImageURL: project.sourceImageURL,
}

describe('project session save admission', () => {
  it('fails closed before persistence if the canonical document is absent or invalid', () => {
    expect(projectSaveIssue({ document: null, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('完成户型解析')
    expect(projectSaveIssue({ document, geometryValidationError: 'wall-1 长度为零', projectName: 'Home', currentProject: null, sourceFile: new File(['png'], 'plan.png') })).toContain('几何无效')
  })

  it('requires a source image only for a newly created project, never for updating a loaded project', () => {
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: ' ', currentProject: project, sourceFile: null })).toContain('项目名称')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('原始户型图')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: project, sourceFile: null })).toBeNull()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function sessionHarness({
  currentProject = null,
  sourceFile = new File(['png'], 'plan.png', { type: 'image/png' }),
  dependencies = {},
}: {
  currentProject?: ProjectDetail | null
  sourceFile?: File | null
  dependencies?: Partial<ProjectSessionDependencies>
} = {}) {
  const states: Array<Record<string, unknown>> = []
  const onProjectSaved = vi.fn()
  const onProjectLoaded = vi.fn()
  const defaults: ProjectSessionDependencies = {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue(project),
    updateProject: vi.fn().mockResolvedValue({ ...project, revision: 3 }),
    fetchSourceImage: vi.fn().mockResolvedValue(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })),
  }
  const controller = createProjectSession({
    document: () => document,
    geometryValidationError: () => null,
    sourceFile: () => sourceFile,
    projectName: () => 'Home',
    currentProject: () => currentProject,
    projects: () => [] as readonly ProjectSummary[],
    onProjectSaved,
    onProjectLoaded,
    onState: (next) => states.push(next),
  }, { ...defaults, ...dependencies })
  return { controller, states, onProjectSaved, onProjectLoaded, dependencies: { ...defaults, ...dependencies } }
}

describe('ProjectSession controller', () => {
  it('aborts the prior request and prevents a stale success from publishing over the latest request', async () => {
    const first = deferred<ProjectSummary[]>()
    const second = deferred<ProjectSummary[]>()
    const listProjects = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { controller, states } = sessionHarness({ dependencies: { listProjects } })

    const oldRequest = controller.refreshProjects()
    const oldSignal = listProjects.mock.calls[0][0] as AbortSignal
    const latestRequest = controller.refreshProjects()
    expect(oldSignal.aborted).toBe(true)

    first.resolve([{ ...projectSummary, name: 'stale project' }])
    second.resolve([projectSummary])
    await Promise.all([oldRequest, latestRequest])

    expect(states.filter((state) => 'projects' in state).at(-1)?.projects).toEqual([projectSummary])
    expect(states.some((state) => JSON.stringify(state.projects ?? []).includes('stale project'))).toBe(false)
  })

  it('does not publish a stale request error after a newer refresh succeeds', async () => {
    const first = deferred<ProjectSummary[]>()
    const second = deferred<ProjectSummary[]>()
    const listProjects = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { controller, states } = sessionHarness({ dependencies: { listProjects } })

    const oldRequest = controller.refreshProjects()
    const latestRequest = controller.refreshProjects()
    first.reject(new Error('old failure'))
    second.resolve([projectSummary])
    await Promise.all([oldRequest, latestRequest])

    expect(states.some((state) => String(state.projectMessage ?? '').includes('old failure'))).toBe(false)
    expect(states.filter((state) => 'projects' in state).at(-1)?.projects).toEqual([projectSummary])
  })

  it('aborts pending work on dispose and does not publish a late success', async () => {
    const pending = deferred<ProjectSummary[]>()
    const listProjects = vi.fn().mockReturnValue(pending.promise)
    const { controller, states } = sessionHarness({ dependencies: { listProjects } })

    const request = controller.refreshProjects()
    const signal = listProjects.mock.calls[0][0] as AbortSignal
    const stateCountBeforeDispose = states.length
    controller.dispose()
    expect(signal.aborted).toBe(true)
    pending.resolve([])
    await request

    expect(states).toHaveLength(stateCountBeforeDispose)
  })

  it('loads only a valid project with a successful image response and never fabricates a loaded callback', async () => {
    const success = sessionHarness()
    await success.controller.loadProject(project.id)
    expect(success.onProjectLoaded).toHaveBeenCalledOnce()
    expect(success.onProjectLoaded).toHaveBeenCalledWith(project, expect.any(Blob))

    const failure = sessionHarness({
      dependencies: {
        fetchSourceImage: vi.fn().mockResolvedValue(new Response('not an image', { status: 200, headers: { 'Content-Type': 'text/plain' } })),
      },
    })
    await failure.controller.loadProject(project.id)
    expect(failure.onProjectLoaded).not.toHaveBeenCalled()
    expect(failure.states.some((state) => String(state.projectMessage ?? '').includes('原始户型图不是受支持的图片'))).toBe(true)

    const unavailable = sessionHarness({
      dependencies: {
        fetchSourceImage: vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
      },
    })
    await unavailable.controller.loadProject(project.id)
    expect(unavailable.onProjectLoaded).not.toHaveBeenCalled()
    expect(unavailable.states.some((state) => String(state.projectMessage ?? '').includes('HTTP 503'))).toBe(true)
  })

  it('preserves create and update semantics and only completes after the API confirms success', async () => {
    const pendingCreate = deferred<ProjectDetail>()
    const create = sessionHarness({ dependencies: { createProject: vi.fn().mockReturnValue(pendingCreate.promise) } })
    const createRequest = create.controller.saveProject()
    expect(create.dependencies.createProject).toHaveBeenCalledWith('Home', document, expect.any(File), expect.any(AbortSignal))
    expect(create.dependencies.updateProject).not.toHaveBeenCalled()
    expect(create.onProjectSaved).not.toHaveBeenCalled()
    pendingCreate.resolve(project)
    await createRequest
    expect(create.onProjectSaved).toHaveBeenCalledOnce()

    const update = sessionHarness({ currentProject: project, sourceFile: null })
    await update.controller.saveProject()
    expect(update.dependencies.updateProject).toHaveBeenCalledWith(project.id, 'Home', document, project.revision, expect.any(AbortSignal))
    expect(update.dependencies.createProject).not.toHaveBeenCalled()
    expect(update.onProjectSaved).toHaveBeenCalledOnce()
  })
})
