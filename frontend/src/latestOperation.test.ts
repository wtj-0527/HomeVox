import { describe, expect, it } from 'vitest'
import { LatestOperation } from './latestOperation'

describe('LatestOperation', () => {
  it('invalidates an older operation before its asynchronous work completes', () => {
    const operations = new LatestOperation()
    const older = operations.begin()
    expect(older.isCurrent()).toBe(true)
    const newer = operations.begin()
    expect(older.isCurrent()).toBe(false)
    expect(newer.isCurrent()).toBe(true)
  })

  it('invalidates the current operation when the source changes', () => {
    const operations = new LatestOperation()
    const active = operations.begin()
    operations.invalidate()
    expect(active.isCurrent()).toBe(false)
  })

  it('invalidates work during an effect cleanup without disabling the remounted instance', () => {
    const operations = new LatestOperation()
    const active = operations.begin()
    operations.invalidate()
    expect(active.isCurrent()).toBe(false)
    expect(operations.begin().isCurrent()).toBe(true)
  })
})