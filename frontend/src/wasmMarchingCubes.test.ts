import { describe, expect, it } from 'vitest'
import { runMarchingCubes, type WasmBindings } from './wasmMarchingCubes'

const field = new Float32Array(8).fill(1)
const validInput = { data: field, dimensions: [2, 2, 2] as const, isoLevel: 0 }

function bindings(output: Float32Array): WasmBindings {
  return {
    default: async () => undefined,
    init: () => undefined,
    marching_cubes: () => output,
  }
}

describe('runMarchingCubes', () => {
  it('reports finite output metrics', async () => {
    const result = await runMarchingCubes(
      validInput,
      async () => bindings(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
      () => 1,
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.metrics.triangleCount).toBe(1)
      expect(result.metrics.inputBytes).toBe(32)
    }
  })

  it('rejects malformed scalar fields and non-finite output', async () => {
    const invalid = await runMarchingCubes({ ...validInput, data: new Float32Array(7) })
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid-input' })

    const nonFinite = await runMarchingCubes(
      validInput,
      async () => bindings(new Float32Array([Number.NaN, 0, 0])),
    )
    expect(nonFinite).toMatchObject({ ok: false, reason: 'invalid-output' })
  })

  it('falls back on loading failure and a call over the 50ms budget', async () => {
    const loading = await runMarchingCubes(validInput, async () => Promise.reject(new Error('offline')))
    expect(loading).toMatchObject({ ok: false, reason: 'load-failed' })

    const slow = await runMarchingCubes(
      validInput,
      async () => bindings(new Float32Array(0)),
      (() => {
        let value = 0
        return () => (value += 51)
      })(),
    )
    expect(slow).toMatchObject({ ok: false, reason: 'time-budget-exceeded' })
  })
})
