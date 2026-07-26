import { isParseResponse, type ParseResponse } from './floorplanUi'

export const PROJECT_CAPABILITY_HEADER = 'X-HomeVox-Project-Capability'
const projectIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ProjectSummary = {
  id: string
  name: string
  revision: number
  createdAt: string
  updatedAt: string
  sourceImageURL: string
}

export type ProjectDetail = ProjectSummary & {
  document: ParseResponse
  sourceImageContentType: string
  sourceImageSize: number
}

export type CreatedProject = {
  project: ProjectDetail
  capability: string
}

type ErrorEnvelope = { error?: { code?: unknown; message?: unknown } | unknown }

export class ProjectAPIError extends Error {
  readonly code: string | null
  constructor(code: string | null, message: string) {
    super(message)
    this.name = 'ProjectAPIError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    projectIDPattern.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    value.sourceImageURL === `/api/projects/${value.id}/source-image`
}

export function isProjectDetail(value: unknown): value is ProjectDetail {
  if (!isProjectSummary(value) || !isRecord(value)) return false
  const record: Record<string, unknown> = value
  return isParseResponse(record.document) &&
    typeof record.sourceImageContentType === 'string' &&
    typeof record.sourceImageSize === 'number' &&
    Number.isFinite(record.sourceImageSize) &&
    record.sourceImageSize > 0
}

function isCreatedProject(value: unknown): value is ProjectDetail & { capability: string } {
  if (!isProjectDetail(value) || !isRecord(value)) return false
  const capability = (value as Record<string, unknown>).capability
  return typeof capability === 'string' && /^[A-Za-z0-9_-]{43}$/.test(capability)
}

function capabilityHeaders(capability: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  result.set(PROJECT_CAPABILITY_HEADER, capability)
  return result
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text()
  let body: ErrorEnvelope | null = null
  try {
    body = text ? JSON.parse(text) as ErrorEnvelope : null
  } catch {
    // Keep a useful error when an intermediary returned non-JSON.
  }
  const code = isRecord(body?.error) && typeof body.error.code === 'string' ? body.error.code : null
  if (response.status === 409 && code === 'revision_conflict') {
    return new ProjectAPIError(code, '项目已在其他页面更新，请加载最新版本后再保存')
  }
  const message = isRecord(body?.error) && typeof body.error.message === 'string'
    ? body.error.message
    : text.trim() || response.statusText || '请求失败'
  return new ProjectAPIError(code, `HTTP ${response.status}: ${message}`)
}

async function parseJSON(response: Response): Promise<unknown> {
  if (!response.ok) throw await responseError(response)
  return response.json()
}

export async function getProject(id: string, capability: string, signal?: AbortSignal): Promise<ProjectDetail> {
  const body = await parseJSON(await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    headers: capabilityHeaders(capability),
    signal,
  }))
  if (!isProjectDetail(body)) throw new Error('服务返回的项目文档无效')
  return body
}

export async function createProject(name: string, document: ParseResponse, sourceImage: File, signal?: AbortSignal): Promise<CreatedProject> {
  const form = new FormData()
  form.append('name', name)
  form.append('document', JSON.stringify(document))
  form.append('source_image', sourceImage)
  const body = await parseJSON(await fetch('/api/projects', { method: 'POST', body: form, signal }))
  if (!isCreatedProject(body)) throw new Error('服务返回的已创建项目无效')
  const { capability, ...project } = body
  return { project, capability }
}

export async function updateProject(id: string, capability: string, name: string, document: ParseResponse, expectedRevision: number, signal?: AbortSignal): Promise<ProjectDetail> {
  const body = await parseJSON(await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: capabilityHeaders(capability, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, document, expectedRevision }),
    signal,
  }))
  if (!isProjectDetail(body)) throw new Error('服务返回的已保存项目无效')
  return body
}

export async function fetchProjectSourceImage(url: string, capability: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { headers: capabilityHeaders(capability), signal })
  if (!response.ok) throw await responseError(response)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('image/')) throw new Error('原始户型图不是受支持的图片')
  return response.blob()
}
