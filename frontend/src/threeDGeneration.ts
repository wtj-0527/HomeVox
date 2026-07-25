/** Synchronous canonical-to-WASM-to-renderer admission state. Tokens are canonical
 * content revisions, so a React effect cleanup can never briefly admit old 3D. */
export type ThreeDGenerationState = {
  canonicalToken: string | null
  geometryToken: string | null
  rendererToken: string | null
  frameToken: string | null
  wasmReady: boolean
  rendererMounted: boolean
  frameRendered: boolean
}

export const emptyThreeDGenerationState = (): ThreeDGenerationState => ({
  canonicalToken: null, geometryToken: null, rendererToken: null, frameToken: null, wasmReady: false, rendererMounted: false, frameRendered: false,
})

export function beginCanonicalGeneration(token: string | null): ThreeDGenerationState {
  return { canonicalToken: token, geometryToken: null, rendererToken: null, frameToken: null, wasmReady: false, rendererMounted: false, frameRendered: false }
}

export function resolveWasmGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  if (!token || state.canonicalToken !== token) return state
  return { ...state, geometryToken: token, wasmReady: true }
}

export function mountRendererGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  if (!token || state.canonicalToken !== token) return state
  return { ...state, rendererToken: token, rendererMounted: true }
}

/** A mounted R3F root is insufficient: an export/step completion can only use
 * a generation after that root has completed a frame for the same revision. */
export function acknowledgeRenderedFrame(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  if (!token || state.canonicalToken !== token || state.rendererToken !== token) return state
  return { ...state, frameToken: token, frameRendered: true }
}

export function unmountRendererGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  return state.rendererToken === token
    ? { ...state, rendererToken: null, frameToken: null, rendererMounted: false, frameRendered: false }
    : state
}

export function hasCurrentThreeDGeneration(state: ThreeDGenerationState): boolean {
  return Boolean(
    state.canonicalToken &&
    state.wasmReady &&
    state.rendererMounted &&
    state.frameRendered &&
    state.canonicalToken === state.geometryToken &&
    state.canonicalToken === state.rendererToken &&
    state.canonicalToken === state.frameToken,
  )
}
