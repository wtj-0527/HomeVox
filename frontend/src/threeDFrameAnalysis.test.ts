import { describe, expect, it } from 'vitest'
import { analyzeCurrentThreeDFrame } from './threeDFrameAnalysis'

type Color = readonly [number, number, number, number]

function frame(width: number, height: number, fill: Color): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) pixels.set(fill, index)
  return pixels
}

function paintRect(pixels: Uint8Array, width: number, x: number, y: number, rectWidth: number, rectHeight: number, color: Color): void {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      pixels.set(color, (row * width + column) * 4)
    }
  }
}

describe('current 3D frame pixel analysis', () => {
  const width = 200
  const height = 140
  const background: Color = [12, 19, 37, 255]

  it('rejects background, grid section lines, floor color, and a few marker/control pixels', () => {
    expect(analyzeCurrentThreeDFrame(width, height, frame(width, height, background)).accepted).toBe(false)
    expect(analyzeCurrentThreeDFrame(width, height, frame(width, height, [144, 164, 198, 255])).accepted).toBe(false)
    expect(analyzeCurrentThreeDFrame(width, height, frame(width, height, [83, 109, 157, 255])).accepted).toBe(false)

    const markerOnly = frame(width, height, background)
    paintRect(markerOnly, width, 92, 62, 8, 8, [196, 181, 253, 255])
    expect(analyzeCurrentThreeDFrame(width, height, markerOnly).accepted).toBe(false)

    const openingMarkerOnly = frame(width, height, background)
    paintRect(openingMarkerOnly, width, 92, 62, 8, 8, [124, 58, 237, 255])
    expect(analyzeCurrentThreeDFrame(width, height, openingMarkerOnly).accepted).toBe(false)
  })

  it('requires a structurally sized and distributed off-white canonical wall footprint', () => {
    const pixels = frame(width, height, background)
    paintRect(pixels, width, 25, 28, 126, 56, [232, 239, 249, 255])

    const analysis = analyzeCurrentThreeDFrame(width, height, pixels)
    expect(analysis.accepted).toBe(true)
    expect(analysis.coverage).toBeGreaterThan(0.02)
    expect(analysis.bounds.widthRatio).toBeGreaterThan(0.5)
    expect(analysis.bounds.heightRatio).toBeGreaterThan(0.3)
  })

  it('accepts a structurally sized selected-violet wall footprint without accepting tiny violet controls', () => {
    const pixels = frame(width, height, background)
    paintRect(pixels, width, 40, 22, 112, 74, [167, 139, 250, 255])

    const analysis = analyzeCurrentThreeDFrame(width, height, pixels)
    expect(analysis.accepted).toBe(true)
    expect(analysis.largestComponent.count).toBeGreaterThan(5_000)
  })
})
