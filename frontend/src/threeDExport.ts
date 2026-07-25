export function canExportCurrentThreeD({
  isExporting,
  hasModel,
  webGLAvailable,
  wasmActive,
  hasWasmGeometry,
  rendererMounted,
  rendererGeneration,
  canonicalGeneration,
}: {
  isExporting: boolean
  hasModel: boolean
  webGLAvailable: boolean
  wasmActive: boolean
  hasWasmGeometry: boolean
  rendererMounted: boolean
  rendererGeneration: number | null
  canonicalGeneration: number
}): boolean {
  return hasModel && webGLAvailable && wasmActive && hasWasmGeometry && rendererMounted && rendererGeneration === canonicalGeneration && !isExporting
}
