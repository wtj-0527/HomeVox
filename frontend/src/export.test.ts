import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_PIXEL_AREA,
  buildExportFileName,
  exportCanvasAsBlob,
  exportWebGLCanvasToPng,
  isImageDataBlank,
  serializeSvgElement,
  validateCanvasSize,
} from './export'

interface MockCanvasBlobLike {
  width: number
  height: number
  toBlob: HTMLCanvasElement['toBlob']
}

interface MockWebGLContextLike {
  RGBA: number
  UNSIGNED_BYTE: number
  readPixels: (
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ) => void
}

interface MockWebGLRendererLike {
  domElement: MockCanvasBlobLike
  getContext: () => MockWebGLContextLike | null
}

describe('export filename', () => {
  it('builds unique and stable names', () => {
    const timestamp = new Date('2026-07-20T12:34:56.000Z')
    const first2d = buildExportFileName('2d', timestamp, 1)
    const second2d = buildExportFileName('2d', timestamp, 2)

    expect(first2d).toBe('homevox-floorplan-20260720T123456-0001.png')
    expect(second2d).toBe('homevox-floorplan-20260720T123456-0002.png')
    expect(first2d).not.toBe(second2d)
    expect(first2d.includes('homevox-floorplan')).toBe(true)
    expect(second2d.includes('homevox-floorplan')).toBe(true)
  })

  it('distinguishes 2d and 3d prefixes', () => {
    const timestamp = new Date('2026-07-20T12:00:00.000Z')
    expect(buildExportFileName('3d', timestamp, 42)).toContain('homevox-wallshell')
  })
})

describe('canvas size validation', () => {
  it('accepts finite positive integers', () => {
    expect(validateCanvasSize(800, 600)).toEqual({ ok: true, value: { width: 800, height: 600 } })
  })

  it('rounds finite positive viewport dimensions up to safe integer pixels', () => {
    expect(validateCanvasSize(320.4, 240.6)).toEqual({ ok: true, value: { width: 321, height: 241 } })
    expect(validateCanvasSize(0.1, 0.1)).toEqual({ ok: true, value: { width: 1, height: 1 } })
  })

  it('rejects zero, negative, or non-finite dimensions', () => {
    expect(validateCanvasSize(0, 600)).toMatchObject({ ok: false })
    expect(validateCanvasSize(-1, 600)).toMatchObject({ ok: false })
    expect(validateCanvasSize(Number.NaN, 600)).toMatchObject({ ok: false })
    expect(validateCanvasSize(Number.POSITIVE_INFINITY, 600)).toMatchObject({ ok: false })
  })

  it('rejects dimensions that are too large for safe allocation', () => {
    const tooLarge = Math.floor(Math.sqrt(MAX_CANVAS_PIXEL_AREA)) + 1
    expect(validateCanvasSize(tooLarge, tooLarge)).toMatchObject({ ok: false })
  })
})

describe('svg serialization', () => {
  it('serializes SVG content with xml header', () => {
    const serializer = class {
      serializeToString() {
        return '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      }
    }
    const originalSerializer = globalThis.XMLSerializer
    globalThis.XMLSerializer = serializer as unknown as typeof globalThis.XMLSerializer

    const result = serializeSvgElement({} as SVGSVGElement)
    expect(result).toMatchObject({ ok: true })
    expect(result.ok ? result.value : '').toContain('<?xml version="1.0" encoding="UTF-8"?><svg')

    globalThis.XMLSerializer = originalSerializer
  })

  it('reports svg serialization failure', () => {
    const serializer = class {
      serializeToString() {
        throw new Error('bad serializer')
      }
    }
    const originalSerializer = globalThis.XMLSerializer
    globalThis.XMLSerializer = serializer as unknown as typeof globalThis.XMLSerializer

    const result = serializeSvgElement({} as SVGSVGElement)

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-svg' } })
    globalThis.XMLSerializer = originalSerializer
  })
})

describe('blank detection', () => {
  it('detects transparent-only images as blank', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0])
    expect(isImageDataBlank(pixels)).toBe(true)
  })

  it('does not treat opaque black pixels as blank', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255])
    expect(isImageDataBlank(pixels)).toBe(false)
  })
})

describe('canvas export result', () => {
  it('reports canvas blob success', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        callback?.(blob)
      },
    }

    const result = await exportCanvasAsBlob(canvas as unknown as HTMLCanvasElement)
    expect(result).toMatchObject({ ok: true })
    expect(result.ok ? result.value.type : '').toBe('image/png')
  })

  it('rejects empty or non-PNG blobs', async () => {
    const emptyCanvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null) => callback?.(new Blob([], { type: 'image/png' })),
    }
    const wrongTypeCanvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null) => callback?.(new Blob(['not-png'], { type: 'text/plain' })),
    }

    await expect(exportCanvasAsBlob(emptyCanvas as unknown as HTMLCanvasElement)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'canvas-export-failed' },
    })
    await expect(exportCanvasAsBlob(wrongTypeCanvas as unknown as HTMLCanvasElement)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'canvas-export-failed' },
    })
  })

  it('reports blob export failure', async () => {
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        callback?.(null)
      },
    }

    const result = await exportCanvasAsBlob(canvas as unknown as HTMLCanvasElement)
    expect(result).toMatchObject({ ok: false, error: { kind: 'canvas-export-failed' } })
  })
})

describe('WebGL export flow', () => {
  it('returns blank error when WebGL context has no visible pixels', async () => {
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        callback?.(new Blob(['webgl'], { type: 'image/png' }))
      },
    }

    const webglContext: MockWebGLContextLike = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        pixels.fill(0)
      },
    }

    const renderContext: MockWebGLRendererLike = {
      domElement: canvas,
      getContext: () => webglContext,
    }

    const result = await exportWebGLCanvasToPng(renderContext, 'homevox-wallshell-test.png')
    expect(result).toMatchObject({ ok: false, error: { kind: 'empty-or-transparent-image' } })
  })

  it('rejects missing WebGL context', async () => {
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        callback?.(new Blob(['webgl'], { type: 'image/png' }))
      },
    }

    const renderContext: MockWebGLRendererLike = {
      domElement: canvas,
      getContext: () => null,
    }

    const result = await exportWebGLCanvasToPng(renderContext, 'homevox-wallshell-test.png')
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-canvas' } })
  })

  it('creates a successful WebGL export when visible pixels exist', async () => {
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        const blob = new Blob(['webgl'], { type: 'image/png' })
        callback?.(blob)
      },
    }

    const webglContext: MockWebGLContextLike = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        pixels[3] = 255
      },
    }

    const renderContext: MockWebGLRendererLike = {
      domElement: canvas,
      getContext: () => webglContext,
    }

    const result = await exportWebGLCanvasToPng(renderContext, 'homevox-wallshell-test.png')
    expect(result).toMatchObject({ ok: true })
    expect(result.ok ? result.value.width : 0).toBe(2)
  })

  it('surfaces toBlob errors from WebGL export path', async () => {
    const canvas: MockCanvasBlobLike = {
      width: 2,
      height: 2,
      toBlob: (callback: BlobCallback | null, _type?: string) => {
        callback?.(null)
      },
    }

    const webglContext: MockWebGLContextLike = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        pixels[3] = 255
      },
    }

    const renderContext: MockWebGLRendererLike = {
      domElement: canvas,
      getContext: () => webglContext,
    }

    const result = await exportWebGLCanvasToPng(renderContext, 'homevox-wallshell-test.png')
    expect(result).toMatchObject({ ok: false, error: { kind: 'canvas-export-failed' } })
  })
})
