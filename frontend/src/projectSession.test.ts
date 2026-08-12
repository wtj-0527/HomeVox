import { describe, expect, it, vi } from 'vitest'
import { createProjectSession, projectSaveIssue, type ProjectSessionDependencies } from './projectSession'
import { storeInitialProjectAccess, type ProjectAccess } from './projectAccess'
import { ProjectAPIError, type ProjectDetail } from './projects'
import type { ParseResponse } from './floorplanUi'

const capability = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const access: ProjectAccess = { id: '00000000-0000-0000-0000-000000000001', capability }

const document: ParseResponse = {
  filename: 'plan.png',
  contentType: 'image/png',
  size: 3,
  result: { rooms: [], walls: [], doors: [], windows: [], scale: { unit: 'px', pixel_to_unit: null }, metadata: { source: 'fixture', confidence: 0.5, image_width: 100, image_height: 80 } },
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


describe('project session save admission', () => {
  it('fails closed before persistence if the canonical document is absent or invalid', () => {
    expect(projectSaveIssue({ document: null, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('完成户型解析')
    expect(projectSaveIssue({ document, geometryValidationError: 'wall-1 长度为零', projectName: 'Home', currentProject: null, sourceFile: new File(['png'], 'plan.png') })).toContain('几何无效')
  })

  it('requires a source image only for a newly created project, never for updating a loaded project', () => {
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: ' ', currentProject: project, sourceFile: null })).toContain('项目名称')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('有效裁切')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: new File(['original'], 'original.png', { type: 'image/png' }) })).toContain('有效裁切图一致')
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
  initialAccess = currentProject ? access : null,
  currentDocument = () => document,
  dependencies = {},
}: {
  currentProject?: ProjectDetail | null
  sourceFile?: File | null
  initialAccess?: ProjectAccess | null
  currentDocument?: () => ParseResponse
  dependencies?: Partial<ProjectSessionDependencies>
} = {}) {
  const states: Array<Record<string, unknown>> = []
  const onProjectSaved = vi.fn()
  const onProjectLoaded = vi.fn()
  const onProjectConflictResolved = vi.fn()
  const defaults: ProjectSessionDependencies = {
    getProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue({ project, capability }),
    updateProject: vi.fn().mockResolvedValue({ ...project, revision: 3 }),
    fetchSourceImage: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
  }
  const controller = createProjectSession({
    document: currentDocument,
    geometryValidationError: () => null,
    sourceFile: () => sourceFile,
    projectName: () => 'Home',
    currentProject: () => currentProject,
    initialAccess,
    onProjectSaved,
    onProjectLoaded,
    onProjectConflictResolved,
    onState: (next) => states.push(next),
  }, { ...defaults, ...dependencies })
  return { controller, states, onProjectSaved, onProjectLoaded, onProjectConflictResolved, dependencies: { ...defaults, ...dependencies } }
}

describe('ProjectSession controller', () => {
  it('loads only a valid project with a successful image response and never fabricates a loaded callback', async () => {
    const success = sessionHarness()
    await success.controller.loadProject(access)
    expect(success.onProjectLoaded).toHaveBeenCalledOnce()
    expect(success.onProjectLoaded).toHaveBeenCalledWith(project, expect.any(Blob))
    expect(success.dependencies.getProject).toHaveBeenCalledWith(project.id, capability, expect.any(AbortSignal))
    expect(success.dependencies.fetchSourceImage).toHaveBeenCalledWith(project.sourceImageURL, capability, expect.any(AbortSignal))

    const failure = sessionHarness({
      dependencies: {
        fetchSourceImage: vi.fn().mockRejectedValue(new Error('原始户型图不是受支持的图片')),
      },
    })
    await failure.controller.loadProject(access)
    expect(failure.onProjectLoaded).not.toHaveBeenCalled()
    expect(failure.states.some((state) => String(state.projectMessage ?? '').includes('原始户型图不是受支持的图片'))).toBe(true)

    const unavailable = sessionHarness({
      dependencies: {
        fetchSourceImage: vi.fn().mockRejectedValue(new Error('HTTP 503: 无法加载原始户型图')),
      },
    })
    await unavailable.controller.loadProject(access)
    expect(unavailable.onProjectLoaded).not.toHaveBeenCalled()
    expect(unavailable.states.some((state) => String(state.projectMessage ?? '').includes('HTTP 503'))).toBe(true)
  })

  it('preserves create and update semantics and only completes after the API confirms success', async () => {
    const pendingCreate = deferred<{ project: ProjectDetail; capability: string }>()
    const create = sessionHarness({ dependencies: { createProject: vi.fn().mockReturnValue(pendingCreate.promise) } })
    const createRequest = create.controller.saveProject()
    expect(create.dependencies.createProject).toHaveBeenCalledWith('Home', document, expect.any(File), expect.any(AbortSignal))
    const uploaded = (create.dependencies.createProject as ReturnType<typeof vi.fn>).mock.calls[0][2] as File
    expect([uploaded.name, uploaded.type, uploaded.size]).toEqual([document.filename, document.contentType, document.size])
    expect(create.dependencies.updateProject).not.toHaveBeenCalled()
    expect(create.onProjectSaved).not.toHaveBeenCalled()
    pendingCreate.resolve({ project, capability })
    await createRequest
    expect(create.onProjectSaved).toHaveBeenCalledOnce()
    expect(create.onProjectSaved).toHaveBeenCalledWith(project, { stage: 'snapshot', canonicalRevision: null })

    const update = sessionHarness({ currentProject: project, sourceFile: null })
    await update.controller.saveProject()
    expect(update.dependencies.updateProject).toHaveBeenCalledWith(project.id, capability, 'Home', document, project.revision, expect.any(AbortSignal))
    expect(update.dependencies.createProject).not.toHaveBeenCalled()
    expect(update.onProjectSaved).toHaveBeenCalledOnce()
    expect(update.onProjectSaved).toHaveBeenCalledWith({ ...project, revision: 3 }, { stage: 'snapshot', canonicalRevision: null })
  })


  it('preserves the save intent captured at request start across a deferred response', async () => {
    const pending = deferred<ProjectDetail>()
    const update = sessionHarness({
      currentProject: project,
      sourceFile: null,
      dependencies: { updateProject: vi.fn().mockReturnValue(pending.promise) },
    })
    const request = update.controller.saveProject({ stage: 'snapshot', canonicalRevision: 'step-3-revision' })
    pending.resolve({ ...project, revision: 3 })
    await request
    expect(update.onProjectSaved).toHaveBeenCalledWith(
      { ...project, revision: 3 },
      { stage: 'snapshot', canonicalRevision: 'step-3-revision' },
    )
  })

  it('serializes automatic saves and persists only the latest queued canonical intent', async () => {
    const first = deferred<ProjectDetail>()
    const documents = [
      { ...document, result: { ...document.result, walls: [{ id: 'wall-a', x1: 0, y1: 0, x2: 40, y2: 0 }] } },
      { ...document, result: { ...document.result, walls: [{ id: 'wall-a', x1: 0, y1: 0, x2: 60, y2: 0 }] } },
      { ...document, result: { ...document.result, walls: [{ id: 'wall-a', x1: 0, y1: 0, x2: 80, y2: 0 }] } },
    ]
    let currentDocument = documents[0]
    const updateProject = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...project, revision: 4, document: documents[2] })
    const update = sessionHarness({
      currentProject: project,
      sourceFile: null,
      currentDocument: () => currentDocument,
      dependencies: { updateProject },
    })

    const firstSave = update.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'wall-40' })
    currentDocument = documents[1]
    const superseded = update.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'wall-60' })
    currentDocument = documents[2]
    const latest = update.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'wall-80' })

    expect(updateProject).toHaveBeenCalledTimes(1)
    expect(updateProject.mock.calls[0][4]).toBe(2)
    first.resolve({ ...project, revision: 3, document: documents[0] })
    await Promise.all([firstSave, superseded, latest])

    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(updateProject.mock.calls[1][3]).toEqual(documents[2])
    expect(updateProject.mock.calls[1][4]).toBe(3)
    expect(update.onProjectSaved).toHaveBeenLastCalledWith(
      { ...project, revision: 4, document: documents[2] },
      { stage: 'snapshot', canonicalRevision: 'wall-80' },
    )
    expect(update.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectSaveState: 'saving' }),
      expect.objectContaining({ projectSaveState: 'saved' }),
    ]))
  })

  it('fails closed on an automatic-save revision conflict and retries the same latest intent explicitly', async () => {
    const updateProject = vi.fn()
      .mockRejectedValueOnce(new ProjectAPIError('revision_conflict', '项目已在其他页面更新，请加载最新版本后再保存'))
      .mockResolvedValueOnce({ ...project, revision: 3 })
    const update = sessionHarness({
      currentProject: project,
      sourceFile: null,
      dependencies: { updateProject },
    })

    await update.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'conflicted' })
    expect(update.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectSaveState: 'conflict' }),
    ]))
    expect(update.onProjectSaved).not.toHaveBeenCalled()

    await update.controller.retryProjectSave()
    expect(updateProject).toHaveBeenCalledTimes(2)
    expect(update.onProjectSaved).toHaveBeenCalledWith(
      { ...project, revision: 3 },
      { stage: 'snapshot', canonicalRevision: 'conflicted' },
    )
  })

  it('preserves the latest local intent and resolves a conflict with explicit local, remote, or merged versions', async () => {
    const localDocument = {
      ...document,
      result: { ...document.result, walls: [{ id: 'wall-a', x1: 91, y1: 0, x2: 40, y2: 0 }] },
    }
    const remoteDocument = {
      ...document,
      result: {
        ...document.result,
        walls: [
          { id: 'wall-a', x1: 90, y1: 0, x2: 40, y2: 0 },
          { id: 'wall-remote', x1: 40, y1: 0, x2: 40, y2: 30 },
        ],
      },
    }
    const remote = { ...project, revision: 3, document: remoteDocument }
    const savedLocal = { ...project, revision: 4, document: localDocument }
    const updateProject = vi.fn()
      .mockRejectedValueOnce(new ProjectAPIError('revision_conflict', '项目已在其他页面更新，请选择冲突版本'))
      .mockResolvedValueOnce(savedLocal)
    const conflict = sessionHarness({
      currentProject: project,
      sourceFile: null,
      currentDocument: () => localDocument,
      dependencies: {
        getProject: vi.fn().mockResolvedValue(remote),
        updateProject,
      },
    })
    await conflict.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'local-91' })
    expect(conflict.states.at(-2)).toMatchObject({ projectMessage: '项目已在其他页面更新，请选择本地版本、远端版本或生成合并版本', projectSaveState: 'conflict' })
    expect(JSON.stringify(conflict.states)).not.toContain(project.id)

    await conflict.controller.resolveProjectConflict('local')
    expect(conflict.dependencies.getProject).toHaveBeenCalledWith(project.id, capability, expect.any(AbortSignal))
    expect(updateProject).toHaveBeenLastCalledWith(project.id, capability, 'Home', localDocument, remote.revision, expect.any(AbortSignal))
    expect(conflict.onProjectSaved).toHaveBeenCalledWith(savedLocal, { stage: 'snapshot', canonicalRevision: 'local-91' })

    const remoteChoice = sessionHarness({
      currentProject: project,
      sourceFile: null,
      currentDocument: () => localDocument,
      dependencies: {
        getProject: vi.fn().mockResolvedValue(remote),
        updateProject: vi.fn().mockRejectedValueOnce(new ProjectAPIError('revision_conflict', 'conflict')),
      },
    })
    await remoteChoice.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'local-91' })
    await remoteChoice.controller.resolveProjectConflict('remote')
    expect(remoteChoice.onProjectLoaded).toHaveBeenCalledWith(remote, expect.any(Blob))

    const merged = { ...remote, revision: 4 }
    const mergeUpdate = vi.fn()
      .mockRejectedValueOnce(new ProjectAPIError('revision_conflict', 'conflict'))
      .mockResolvedValueOnce(merged)
    const mergeChoice = sessionHarness({
      currentProject: project,
      sourceFile: null,
      currentDocument: () => localDocument,
      dependencies: { getProject: vi.fn().mockResolvedValue(remote), updateProject: mergeUpdate },
    })
    await mergeChoice.controller.queueAutoSave({ stage: 'snapshot', canonicalRevision: 'local-91' })
    await mergeChoice.controller.resolveProjectConflict('merge')
    const mergedDocument = mergeUpdate.mock.calls[1][3] as ParseResponse
    expect(mergedDocument.result.walls).toEqual([
      localDocument.result.walls[0],
      remoteDocument.result.walls[1],
    ])
    expect(mergeUpdate.mock.calls[1][4]).toBe(remote.revision)
    expect(mergeChoice.onProjectConflictResolved).toHaveBeenCalledWith(merged, 'merge')
  })


  it('copies the resume link through an injected writer and reports success without publishing the capability', async () => {
    const create = sessionHarness()
    await create.controller.saveProject()
    const writeText = vi.fn().mockResolvedValue(undefined)
    await create.controller.copyProjectResumeLink('https://homevox.example/workspace', writeText)
    expect(writeText).toHaveBeenCalledWith(`https://homevox.example/workspace#project=${project.id}&cap=${capability}`)
    expect(create.states.at(-1)).toMatchObject({ projectMessage: '继续编辑链接已复制，请妥善保管', projectMessageTone: 'success' })
    expect(JSON.stringify(create.states)).not.toContain(capability)
  })

  it('reactivates after a StrictMode cleanup without losing the private capability', async () => {
    const resumed = sessionHarness({ currentProject: project, sourceFile: null })
    resumed.controller.dispose()
    resumed.controller.activate()
    await resumed.controller.reloadProject()
    expect(resumed.dependencies.getProject).toHaveBeenCalledWith(project.id, capability, expect.any(AbortSignal))
    expect(resumed.onProjectLoaded).toHaveBeenCalledWith(project, expect.any(Blob))
  })

	it('consumes an initial vaulted capability once and retries only when StrictMode cleanup aborts it', async () => {
		storeInitialProjectAccess(access)
		const pending = deferred<ProjectDetail>()
		const resumed = sessionHarness({
			initialAccess: null,
			dependencies: { getProject: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(project) },
		})
		const first = resumed.controller.loadInitialProject()
		resumed.controller.dispose()
		resumed.controller.activate()
		const second = resumed.controller.loadInitialProject()
		pending.resolve(project)
		await Promise.all([first, second])
		expect(resumed.onProjectLoaded).toHaveBeenCalledOnce()
		await resumed.controller.loadInitialProject()
		expect(resumed.dependencies.getProject).toHaveBeenCalledTimes(2)
	})

  it('retains the initial capability after a transient metadata or source-image failure so it can retry', async () => {
    const resumed = sessionHarness({ initialAccess: access, dependencies: { getProject: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(project) } })
    await resumed.controller.loadInitialProject()
    await resumed.controller.reloadProject()
    expect(resumed.onProjectLoaded).toHaveBeenCalledOnce()
    const imageFailure = sessionHarness({ initialAccess: access, dependencies: { fetchSourceImage: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(new Blob(['png'])) } })
    await imageFailure.controller.loadInitialProject()
    await imageFailure.controller.reloadProject()
    expect(imageFailure.onProjectLoaded).toHaveBeenCalledOnce()
  })

  it('invalidates pending load, create, and update work when project access is cleared', async () => {
    const pendingLoad = deferred<ProjectDetail>()
    const load = sessionHarness({ dependencies: { getProject: vi.fn().mockReturnValue(pendingLoad.promise) } })
    const loadRequest = load.controller.loadProject(access)
    load.controller.clearAccess()
    pendingLoad.resolve(project)
    await loadRequest
    expect(load.onProjectLoaded).not.toHaveBeenCalled()
    expect(load.dependencies.fetchSourceImage).not.toHaveBeenCalled()

    const pendingCreate = deferred<{ project: ProjectDetail; capability: string }>()
    const create = sessionHarness({ dependencies: { createProject: vi.fn().mockReturnValue(pendingCreate.promise) } })
    const createRequest = create.controller.saveProject()
    create.controller.clearAccess()
    pendingCreate.resolve({ project, capability })
    await createRequest
    expect(create.onProjectSaved).not.toHaveBeenCalled()
    const writeText = vi.fn().mockResolvedValue(undefined)
    await create.controller.copyProjectResumeLink('https://homevox.example/workspace', writeText)
    expect(writeText).toHaveBeenCalledWith(`https://homevox.example/workspace#project=${project.id}&cap=${capability}`)

    const pendingUpdate = deferred<ProjectDetail>()
    const update = sessionHarness({
      currentProject: project,
      sourceFile: null,
      dependencies: { updateProject: vi.fn().mockReturnValue(pendingUpdate.promise) },
    })
    const updateRequest = update.controller.saveProject()
    update.controller.clearAccess()
    pendingUpdate.resolve({ ...project, revision: 3 })
    await updateRequest
    expect(update.onProjectSaved).not.toHaveBeenCalled()
  })
})
