/** Synchronous canonical-to-WASM-to-renderer admission state. Tokens are canonical
 * content revisions, so a React effect cleanup can never briefly admit old 3D. */
export type ThreeDGenerationState = {
  canonicalToken: string | null
  geometryToken: string | null
  rendererToken: string | null
  wasmReady: boolean
  rendererMounted: boolean
}

export const emptyThreeDGenerationState = (): ThreeDGenerationState => ({
  canonicalToken: null, geometryToken: null, rendererToken: null, wasmReady: false, rendererMounted: false,
})

export function beginCanonicalGeneration(token: string | null): ThreeDGenerationState {
  return { canonicalToken: token, geometryToken: null, rendererToken: null, wasmReady: false, rendererMounted: false }
}

export function resolveWasmGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  if (!token || state.canonicalToken !== token) return state
  return { ...state, geometryToken: token, wasmReady: true }
}

export function mountRendererGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  if (!token || state.canonicalToken !== token) return state
  return { ...state, rendererToken: token, rendererMounted: true }
}

export function unmountRendererGeneration(state: ThreeDGenerationState, token: string): ThreeDGenerationState {
  return state.rendererToken === token ? { ...state, rendererToken: null, rendererMounted: false } : state
}

export function hasCurrentThreeDGeneration(state: ThreeDGenerationState): boolean {
  return Boolean(state.canonicalToken && state.wasmReady && state.rendererMounted && state.canonicalToken === state.geometryToken && state.canonicalToken === state.rendererToken)
}
