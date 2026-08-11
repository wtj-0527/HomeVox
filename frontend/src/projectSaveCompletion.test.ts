import { describe, expect, it } from 'vitest'
import { completesFinalSave } from './projectSaveCompletion'

describe('final save completion ownership', () => {
  it('does not complete Step 6 when a deferred Step-3 snapshot save resolves after navigation', () => {
    const snapshotIntent = { stage: 'snapshot' as const, canonicalRevision: 'r3' }
    expect(completesFinalSave(6, 'r6', snapshotIntent)).toBe(false)
  })

  it('completes only the still-current explicit final save', () => {
    expect(completesFinalSave(6, 'r6', { stage: 'final', canonicalRevision: 'r6' })).toBe(true)
    expect(completesFinalSave(6, 'r7', { stage: 'final', canonicalRevision: 'r6' })).toBe(false)
  })
})
