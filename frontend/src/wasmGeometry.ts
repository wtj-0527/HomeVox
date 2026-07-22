import { BufferAttribute, BufferGeometry } from 'three'
import type { WallVoxelModel } from './wallVoxel'

export function buildWasmWallGeometry(vertices: Float32Array, model: WallVoxelModel): BufferGeometry | null {
  if (vertices.length === 0 || vertices.length % 3 !== 0 || !Array.from(vertices).every(Number.isFinite)) return null
  const positions = new Float32Array(vertices.length)
  for (let index = 0; index < vertices.length; index += 3) {
    positions[index] = model.origin[0] + vertices[index] * model.spacing[0]
    positions[index + 1] = model.origin[1] + vertices[index + 1] * model.spacing[1]
    positions[index + 2] = model.origin[2] + vertices[index + 2] * model.spacing[2]
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
