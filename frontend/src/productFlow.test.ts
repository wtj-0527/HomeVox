import { describe, expect, it } from 'vitest'
import { canOpenStep, nextProductStep } from './productFlow'

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
})
