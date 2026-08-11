import { describe, expect, it } from 'vitest'
import { canonicalRevisionToken } from './floorplanSession'

describe('floorplan project session', () => {
  it('changes the synchronous canonical token for wall and opening commits and clears invalid geometry', () => {
    const walls = [{ id: 'wall-1', x1: 0, y1: 0, x2: 100, y2: 0 }]
    const first = canonicalRevisionToken(walls, [], true)
    expect(canonicalRevisionToken([{ ...walls[0], x2: 110 }], [], true)).not.toBe(first)
    expect(canonicalRevisionToken(walls, [{ id: 'door-1', kind: 'door', wallId: 'wall-1', position: 0.5, width: 20 }], true)).not.toBe(first)
    expect(canonicalRevisionToken(walls, [], false)).toBeNull()
  })
})
