import { describe, expect, it, vi } from 'vitest'
import { getProject, isProjectDetail, listProjects } from './projects'

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
  })

  it('rejects malformed project list responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ name: 'missing fields' }]), { status: 200 })))
    await expect(listProjects()).rejects.toThrow('项目列表无效')
    vi.unstubAllGlobals()
  })

  it('uses the stable error envelope message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'not_found', message: 'project not found' } }), { status: 404 })))
    await expect(getProject(detail.id)).rejects.toThrow('HTTP 404: project not found')
    vi.unstubAllGlobals()
  })

  it('creates a project with the durable document and source image', async () => {
    const { createProject } = await import('./projects')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const image = new File(['png'], 'plan.png', { type: 'image/png' })

    await expect(createProject('Home', detail.document, image)).resolves.toEqual(detail)
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
    const { updateProject } = await import('./projects')
    const updated = { ...detail, name: 'Home+', revision: 2 }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(updateProject(detail.id, 'Home+', detail.document, 1)).resolves.toEqual(updated)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/projects/${detail.id}`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Home+', document: detail.document, expectedRevision: 1 })
    vi.unstubAllGlobals()
  })
})
