import { describe, expect, it } from 'vitest'
import {
  canvasScale,
  canvasUnitsForCssPixels,
  isParseResponse,
  openingLabel,
} from './floorplanUi'

const validResponse = {
  filename: 'plan.png',
  contentType: 'image/png',
  size: 1024,
  result: {
    rooms: [
      {
        name: '客厅',
        type: '客厅',
        approximate_bounds: { x1: 0, y1: 0, x2: 100, y2: 80 },
      },
    ],
    walls: [{ x1: 0, y1: 0, x2: 100, y2: 0 }],
    doors: [{ type: 'door', x: 50, y: 0 }],
    windows: [{ from: '客厅', to: '室外', x: 80, y: 0 }],
    scale: { unit: 'px' },
    metadata: { source: 'test', image_width: 4000, image_height: 3000 },
  },
}

describe('2D editor view helpers', () => {
  it('keeps interaction geometry stable in CSS pixels for high-resolution plans', () => {
    const scale = canvasScale(
      { width: 850, height: 445 },
      { minX: 0, minY: 0, width: 4000, height: 3000 },
    )

    expect(scale).toBeCloseTo(445 / 3000)
    expect(scale).not.toBeNull()
    if (scale === null) throw new Error('expected valid canvas scale')
    expect(canvasUnitsForCssPixels(16, scale) * scale).toBeCloseTo(16)
    expect(canvasUnitsForCssPixels(5, scale) * scale).toBeCloseTo(5)
  })

  it('rejects invalid canvas geometry instead of producing infinite hit targets', () => {
    expect(canvasScale({ width: 0, height: 445 }, { minX: 0, minY: 0, width: 4000, height: 3000 })).toBeNull()
    expect(canvasUnitsForCssPixels(16, null)).toBe(16)
  })

  it('accepts only a complete finite parse response', () => {
    expect(isParseResponse(validResponse)).toBe(true)
    expect(isParseResponse({ ...validResponse, result: undefined })).toBe(false)
    expect(
      isParseResponse({
        ...validResponse,
        result: {
          ...validResponse.result,
          walls: [{ x1: 0, y1: 0, x2: Number.NaN, y2: 0 }],
        },
      }),
    ).toBe(false)
  })

  it('does not invent a label for an opening with no descriptive field', () => {
    expect(openingLabel({ x: 10, y: 20 })).toBeNull()
    expect(openingLabel({ from: '客厅', to: '走廊', x: 10, y: 20 })).toBe('客厅 → 走廊')
    expect(openingLabel({ type: 'door', from: '客厅', x: 10, y: 20 })).toBe('door · 客厅')
    expect(openingLabel({ type: 'window', from: '客厅', to: '室外' })).toBe('window · 客厅 → 室外')
  })
})
