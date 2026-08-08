import { describe, expect, it } from 'vitest'
import { completeProductStep, canOpenStep, initialCompletedSteps, nextProductStep, type ProductFlowContext } from './productFlow'

const context = (completed: number[], extra: Partial<ProductFlowContext> = {}): ProductFlowContext => ({
  completed: completed as ProductFlowContext['completed'],
  hasDocument: true,
  hasCanonicalGeometry: true,
  hasThreeDGeometry: true,
  ...extra,
})

describe('product flow', () => {
  it('uses explicit completion transitions as the single navigation guard', () => {
    expect(canOpenStep(1, context([]))).toBe(true)
    expect(canOpenStep(2, context([]))).toBe(false)
    expect(canOpenStep(2, context([1]))).toBe(true)
    expect(canOpenStep(3, context([1]))).toBe(false)
    expect(canOpenStep(3, context([1, 2]))).toBe(true)
    expect(canOpenStep(4, context([1, 2]))).toBe(false)
    expect(canOpenStep(4, context([1, 2, 3]))).toBe(true)
    expect(canOpenStep(5, context([1, 2, 3, 4], { hasThreeDGeometry: false }))).toBe(false)
    expect(canOpenStep(5, context([1, 2, 3, 4]))).toBe(true)
    expect(canOpenStep(6, context([1, 2, 3, 4]))).toBe(false)
    expect(canOpenStep(6, context([1, 2, 3, 4, 5]))).toBe(true)
  })

  it('does not allow an available document to bypass review transitions', () => {
    expect(nextProductStep(2, context([1], { hasDocument: true }))).toBe(2)
    expect(nextProductStep(3, context([1, 2]))).toBe(3)
    expect(nextProductStep(4, context([1, 2, 3]))).toBe(4)
  })

  it('records only real completion transitions and leaves a failed AI retry incomplete', () => {
    const imported = completeProductStep([], 1)
    expect(imported).toEqual([1])
    expect(imported).not.toContain(2)
    expect(completeProductStep(imported, 2)).toEqual([1, 2])
  })

  it('restores only facts proven by a saved canonical project', () => {
    expect(initialCompletedSteps({ hasCanonicalDocument: false, isSavedProject: false })).toEqual([])
    expect(initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: false })).toEqual([1, 2])
    expect(initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: true })).toEqual([1, 2])
    expect(canOpenStep(4, context([1, 2, 6]))).toBe(false)
  })
})

import { canApplyProductFlowEvent, transitionProductFlow } from './productFlow'
describe('ProductFlowController', () => {
  it('does not let completion bypass the same current-generation guard used by sidebar navigation', () => {
    const state = { activeStep: 4 as const, completed: [1, 2, 3, 4] as ProductFlowContext['completed'] }
    const stale = transitionProductFlow(state, { type: 'complete', step: 4, next: 5 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })
    expect(stale).toEqual(state)
    expect(transitionProductFlow({ activeStep: 3, completed: [1, 2, 3] }, { type: 'complete', step: 4, next: 5 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: true })).toEqual({ activeStep: 3, completed: [1, 2, 3] })
    expect(transitionProductFlow({ activeStep: 1, completed: [] }, { type: 'reload', completed: [1, 2] }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })).toEqual({ activeStep: 1, completed: [1, 2] })
  })

  it('uses the same event admission to disable Step 5 completion when its renderer becomes stale', () => {
    const state = { activeStep: 5 as const, completed: [1, 2, 3, 4] as ProductFlowContext['completed'] }
    expect(canApplyProductFlowEvent(state, { type: 'open', step: 5 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })).toBe(false)
    expect(canApplyProductFlowEvent(state, { type: 'complete', step: 5, next: 6 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })).toBe(false)
    expect(canApplyProductFlowEvent(state, { type: 'complete', step: 5, next: 6 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: true })).toBe(true)
  })
})
