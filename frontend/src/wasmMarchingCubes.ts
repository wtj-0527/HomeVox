export const MAX_VOXELS = 32 * 32 * 32
export const MAX_OUTPUT_FLOATS = 1_000_000
export const MAX_CALL_MS = 50

export type WasmFallbackReason =
  | 'empty-model'
  | 'invalid-input'
  | 'budget-exceeded'
  | 'load-failed'
  | 'invalid-output'
  | 'time-budget-exceeded'

export type MarchingCubesInput = {
  data: Float32Array
  dimensions: readonly [number, number, number]
  isoLevel: number
}

export type MarchingCubesMetrics = {
  grid: readonly [number, number, number]
  inputBytes: number
  outputBytes: number
  vertexCount: number
  triangleCount: number
  elapsedMs: number
}

export type MarchingCubesResult =
  | { ok: true; vertices: Float32Array; metrics: MarchingCubesMetrics }
  | { ok: false; reason: WasmFallbackReason; detail: string }

export type WasmBindings = {
  default: () => Promise<unknown>
  init: () => void
  marching_cubes: (
    data: Float32Array,
    nx: number,
    ny: number,
    nz: number,
    isoLevel: number,
  ) => Float32Array
}

type Loader = () => Promise<WasmBindings>

let bindingsPromise: Promise<WasmBindings> | null = null

function validDimensions(dimensions: readonly number[]): boolean {
  return dimensions.length === 3 &&
    dimensions.every((value) => Number.isInteger(value) && value >= 2 && value <= 32)
}

function validate(input: MarchingCubesInput): string | null {
  if (!validDimensions(input.dimensions)) return 'grid dimensions must be finite integers from 2 through 32'
  const voxels = input.dimensions[0] * input.dimensions[1] * input.dimensions[2]
  if (!Number.isSafeInteger(voxels) || voxels > MAX_VOXELS) return 'voxel budget exceeded'
  if (input.data.length !== voxels || !Array.from(input.data).every(Number.isFinite)) {
    return 'scalar field must exactly match the grid and contain only finite values'
  }
  if (!Number.isFinite(input.isoLevel)) return 'iso level must be finite'
  return null
}

async function loadBindings(): Promise<WasmBindings> {
  if (!bindingsPromise) {
    bindingsPromise = import('../../wasm/pkg/homevox_wasm')
      .then(async (module) => {
        const bindings = module as unknown as WasmBindings
        await bindings.default()
        bindings.init()
        return bindings
      })
      .catch((error) => {
        bindingsPromise = null
        throw error
      })
  }
  return bindingsPromise
}

export async function runMarchingCubes(
  input: MarchingCubesInput,
  loader: Loader = loadBindings,
  now: () => number = performance.now.bind(performance),
): Promise<MarchingCubesResult> {
  const validationError = validate(input)
  if (validationError) {
    return { ok: false, reason: input.data.length === 0 ? 'empty-model' : 'invalid-input', detail: validationError }
  }

  const [nx, ny, nz] = input.dimensions
  try {
    const bindings = await loader()
    const started = now()
    const vertices = bindings.marching_cubes(input.data, nx, ny, nz, input.isoLevel)
    const elapsedMs = now() - started
    if (elapsedMs > MAX_CALL_MS) {
      return { ok: false, reason: 'time-budget-exceeded', detail: `WASM call took ${elapsedMs.toFixed(1)}ms` }
    }
    if (
      !(vertices instanceof Float32Array) ||
      vertices.length % 9 !== 0 ||
      vertices.length > MAX_OUTPUT_FLOATS ||
      !Array.from(vertices).every(Number.isFinite)
    ) {
      return { ok: false, reason: 'invalid-output', detail: 'WASM returned malformed, non-finite, or oversized vertices' }
    }
    return {
      ok: true,
      vertices,
      metrics: {
        grid: [nx, ny, nz],
        inputBytes: input.data.byteLength,
        outputBytes: vertices.byteLength,
        vertexCount: vertices.length / 3,
        triangleCount: vertices.length / 9,
        elapsedMs,
      },
    }
  } catch (error) {
    return { ok: false, reason: 'load-failed', detail: error instanceof Error ? error.message : 'WASM loading failed' }
  }
}
