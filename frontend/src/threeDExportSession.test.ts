import { describe, expect, it, vi } from 'vitest'
import type { ExportFile, ExportResult } from './export'
import { exportCurrentThreeDRevision, type ThreeDExportRevision } from './threeDExportSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

const file: ExportFile = {
  fileName: 'homevox-wallshell.png',
  blob: new Blob(['png'], { type: 'image/png' }),
  width: 64,
  height: 64,
}

function revision(renderer: object): ThreeDExportRevision {
  return {
    canonicalRevision: 'r4',
    geometryRevision: 'r4',
    rendererRevision: 'r4',
    frameRevision: 'r4',
    renderer,
  }
}

describe('in-flight 3D export revision guard', () => {
  it('drops a pending old toBlob result after a canonical edit instead of downloading it', async () => {
    const renderer = {}
    const initial = revision(renderer)
    let current: ThreeDExportRevision = initial
    const pending = deferred<ExportResult<ExportFile>>()
    const render = vi.fn()
    const download = vi.fn()
    const stale = vi.fn()

    const run = exportCurrentThreeDRevision({
      revision: initial,
      readCurrent: () => current,
      render,
      exportPng: () => pending.promise,
      download,
      onStale: stale,
    })
    expect(render).toHaveBeenCalledTimes(1)

    current = { ...initial, canonicalRevision: 'r5', geometryRevision: null, frameRevision: null }
    pending.resolve({ ok: true, value: file })

    await expect(run).resolves.toEqual({ status: 'stale' })
    expect(download).not.toHaveBeenCalled()
    expect(stale).toHaveBeenCalledOnce()
  })

  it('downloads exactly once only when the frozen renderer identity and all revisions remain current', async () => {
    const renderer = {}
    const initial = revision(renderer)
    const pending = deferred<ExportResult<ExportFile>>()
    const download = vi.fn()

    const run = exportCurrentThreeDRevision({
      revision: initial,
      readCurrent: () => initial,
      render: vi.fn(),
      exportPng: () => pending.promise,
      download,
      onStale: vi.fn(),
    })
    pending.resolve({ ok: true, value: file })

    await expect(run).resolves.toEqual({ status: 'downloaded' })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(file)
  })
})
