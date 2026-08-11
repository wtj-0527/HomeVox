import { useCallback, useMemo, useState } from 'react'
import type { ThreeDRenderer } from './ThreeDPreview'
import { hasCurrentThreeDGeneration } from './threeDGeneration'

export type ThreeDGenerationController = {
  geometryRevision: string | null
  renderer: ThreeDRenderer | null
  frameRevision: string | null
  isCurrent: (wasmReady: boolean) => boolean
  invalidateGeometry: () => void
  resolveGeometry: (revision: string) => void
  mountRenderer: (renderer: ThreeDRenderer) => void
  unmountRenderer: (revision: string) => void
  acknowledgeFrame: (revision: string) => void
}

/** Owns the renderer and WASM revision hand-off.  Canonical revision is an
 * input, which makes admission fail closed in the render that changes walls or
 * openings—before any asynchronous cleanup/effect can run. */
export function useThreeDGenerationController(canonicalRevision: string | null): ThreeDGenerationController {
  const [geometryRevision, setGeometryRevision] = useState<string | null>(null)
  const [renderer, setRenderer] = useState<ThreeDRenderer | null>(null)
  const [frameRevision, setFrameRevision] = useState<string | null>(null)

  const invalidateGeometry = useCallback(() => {
    setGeometryRevision(null)
    setFrameRevision(null)
  }, [])

  const resolveGeometry = useCallback((revision: string) => {
    // App only calls this after its own canonical/WASM request token check.
    // Dynamic admission below still rejects a stale token synchronously.
    setGeometryRevision(revision)
  }, [])

  const mountRenderer = useCallback((next: ThreeDRenderer) => {
    // Canvas lifecycle callbacks can flush child effects before an ancestor
    // effect. Store the callback and compare tokens in isCurrent instead.
    setRenderer(next)
    setFrameRevision(null)
  }, [])

  const unmountRenderer = useCallback((revision: string) => {
    setRenderer((current) => current?.generation === revision ? null : current)
    setFrameRevision((current) => current === revision ? null : current)
  }, [])

  const acknowledgeFrame = useCallback((revision: string) => {
    setFrameRevision(revision)
  }, [])

  const state = useMemo(() => ({
    canonicalToken: canonicalRevision,
    geometryToken: geometryRevision,
    rendererToken: renderer?.generation ?? null,
    frameToken: frameRevision,
    rendererMounted: renderer !== null,
    frameRendered: frameRevision !== null,
  }), [canonicalRevision, frameRevision, geometryRevision, renderer])

  const isCurrent = useCallback((wasmReady: boolean) => hasCurrentThreeDGeneration({
    ...state,
    wasmReady,
  }), [state])

  return {
    geometryRevision,
    renderer,
    frameRevision,
    isCurrent,
    invalidateGeometry,
    resolveGeometry,
    mountRenderer,
    unmountRenderer,
    acknowledgeFrame,
  }
}
