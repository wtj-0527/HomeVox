import type { ExportError, ExportFile, ExportResult } from './export'

/** Exact identities frozen for one export transaction. A matching generation
 * string is insufficient on its own: a remounted renderer for the same
 * canonical token must not complete an old canvas readback. */
export type ThreeDExportRevision<Renderer = unknown> = {
  canonicalRevision: string | null
  geometryRevision: string | null
  rendererRevision: string | null
  frameRevision: string | null
  renderer: Renderer | null
}

export type ThreeDExportOutcome =
  | { status: 'downloaded' }
  | { status: 'stale' }
  | { status: 'failure'; error: ExportError }

function matchesRevision(
  frozen: ThreeDExportRevision,
  current: ThreeDExportRevision,
): boolean {
  return frozen.canonicalRevision === current.canonicalRevision &&
    frozen.geometryRevision === current.geometryRevision &&
    frozen.rendererRevision === current.rendererRevision &&
    frozen.frameRevision === current.frameRevision &&
    frozen.renderer === current.renderer
}

/** Runs an export only while a single visible canonical/WASM/renderer frame
 * remains current. Both sides of an asynchronous `canvas.toBlob` boundary are
 * guarded so a legal edit can never download the old frame. */
export async function exportCurrentThreeDRevision<Renderer>({
  revision,
  readCurrent,
  render,
  exportPng,
  download,
  onStale,
}: {
  revision: ThreeDExportRevision<Renderer>
  readCurrent: () => ThreeDExportRevision<Renderer>
  render: () => void
  exportPng: () => Promise<ExportResult<ExportFile>>
  download: (file: ExportFile) => void
  onStale: () => void
}): Promise<ThreeDExportOutcome> {
  const stale = (): ThreeDExportOutcome => {
    onStale()
    return { status: 'stale' }
  }

  if (!matchesRevision(revision, readCurrent())) return stale()
  render()
  // `render()` is synchronous. Check immediately before the helper performs
  // its WebGL readback and begins the asynchronous canvas.toBlob operation.
  if (!matchesRevision(revision, readCurrent())) return stale()
  const result = await exportPng()
  // An edit, geometry invalidation, renderer replacement, or frame
  // invalidation can occur while toBlob is pending.
  if (!matchesRevision(revision, readCurrent())) return stale()
  if (!result.ok) return { status: 'failure', error: result.error }
  download(result.value)
  return { status: 'downloaded' }
}
