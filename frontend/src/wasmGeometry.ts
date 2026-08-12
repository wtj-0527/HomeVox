import { BufferAttribute, BufferGeometry } from 'three'
import type { WallVoxelModel } from './wallVoxel'

export type WasmWallGeometry = { wallId: string; geometry: BufferGeometry }
export type MergedWasmWallGeometry = {
  geometry: BufferGeometry
  wallIDForFace: (faceIndex: number | null | undefined) => string | null
}

export function buildWasmWallGeometry(vertices: Float32Array, model: WallVoxelModel): BufferGeometry | null {
  if (vertices.length === 0 || vertices.length % 3 !== 0 || !Array.from(vertices).every(Number.isFinite)) return null
  const positions = new Float32Array(vertices.length)
  for (let index = 0; index < vertices.length; index += 3) {
    const localX = model.origin[0] + vertices[index] * model.spacing[0]
    const localZ = model.origin[2] + vertices[index + 2] * model.spacing[2]
    const rotationY = model.rotationY ?? 0
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    positions[index] = (model.worldCenter?.[0] ?? 0) + cos * localX + sin * localZ
    positions[index + 1] = model.origin[1] + vertices[index + 1] * model.spacing[1]
    positions[index + 2] = (model.worldCenter?.[1] ?? 0) - sin * localX + cos * localZ
  }
  if (!Array.from(positions).every(Number.isFinite)) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  if (!normals || !Array.from(normals.array).every(Number.isFinite)) {
    geometry.dispose()
    return null
  }
  return geometry
}

export function disposeWasmWallGeometry(geometry: BufferGeometry | null | undefined): void {
  geometry?.dispose()
}

export function disposeWasmWallGeometries(items: readonly WasmWallGeometry[] | null | undefined): void {
  items?.forEach((item) => item.geometry.dispose())
}

export function mergeWasmWallGeometries(items: readonly WasmWallGeometry[]): MergedWasmWallGeometry | null {
  const ranges: Array<{ wallId: string; firstFace: number; endFace: number }> = []
  let totalFloats = 0
  for (const item of items) {
    const positions = item.geometry.getAttribute('position')
    if (!positions || positions.itemSize !== 3 || positions.count === 0 || positions.count % 3 !== 0) return null
    const firstFace = totalFloats / 9
    totalFloats += positions.array.length
    ranges.push({ wallId: item.wallId, firstFace, endFace: totalFloats / 9 })
  }
  if (totalFloats === 0) return null
  const positions = new Float32Array(totalFloats)
  let offset = 0
  for (const item of items) {
    const source = item.geometry.getAttribute('position').array
    positions.set(source as ArrayLike<number>, offset)
    offset += source.length
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return {
    geometry,
    wallIDForFace(faceIndex) {
      if (typeof faceIndex !== 'number' || !Number.isInteger(faceIndex) || faceIndex < 0) return null
      return ranges.find((range) => faceIndex >= range.firstFace && faceIndex < range.endFace)?.wallId ?? null
    },
  }
}
