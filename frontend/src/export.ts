export type ExportScope = '2d' | '3d'

export type ExportFailureKind =
  | 'invalid-dimensions'
  | 'invalid-svg'
  | 'empty-or-transparent-image'
  | 'invalid-canvas'
  | 'svg-load-failed'
  | 'canvas-export-failed'

export type ExportError = {
  kind: ExportFailureKind
  message: string
}

export type ExportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExportError }

export type ExportFile = {
  fileName: string
  blob: Blob
  width: number
  height: number
}

export type CanvasElementLike = Pick<HTMLCanvasElement, 'width' | 'height' | 'toBlob'>

export type WebGLContextLike = {
  RGBA: number
  UNSIGNED_BYTE: number
  readPixels: (x: number, y: number, width: number, height: number, format: number, type: number, pixels: Uint8Array) => void
}

export type WebGLRendererLike = {
  domElement: CanvasElementLike
  getContext: () => WebGLContextLike | null
}

const FILE_PREFIX: Record<ExportScope, string> = {
  '2d': 'homevox-floorplan',
  '3d': 'homevox-wallshell',
}

export const MAX_CANVAS_PIXEL_AREA = 16_777_216

export function buildExportFileName(scope: ExportScope, now: Date = new Date(), sequence = 0): string {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  const safeSeq = String(sequence).padStart(4, '0')
  return `${FILE_PREFIX[scope]}-${timestamp}-${safeSeq}.png`
}

export function hasFinitePositiveSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}

export function validateCanvasSize(width: number, height: number): ExportResult<{ width: number; height: number }> {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return {
      ok: false,
      error: {
        kind: 'invalid-dimensions',
        message: '导出尺寸无效：宽高必须是有限数值。',
      },
    }
  }

  if (!hasFinitePositiveSize(width, height)) {
    return {
      ok: false,
      error: {
        kind: 'invalid-dimensions',
        message: '导出尺寸无效：宽高必须大于 0。',
      },
    }
  }

  const pixelWidth = Math.ceil(width)
  const pixelHeight = Math.ceil(height)

  if (pixelWidth > Number.MAX_SAFE_INTEGER / 4 / pixelHeight) {
    return {
      ok: false,
      error: {
        kind: 'invalid-dimensions',
        message: '导出尺寸过大：宽高乘积可能导致内存分配溢出。',
      },
    }
  }

  if (pixelWidth * pixelHeight > MAX_CANVAS_PIXEL_AREA) {
    return {
      ok: false,
      error: {
        kind: 'invalid-dimensions',
        message: `导出尺寸过大：像素总量超过上限 ${MAX_CANVAS_PIXEL_AREA.toLocaleString()}。`,
      },
    }
  }

  return { ok: true, value: { width: pixelWidth, height: pixelHeight } }
}

export function serializeSvgElement(svgElement: SVGSVGElement): ExportResult<string> {
  try {
    const serializer = new XMLSerializer()
    const source = serializer.serializeToString(svgElement)
    if (!source || typeof source !== 'string') {
      return {
        ok: false,
        error: {
          kind: 'invalid-svg',
          message: 'SVG 序列化失败：内容为空。',
        },
      }
    }

    return {
      ok: true,
      value: `<?xml version="1.0" encoding="UTF-8"?>${source}`,
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'invalid-svg',
        message: `SVG 序列化失败：${error instanceof Error ? error.message : '未知错误'}。`,
      },
    }
  }
}

export function isImageDataBlank(imageData: Uint8ClampedArray | Uint8Array): boolean {
  if (!imageData || imageData.length === 0) return true

  for (let i = 3; i < imageData.length; i += 4) {
    if (imageData[i] > 0) {
      return false
    }
  }

  return true
}

async function getCanvasImageDataAlphaOnly(
  canvas: HTMLCanvasElement,
  size: { width: number; height: number },
): Promise<ExportResult<boolean>> {
  const context = canvas.getContext('2d')
  if (!context) {
    return {
      ok: false,
      error: {
        kind: 'invalid-canvas',
        message: '当前浏览器环境不支持 2D canvas。',
      },
    }
  }

  try {
    const imageData = context.getImageData(0, 0, size.width, size.height).data
    return { ok: true, value: isImageDataBlank(imageData) }
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'invalid-canvas',
        message: `2D 像素读取失败：${error instanceof Error ? error.message : '未知错误'}。`,
      },
    }
  }
}

export async function exportCanvasAsBlob(canvas: HTMLCanvasElement): Promise<ExportResult<Blob>> {
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((item) => resolve(item ?? null), 'image/png')
    })

    if (!blob || blob.size <= 0 || blob.type !== 'image/png') {
      return {
        ok: false,
        error: {
          kind: 'canvas-export-failed',
          message: '画布导出失败：浏览器未生成有效的 PNG 数据。',
        },
      }
    }

    return { ok: true, value: blob }
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'canvas-export-failed',
        message: `画布导出失败：${error instanceof Error ? error.message : '未知错误'}。`,
      },
    }
  }
}

export async function exportSvgElementToPng(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
  filename: string,
): Promise<ExportResult<ExportFile>> {
  const size = validateCanvasSize(width, height)
  if (!size.ok) return { ok: false, error: size.error }

  const serialized = serializeSvgElement(svgElement)
  if (!serialized.ok) return serialized

  const svgBlob = new Blob([serialized.value], { type: 'image/svg+xml;charset=utf-8' })
  const svgObjectUrl = URL.createObjectURL(svgBlob)

  try {
    const image = new Image()
    image.decoding = 'async'
    image.loading = 'eager'

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = svgObjectUrl
    })

    const canvas = document.createElement('canvas') as HTMLCanvasElement
    canvas.width = size.value.width
    canvas.height = size.value.height
    const context = canvas.getContext('2d')
    if (!context) {
      return {
        ok: false,
        error: {
          kind: 'invalid-canvas',
          message: '当前浏览器环境不支持 2D canvas。',
        },
      }
    }

    context.drawImage(image, 0, 0, size.value.width, size.value.height)

    const imageDataResult = await getCanvasImageDataAlphaOnly(canvas, size.value)
    if (!imageDataResult.ok) return imageDataResult
    if (imageDataResult.value) {
      return {
        ok: false,
        error: {
          kind: 'empty-or-transparent-image',
          message: '2D 导出结果为空白。',
        },
      }
    }

    const blobResult = await exportCanvasAsBlob(canvas)
    if (!blobResult.ok) return blobResult

    return {
      ok: true,
      value: {
        fileName: filename,
        blob: blobResult.value,
        width: size.value.width,
        height: size.value.height,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: error instanceof Error ? 'svg-load-failed' : 'canvas-export-failed',
        message: `2D 导出失败：${error instanceof Error ? error.message : '图片加载或转换失败'}。`,
      },
    }
  } finally {
    URL.revokeObjectURL(svgObjectUrl)
  }
}

export function ensureWebGLCanvasHasPixels(
  width: number,
  height: number,
  context: WebGLContextLike,
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false
  }

  const pixelLength = width * height * 4
  if (!Number.isInteger(pixelLength) || pixelLength <= 0) {
    return false
  }

  const pixelData = new Uint8Array(pixelLength)

  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixelData)
  return !isImageDataBlank(pixelData)
}

export async function exportWebGLCanvasToPng(
  renderer: WebGLRendererLike,
  filename: string,
): Promise<ExportResult<ExportFile>> {
  const canvas = renderer.domElement
  const size = validateCanvasSize(canvas.width, canvas.height)
  if (!size.ok) return { ok: false, error: size.error }

  const webglContext = renderer.getContext()
  if (!webglContext) {
    return {
      ok: false,
      error: {
        kind: 'invalid-canvas',
        message: 'WebGL 上下文不可用，无法导出 3D 画布。',
      },
    }
  }

  try {
    if (!ensureWebGLCanvasHasPixels(size.value.width, size.value.height, webglContext)) {
      return {
        ok: false,
        error: {
          kind: 'empty-or-transparent-image',
          message: '3D 导出结果为空白。',
        },
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'invalid-canvas',
        message: `3D 画布像素读取失败：${error instanceof Error ? error.message : '未知错误'}。`,
      },
    }
  }

  const blobResult = await exportCanvasAsBlob(canvas as HTMLCanvasElement)
  if (!blobResult.ok) return blobResult

  return {
    ok: true,
    value: {
      fileName: filename,
      blob: blobResult.value,
      width: size.value.width,
      height: size.value.height,
    },
  }
}

export function downloadBlobAsPng(file: ExportFile): void {
  const objectUrl = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = file.fileName
  anchor.rel = 'noopener'
  anchor.style.position = 'fixed'
  anchor.style.opacity = '0'
  anchor.style.pointerEvents = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl)
    if (document.body.contains(anchor)) {
      document.body.removeChild(anchor)
    }
  }, 0)
}
