import { describe, expect, it } from 'vitest'
import { completeProductStep, canOpenStep, initialCompletedSteps, nextProductStep } from './productFlow'

describe('product flow', () => {
  it('blocks document-dependent work until a real parsed document exists', () => {
    expect(canOpenStep(1, false)).toBe(true)
    expect(canOpenStep(2, false)).toBe(true)
    expect(canOpenStep(3, false)).toBe(false)
    expect(canOpenStep(5, false)).toBe(false)
  })

  it('only advances into a real workspace after parsing', () => {
    expect(nextProductStep(2, false)).toBe(2)
    expect(nextProductStep(2, true)).toBe(3)
    expect(nextProductStep(5, true)).toBe(6)
  })

  it('records only real completion transitions and leaves a failed AI retry incomplete', () => {
    const imported = completeProductStep([], 1)
    expect(imported).toEqual([1])
    expect(imported).not.toContain(2)
    expect(completeProductStep(imported, 2)).toEqual([1, 2])
    expect(completeProductStep([1, 2, 3], 3)).toEqual([1, 2, 3])
  })

  it('initializes a reloaded saved canonical project with its known completed work', () => {
    expect(initialCompletedSteps({ hasCanonicalDocument: false, isSavedProject: false })).toEqual([])
    expect(initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: false })).toEqual([1, 2])
    expect(initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: true })).toEqual([1, 2, 6])
  })
})
