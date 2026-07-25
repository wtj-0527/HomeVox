import type { WallSegment } from './floorplanEditor'
import type { ParsedOpening } from './floorplanUi'

/** Stable content token used as the canonical generation revision. */
export function canonicalRevisionToken(walls: readonly WallSegment[], openings: readonly ParsedOpening[], valid: boolean): string | null {
  if (!valid) return null
  return JSON.stringify({
    walls: walls.map(({ id, x1, y1, x2, y2 }) => ({ id, x1, y1, x2, y2 })),
    openings: openings.map(({ id, kind, wallId, position, width }) => ({ id, kind, wallId, position, width })),
  })
}
