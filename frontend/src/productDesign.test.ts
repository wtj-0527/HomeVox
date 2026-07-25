import { describe, expect, it } from 'vitest'
import { PRODUCT_DESIGN, PRODUCT_STATE_COPY } from './productDesign'

describe('authoritative product design contract', () => {
  it('keeps the 1440px Penpot shell geometry and core visual tokens explicit', () => {
    expect(PRODUCT_DESIGN.sidebarWidth).toBe(232)
    expect(PRODUCT_DESIGN.topbarHeight).toBe(72)
    expect(PRODUCT_DESIGN.workspaceGap).toBe(16)
    expect(PRODUCT_DESIGN.radius.card).toBe(16)
    expect(PRODUCT_DESIGN.color.appBackground).toBe('#f4f6fa')
    expect(PRODUCT_DESIGN.color.violet).toBe('#5b5ce2')
    expect(PRODUCT_DESIGN.color.ink).toBe('#182033')
    expect(PRODUCT_DESIGN.color.unknown).toBe('#d98b21')
  })

  it('preserves the customer-facing state copy and never upgrades unknown facts', () => {
    expect(PRODUCT_STATE_COPY[1].title).toBe('导入真实户型图')
    expect(PRODUCT_STATE_COPY[3].title).toBe('校正可编辑 2D')
    expect(PRODUCT_STATE_COPY[4].title).toBe('生成可编辑 3D')
    expect(PRODUCT_STATE_COPY[5].title).toBe('2D / 3D 联动编辑')
    expect(PRODUCT_STATE_COPY[4].unknown).toContain('unknown')
    expect(PRODUCT_STATE_COPY[5].unknown).toContain('unknown')
  })
})
