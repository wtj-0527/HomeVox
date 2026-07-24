import type { WallSegment } from './floorplanEditor'
import type { ParsedOpening } from './floorplanUi'
import {
  buildWallShellModel,
  WALL_SHELL_HEIGHT,
  WALL_SHELL_THICKNESS,
} from './wallShell'

export const WALL_VOXEL_GRID_SIZE = 17
export const WALL_VOXEL_ISO_LEVEL = 0

export type WallVoxelModel = {
  dimensions: readonly [number, number, number]
  data: Float32Array
  isoLevel: number
  origin: readonly [number, number, number]
  spacing: readonly [number, number, number]
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function signedBoxDistance(
  x: number,
  y: number,
  z: number,
  halfX: number,
  halfY: number,
  halfZ: number,
): number {
  const qx = Math.abs(x) - halfX
  const qy = Math.abs(y) - halfY
  const qz = Math.abs(z) - halfZ
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  return outside + Math.min(Math.max(qx, qy, qz), 0)
}

/**
 * Produces a finite scalar field in R3F coordinates: X/Z map to the editable
 * plan, Y is vertical.  The wall shell's normalization is intentionally reused
 * so the fallback and WASM mesh share the same scale, height, and thickness.
 */
export function buildWallVoxelModel(walls: readonly WallSegment[], doors: readonly ParsedOpening[] = [], windows: readonly ParsedOpening[] = []): WallVoxelModel | null {
  const shell = buildWallShellModel(walls, doors, windows)
  if (shell.validationError || shell.walls.length === 0) return null

  const minX = Math.min(...shell.walls.map((wall) => wall.x - wall.length / 2))
  const maxX = Math.max(...shell.walls.map((wall) => wall.x + wall.length / 2))
  const minZ = Math.min(...shell.walls.map((wall) => wall.z - wall.length / 2))
  const maxZ = Math.max(...shell.walls.map((wall) => wall.z + wall.length / 2))
  const padding = Math.max(WALL_SHELL_THICKNESS, 0.35)
  const bounds = [
    minX - padding,
    maxX + padding,
    -padding,
    WALL_SHELL_HEIGHT + padding,
    minZ - padding,
    maxZ + padding,
  ]
  if (!bounds.every(finite)) return null

  const nx = WALL_VOXEL_GRID_SIZE
  const ny = WALL_VOXEL_GRID_SIZE
  const nz = WALL_VOXEL_GRID_SIZE
  const spacing: [number, number, number] = [
    (bounds[1] - bounds[0]) / (nx - 1),
    (bounds[3] - bounds[2]) / (ny - 1),
    (bounds[5] - bounds[4]) / (nz - 1),
  ]
  if (!spacing.every((value) => finite(value) && value > 0)) return null

  const data = new Float32Array(nx * ny * nz)
  for (let zIndex = 0; zIndex < nz; zIndex += 1) {
    for (let yIndex = 0; yIndex < ny; yIndex += 1) {
      for (let xIndex = 0; xIndex < nx; xIndex += 1) {
        const x = bounds[0] + xIndex * spacing[0]
        const y = bounds[2] + yIndex * spacing[1]
        const z = bounds[4] + zIndex * spacing[2]
        let field = Number.NEGATIVE_INFINITY
        for (const wall of shell.walls) {
          const cos = Math.cos(wall.rotationY)
          const sin = Math.sin(wall.rotationY)
          const dx = x - wall.x
          const dz = z - wall.z
          const localX = cos * dx - sin * dz
          const localZ = sin * dx + cos * dz
          field = Math.max(
            field,
            -signedBoxDistance(
              localX,
              y - WALL_SHELL_HEIGHT / 2,
              localZ,
              wall.length / 2,
              WALL_SHELL_HEIGHT / 2,
              WALL_SHELL_THICKNESS / 2,
            ),
          )
        }
        // Openings subtract from the same local-wall model. Doors reach the floor;
        // windows cut only their wall face at a non-persisted preview elevation.
        for (const opening of shell.openings) {
          const cos = Math.cos(opening.rotationY)
          const sin = Math.sin(opening.rotationY)
          const dx = x - opening.x
          const dz = z - opening.z
          const localX = cos * dx - sin * dz
          const localZ = sin * dx + cos * dz
          const halfWidth = opening.width / 2
          const openingHeight = opening.kind === 'door' ? WALL_SHELL_HEIGHT : WALL_SHELL_HEIGHT * 0.42
          const centerY = opening.kind === 'door' ? openingHeight / 2 : WALL_SHELL_HEIGHT * 0.62
          const cut = -signedBoxDistance(
            localX,
            y - centerY,
            localZ,
            halfWidth,
            openingHeight / 2,
            WALL_SHELL_THICKNESS,
          )
          field = Math.min(field, -cut)
        }
        if (!finite(field)) return null
        data[xIndex + yIndex * nx + zIndex * nx * ny] = field
      }
    }
  }

  return {
    dimensions: [nx, ny, nz],
    data,
    isoLevel: WALL_VOXEL_ISO_LEVEL,
    origin: [bounds[0], bounds[2], bounds[4]],
    spacing,
  }
}
