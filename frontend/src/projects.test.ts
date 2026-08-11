import { describe, expect, it, vi } from 'vitest'
import { createProject, fetchProjectSourceImage, getProject, isProjectDetail, updateProject } from './projects'

const capability = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const detail = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Home',
  revision: 1,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  sourceImageURL: '/api/projects/00000000-0000-0000-0000-000000000001/source-image',
  sourceImageContentType: 'image/png',
  sourceImageSize: 12,
  document: {
    filename: 'plan.png',
    contentType: 'image/png',
    size: 12,
    result: { rooms: [], walls: [], doors: [], windows: [], scale: { unit: 'px', pixel_to_unit: null }, metadata: { source: 'fixture', confidence: 0.5, image_width: 100, image_height: 80 } },
  },
}

describe('project API runtime validation', () => {
  it('accepts a complete project document and rejects incomplete durable state', () => {
    expect(isProjectDetail(detail)).toBe(true)
    expect(isProjectDetail({ ...detail, document: { ...detail.document, result: undefined } })).toBe(false)
    expect(isProjectDetail({ ...detail, sourceImageSize: 0 })).toBe(false)
		expect(isProjectDetail({ ...detail, id: 'not-a-uuid' })).toBe(false)
		expect(isProjectDetail({ ...detail, sourceImageURL: 'https://attacker.example/source-image' })).toBe(false)
		expect(isProjectDetail({ ...detail, sourceImageURL: '/api/projects/00000000-0000-0000-0000-000000000002/source-image' })).toBe(false)
  })

  it('uses the stable error envelope message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'not_found', message: 'project not found' } }), { status: 404 })))
    await expect(getProject(detail.id, capability)).rejects.toThrow('HTTP 404: project not found')
    vi.unstubAllGlobals()
  })

  it('maps revision conflict to safe user copy without leaking project identity or revisions', async () => {
    const internal = `project ${detail.id} expected revision 2, current revision 3`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'revision_conflict', message: internal } }), { status: 409 })))
    const error = await getProject(detail.id, capability).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('项目已在其他页面更新，请加载最新版本后再保存')
    expect((error as Error).message).not.toContain(detail.id)
    expect((error as Error).message).not.toMatch(/revision|HTTP 409/i)
    vi.unstubAllGlobals()
  })

  it('creates a project with the durable document and source image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...detail, capability }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const image = new File(['png'], 'plan.png', { type: 'image/png' })

    await expect(createProject('Home', detail.document, image)).resolves.toEqual({ project: detail, capability })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('name')).toBe('Home')
    expect(form.get('document')).toBe(JSON.stringify(detail.document))
    expect(form.get('source_image')).toBe(image)
    vi.unstubAllGlobals()
  })

  it('updates a loaded project using its expected revision', async () => {
	const updated = { ...detail, name: 'Home+', revision: 2 }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateProject(detail.id, capability, 'Home+', detail.document, 1)).resolves.toEqual(updated)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/projects/${detail.id}`)
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('X-HomeVox-Project-Capability')).toBe(capability)
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Home+', document: detail.document, expectedRevision: 1 })
    vi.unstubAllGlobals()
  })

  it('sends the capability header for project and source-image reads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getProject(detail.id, capability)).resolves.toEqual(detail)
    const image = await fetchProjectSourceImage(detail.sourceImageURL, capability)
    expect(image.type).toBe('image/png')
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      expect(new Headers(init.headers).get('X-HomeVox-Project-Capability')).toBe(capability)
    }
    vi.unstubAllGlobals()
  })
})
