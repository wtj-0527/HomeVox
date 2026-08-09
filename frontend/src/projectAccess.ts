export type ProjectAccess = {
  id: string
  capability: string
}

type FragmentLocation = Pick<Location, 'hash' | 'pathname' | 'search'>

const projectIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/

let initialProjectAccess: ProjectAccess | null = null

export function storeInitialProjectAccess(access: ProjectAccess | null): void {
	initialProjectAccess = access
}

export function clearInitialProjectAccess(location: FragmentLocation, replace: (path: string) => void): void {
  initialProjectAccess = null
  clearProjectAccessFragment(location, replace)
}

export function consumeInitialProjectAccess(): ProjectAccess | null {
	const access = initialProjectAccess
	initialProjectAccess = null
	return access
}

export function isProjectAccess(value: unknown): value is ProjectAccess {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ProjectAccess>
  return typeof candidate.id === 'string' &&
    projectIDPattern.test(candidate.id) &&
    typeof candidate.capability === 'string' &&
    capabilityPattern.test(candidate.capability)
}

export function parseProjectAccessFragment(fragment: string): ProjectAccess | null {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment)
  const access = { id: params.get('project') ?? '', capability: params.get('cap') ?? '' }
  return isProjectAccess(access) ? access : null
}

export function buildProjectResumeURL(access: ProjectAccess, baseURL: string): string {
  if (!isProjectAccess(access)) throw new Error('项目访问凭据无效')
  const url = new URL(baseURL)
  url.hash = new URLSearchParams({ project: access.id, cap: access.capability }).toString()
  return url.toString()
}

export function clearProjectAccessFragment(location: FragmentLocation, replace: (path: string) => void): void {
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash)
  if (params.has('project') || params.has('cap')) replace(`${location.pathname}${location.search}`)
}

/** Legacy helper retained for callers that intentionally consume a fragment.
 * Startup uses parseProjectAccessFragment so a failed load remains retryable. */
export function consumeProjectAccessFragment(location: FragmentLocation, replace: (path: string) => void): ProjectAccess | null {
  const access = parseProjectAccessFragment(location.hash)
  clearProjectAccessFragment(location, replace)
  return access
}
