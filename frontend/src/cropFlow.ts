export type CropRect = { x: number; y: number; width: number; height: number }
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type CandidateMode = 'single' | 'composite' | 'uncertain'
export type CandidateDetection = { mode: CandidateMode; candidates: CropRect[] }

export const MIN_CROP_SIZE = 32
export const MAX_CROPPED_FILE_BYTES = 10 << 20

export function cropDisplayMetrics(image: { width: number; height: number }): { handleSize: number; hitDistance: number; strokeWidth: number } {
  const longestSide = Math.max(1, image.width, image.height)
  return {
    handleSize: Math.max(14, Math.round(longestSide * 0.022)),
    hitDistance: Math.max(18, Math.round(longestSide * 0.028)),
    strokeWidth: Math.max(3, Math.round(longestSide * 0.0047)),
  }
}

export function cropPointerToImage(
  pointer: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  image: { width: number; height: number },
): { x: number; y: number } {
  const scale = Math.min(box.width / image.width, box.height / image.height)
  if (!Number.isFinite(scale) || scale <= 0) return { x: 0, y: 0 }
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  const left = box.left + (box.width - renderedWidth) / 2
  const top = box.top + (box.height - renderedHeight) / 2
  return {
    x: Math.min(image.width, Math.max(0, Math.round((pointer.clientX - left) / scale))),
    y: Math.min(image.height, Math.max(0, Math.round((pointer.clientY - top) / scale))),
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const exactKeys = (value: object, expected: readonly string[]) => {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

const overlaps = (a: CropRect, b: CropRect) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)

export function isCandidateDetection(value: unknown, image?: { width: number; height: number }): value is CandidateDetection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!exactKeys(value, ['mode', 'candidates'])) return false
  const candidate = value as { mode?: unknown; candidates?: unknown }
  if (!(candidate.mode === 'single' || candidate.mode === 'composite' || candidate.mode === 'uncertain') || !Array.isArray(candidate.candidates)) return false
  const validCount = candidate.mode === 'single'
    ? candidate.candidates.length === 1
    : candidate.mode === 'composite'
      ? candidate.candidates.length >= 2
      : candidate.candidates.length === 0
  if (!validCount) return false
  const rectangles = candidate.candidates as unknown[]
  if (!rectangles.every((rect) => {
      if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return false
      if (!exactKeys(rect, ['x', 'y', 'width', 'height'])) return false
      const r = rect as CropRect
      return finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height) &&
        Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.width) && Number.isInteger(r.height) &&
        r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.width * r.height >= 64 &&
        (!image || (r.x + r.width <= image.width && r.y + r.height <= image.height))
    })) return false
  const typed = rectangles as CropRect[]
  return typed.every((rect, index) => typed.slice(0, index).every((prior) => !overlaps(rect, prior)))
}

export function fullImageCrop(image: { width: number; height: number }): CropRect {
  return { x: 0, y: 0, width: Math.max(0, Math.round(image.width)), height: Math.max(0, Math.round(image.height)) }
}

export function clampCrop(rect: CropRect, image: { width: number; height: number }, minimum = MIN_CROP_SIZE): CropRect {
  const maxWidth = Math.max(1, Math.round(image.width)); const maxHeight = Math.max(1, Math.round(image.height))
  const minWidth = Math.min(Math.max(1, minimum), maxWidth); const minHeight = Math.min(Math.max(1, minimum), maxHeight)
  const width = Math.min(maxWidth, Math.max(minWidth, Math.round(rect.width)))
  const height = Math.min(maxHeight, Math.max(minHeight, Math.round(rect.height)))
  return {
    x: Math.min(maxWidth - width, Math.max(0, Math.round(rect.x))),
    y: Math.min(maxHeight - height, Math.max(0, Math.round(rect.y))),
    width,
    height,
  }
}

export function moveCrop(rect: CropRect, dx: number, dy: number, image: { width: number; height: number }): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, image, 1)
}

export function resizeCrop(rect: CropRect, handle: CropHandle, dx: number, dy: number, image: { width: number; height: number }, minimum = MIN_CROP_SIZE): CropRect {
  let left = rect.x; let right = rect.x + rect.width; let top = rect.y; let bottom = rect.y + rect.height
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy
  const minWidth = Math.min(minimum, image.width); const minHeight = Math.min(minimum, image.height)
  if (right - left < minWidth) { if (handle.includes('w')) left = right - minWidth; else right = left + minWidth }
  if (bottom - top < minHeight) { if (handle.includes('n')) top = bottom - minHeight; else bottom = top + minHeight }
  if (left < 0) { if (handle.includes('w')) left = 0; else right = Math.min(image.width, right - left); }
  if (top < 0) { if (handle.includes('n')) top = 0; else bottom = Math.min(image.height, bottom - top); }
  if (right > image.width) { if (handle.includes('e')) right = image.width; else left = Math.max(0, left - (right - image.width)); }
  if (bottom > image.height) { if (handle.includes('s')) bottom = image.height; else top = Math.max(0, top - (bottom - image.height)); }
  return clampCrop({ x: left, y: top, width: right - left, height: bottom - top }, image, minimum)
}

export function selectCandidate(candidates: readonly CropRect[], index: number, image: { width: number; height: number }): CropRect | null {
  const candidate = candidates[index]
  return candidate ? clampCrop(candidate, image, 1) : null
}

export function cropKeyboardNudge(rect: CropRect, key: string, image: { width: number; height: number }, step = 1): CropRect | null {
  const amount = Math.max(1, Math.round(step))
  if (key === 'ArrowLeft') return moveCrop(rect, -amount, 0, image)
  if (key === 'ArrowRight') return moveCrop(rect, amount, 0, image)
  if (key === 'ArrowUp') return moveCrop(rect, 0, -amount, image)
  if (key === 'ArrowDown') return moveCrop(rect, 0, amount, image)
  return null
}

export type CropCanvas = { width: number; height: number; getContext: (kind: '2d') => Pick<CanvasRenderingContext2D, 'drawImage'> | null }
export function drawCropToCanvas(canvas: CropCanvas, image: CanvasImageSource, crop: CropRect): CropCanvas {
  canvas.width = crop.width; canvas.height = crop.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建裁切画布。')
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  return canvas
}

export async function createCroppedFile(source: File, crop: CropRect): Promise<File> {
  const url = URL.createObjectURL(source)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('无法读取户型图。')); element.src = url
    })
    const canvas = document.createElement('canvas')
    drawCropToCanvas(canvas, image, clampCrop(crop, { width: image.naturalWidth, height: image.naturalHeight }, 1))
    const type = source.type === 'image/png' ? 'image/png' : 'image/jpeg'
    let blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成裁切图。')), type, 0.9))
    if (blob.size > MAX_CROPPED_FILE_BYTES && type !== 'image/png') blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成裁切图。')), type, 0.72))
    if (blob.size > MAX_CROPPED_FILE_BYTES) throw new Error('裁切后的图片仍超过 10 MiB，请缩小裁切区域或选择更小的图片。')
    const extension = blob.type === 'image/png' ? 'png' : 'jpg'
    return new File([blob], `${source.name.replace(/\.[^.]+$/, '')}-crop.${extension}`, { type: blob.type })
  } finally { URL.revokeObjectURL(url) }
}
