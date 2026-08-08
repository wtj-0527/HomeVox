import type { BufferGeometry } from 'three'
import type { WallShellModel } from './wallShell'

export type WasmWallMeshPresentation = {
  geometry: BufferGeometry
  visible: true
  castShadow: true
  receiveShadow: true
  onSelectAt: (x: number, z: number) => void
}

function pointToSegmentDistanceSquared(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX
  const deltaZ = endZ - startZ
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) return Number.POSITIVE_INFINITY
  const progress = Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointZ - startZ) * deltaZ) / lengthSquared))
  const closestX = startX + deltaX * progress
  const closestZ = startZ + deltaZ * progress
  return (pointX - closestX) ** 2 + (pointZ - closestZ) ** 2
}

/** Resolves a click on the actual WASM surface to the nearest canonical wall.
 * Canonical IDs remain the editing contract; rendering geometry remains WASM. */
export function nearestWasmWallID(model: WallShellModel, x: number, z: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  let closest: { id: string; distanceSquared: number } | null = null
  for (const wall of model.walls) {
    const halfLength = wall.length / 2
    const offsetX = Math.cos(wall.rotationY) * halfLength
    const offsetZ = -Math.sin(wall.rotationY) * halfLength
    const distanceSquared = pointToSegmentDistanceSquared(x, z, wall.x - offsetX, wall.z - offsetZ, wall.x + offsetX, wall.z + offsetZ)
    if (!closest || distanceSquared < closest.distanceSquared) closest = { id: wall.id, distanceSquared }
  }
  return closest?.id ?? null
}

/** The only success-path wall surface. It is intentionally absent until the
 * active canonical revision has produced a real WASM BufferGeometry. */
export function wasmWallMeshPresentation(
  wasmActive: boolean,
  geometry: BufferGeometry | null,
  model: WallShellModel,
  onSelectWall: (wallID: string) => void,
): WasmWallMeshPresentation | null {
  if (!wasmActive || !geometry) return null
  return {
    geometry,
    visible: true,
    castShadow: true,
    receiveShadow: true,
    onSelectAt: (x, z) => {
      const wallID = nearestWasmWallID(model, x, z)
      if (wallID) onSelectWall(wallID)
    },
  }
}

