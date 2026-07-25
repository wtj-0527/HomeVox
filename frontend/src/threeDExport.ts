export function canExportCurrentThreeD({
  isExporting,
  hasModel,
  webGLAvailable,
  wasmActive,
  hasWasmGeometry,
  rendererMounted,
  rendererGeneration,
  geometryGeneration,
  canonicalGeneration,
}: {
  isExporting: boolean
  hasModel: boolean
  webGLAvailable: boolean
  wasmActive: boolean
  hasWasmGeometry: boolean
  rendererMounted: boolean
  rendererGeneration: string | null
  geometryGeneration: string | null
  canonicalGeneration: string | null
}): boolean {
  return hasModel && webGLAvailable && wasmActive && hasWasmGeometry && rendererMounted && canonicalGeneration !== null && canonicalGeneration === geometryGeneration && canonicalGeneration === rendererGeneration && !isExporting
}
