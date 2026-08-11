import { describe, expect, it } from 'vitest'
import { acknowledgeRenderedFrame, beginCanonicalGeneration, emptyThreeDGenerationState, hasCurrentThreeDGeneration, mountRendererGeneration, resolveWasmGeneration } from './threeDGeneration'

describe('canonical → WASM → renderer generation controller', () => {
  it('fails closed synchronously on a canonical transition before effects clean old resources', () => {
    let state = beginCanonicalGeneration('r1')
    state = resolveWasmGeneration(state, 'r1')
    state = mountRendererGeneration(state, 'r1')
    state = acknowledgeRenderedFrame(state, 'r1')
    expect(hasCurrentThreeDGeneration(state)).toBe(true)
    state = beginCanonicalGeneration('r2')
    expect(hasCurrentThreeDGeneration(state)).toBe(false)
    expect(mountRendererGeneration(state, 'r1')).toEqual(state)
    expect(resolveWasmGeneration(state, 'r1')).toEqual(state)
  })
  it('requires a completed frame from the mounted renderer and WASM success for the same canonical token', () => {
    let state = beginCanonicalGeneration('r3')
    state = mountRendererGeneration(state, 'r3')
    state = resolveWasmGeneration(state, 'r3')
    expect(hasCurrentThreeDGeneration(state)).toBe(false)
    expect(acknowledgeRenderedFrame(state, 'r2')).toEqual(state)
    state = acknowledgeRenderedFrame(state, 'r3')
    expect(hasCurrentThreeDGeneration(state)).toBe(true)
    expect(emptyThreeDGenerationState().canonicalToken).toBeNull()
  })
})
