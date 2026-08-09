import { describe, expect, it, vi } from 'vitest'
import {
  buildProjectResumeURL,
  consumeInitialProjectAccess,
  clearInitialProjectAccess,
  consumeProjectAccessFragment,
	storeInitialProjectAccess,
  parseProjectAccessFragment,
} from './projectAccess'

const access = {
  id: '00000000-0000-0000-0000-000000000001',
  capability: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
}

describe('project capability fragment handoff', () => {
  it('accepts only a complete UUID and 32-byte base64url capability', () => {
    expect(parseProjectAccessFragment(`#project=${access.id}&cap=${access.capability}`)).toEqual(access)
    expect(parseProjectAccessFragment(`#project=${access.id}`)).toBeNull()
    expect(parseProjectAccessFragment(`#project=${access.id}&cap=short`)).toBeNull()
    expect(parseProjectAccessFragment(`#project=not-a-uuid&cap=${access.capability}`)).toBeNull()
  })

  it('builds a transfer URL with the secret only in the fragment', () => {
    const url = buildProjectResumeURL(access, 'https://homevox.example/workspace?mode=edit')
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/workspace')
    expect(parsed.search).toBe('?mode=edit')
    expect(parsed.hash).toBe(`#project=${access.id}&cap=${access.capability}`)
    expect(`${parsed.origin}${parsed.pathname}${parsed.search}`).not.toContain(access.capability)
  })

  it('consumes and removes the fragment before any project request is made', () => {
    const replace = vi.fn()
    const result = consumeProjectAccessFragment({
      hash: `#project=${access.id}&cap=${access.capability}`,
      pathname: '/workspace',
      search: '?mode=edit',
    }, replace)

    expect(result).toEqual(access)
    expect(replace).toHaveBeenCalledWith('/workspace?mode=edit')
    expect(JSON.stringify(replace.mock.calls)).not.toContain(access.capability)
  })

  it('clears malformed project capability fragments without trying to authorize them', () => {
    const replace = vi.fn()
    const result = consumeProjectAccessFragment({
      hash: `#project=${access.id}&cap=truncated-secret`,
      pathname: '/workspace',
      search: '',
    }, replace)

    expect(result).toBeNull()
    expect(replace).toHaveBeenCalledWith('/workspace')
    expect(JSON.stringify(replace.mock.calls)).not.toContain('truncated-secret')
  })

	it('hands initial access to the persistence controller exactly once without React props', () => {
		storeInitialProjectAccess(access)
		expect(consumeInitialProjectAccess()).toEqual(access)
		expect(consumeInitialProjectAccess()).toBeNull()
	})

  it('drops both the startup access and URL fragment when the user replaces a failed project', () => {
    storeInitialProjectAccess(access)
    const replace = vi.fn()
    clearInitialProjectAccess({
      hash: `#project=${access.id}&cap=${access.capability}`,
      pathname: '/',
      search: '?e2e=instrument',
    }, replace)
    expect(consumeInitialProjectAccess()).toBeNull()
    expect(replace).toHaveBeenCalledWith('/?e2e=instrument')
  })
})
