import { describe, expect, it } from 'vitest'
import { clampCrop, cropDisplayMetrics, cropKeyboardNudge, cropPointerToImage, drawCropToCanvas, fullImageCrop, isCandidateDetection, moveCrop, resizeCrop, selectCandidate } from './cropFlow'

const image = { width: 200, height: 100 }
describe('crop flow', () => {
  it('validates analysis schema and fails closed on fake rectangles', () => {
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 1, y: 2, width: 10, height: 10 }] }, image)).toBe(true)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 1, y: 2, width: 10, height: 10 }], extra: true }, image)).toBe(false)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 1.5, y: 2, width: 10, height: 10 }] }, image)).toBe(false)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 195, y: 2, width: 10, height: 10 }] }, image)).toBe(false)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 1, y: 2, width: 7, height: 9 }] }, image)).toBe(false)
    expect(isCandidateDetection({ mode: 'composite', candidates: [{ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 }] }, image)).toBe(false)
    expect(isCandidateDetection({ mode: 'composite', candidates: [{ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }] }, image)).toBe(true)
    expect(isCandidateDetection({ mode: 'single', candidates: [] })).toBe(false)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: 1, y: 2, width: 10, height: 10 }, { x: 2, y: 3, width: 10, height: 10 }] })).toBe(false)
    expect(isCandidateDetection({ mode: 'composite', candidates: [{ x: 1, y: 2, width: 10, height: 10 }] })).toBe(false)
    expect(isCandidateDetection({ mode: 'uncertain', candidates: [{ x: 1, y: 2, width: 10, height: 10 }] })).toBe(false)
    expect(isCandidateDetection({ mode: 'single', candidates: [{ x: -1, y: 0, width: 1, height: 1 }] })).toBe(false)
    expect(isCandidateDetection({ mode: 'wrong', candidates: [] })).toBe(false)
  })
  it('clamps boundaries and minimum dimensions during move and all resize directions', () => {
    expect(clampCrop({ x: -4, y: 90, width: 5, height: 2 }, image)).toEqual({ x: 0, y: 68, width: 32, height: 32 })
    expect(moveCrop({ x: 160, y: 60, width: 32, height: 32 }, 40, 40, image)).toEqual({ x: 168, y: 68, width: 32, height: 32 })
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const result = resizeCrop({ x: 50, y: 30, width: 80, height: 50 }, handle, -100, -100, image)
      expect(result.x).toBeGreaterThanOrEqual(0); expect(result.y).toBeGreaterThanOrEqual(0)
      expect(result.x + result.width).toBeLessThanOrEqual(200); expect(result.y + result.height).toBeLessThanOrEqual(100)
      expect(result.width).toBeGreaterThanOrEqual(32); expect(result.height).toBeGreaterThanOrEqual(32)
    }
  })
  it('selects, restores full image and accepts keyboard nudges', () => {
    expect(selectCandidate([{ x: 20, y: 10, width: 50, height: 50 }], 0, image)).toEqual({ x: 20, y: 10, width: 50, height: 50 })
    expect(selectCandidate([], 0, image)).toBeNull()
    expect(fullImageCrop(image)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    expect(cropKeyboardNudge({ x: 0, y: 0, width: 32, height: 32 }, 'ArrowLeft', image)).toEqual({ x: 0, y: 0, width: 32, height: 32 })
    expect(selectCandidate([{ x: 1, y: 2, width: 10, height: 10 }], 0, image)).toEqual({ x: 1, y: 2, width: 10, height: 10 })
  })
  it('draws original source pixels to a matching output canvas', () => {
    const calls: unknown[][] = []; const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => calls.push(args) }) }
    const source = {} as CanvasImageSource
    drawCropToCanvas(canvas, source, { x: 10, y: 20, width: 50, height: 40 })
    expect([canvas.width, canvas.height]).toEqual([50, 40]); expect(calls[0]).toEqual([source, 10, 20, 50, 40, 0, 0, 50, 40])
  })
  it('keeps crop handles and hit targets visible on high-resolution source images', () => {
    expect(cropDisplayMetrics({ width: 600, height: 440 })).toEqual({ handleSize: 14, hitDistance: 18, strokeWidth: 3 })
    expect(cropDisplayMetrics({ width: 8001, height: 4501 })).toEqual({ handleSize: 176, hitDistance: 224, strokeWidth: 38 })
  })
  it('maps pointer coordinates through xMidYMid meet letterboxing into original pixels', () => {
    const box = { left: 100, top: 50, width: 640, height: 640 }
    const source = { width: 8001, height: 4501 }
    expect(cropPointerToImage({ clientX: 100, clientY: 190 }, box, source)).toEqual({ x: 0, y: 0 })
    expect(cropPointerToImage({ clientX: 740, clientY: 550 }, box, source)).toEqual({ x: 8001, y: 4501 })
  })
})
