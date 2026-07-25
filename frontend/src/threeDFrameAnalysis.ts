type FrameBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  widthRatio: number
  heightRatio: number
}

export type CurrentThreeDFrameAnalysis = {
  accepted: boolean
  coverage: number
  wallPixelCount: number
  componentCount: number
  bounds: FrameBounds
  largestComponent: FrameBounds & { count: number }
}

const emptyBounds = (): FrameBounds => ({
  minX: 0,
  minY: 0,
  maxX: -1,
  maxY: -1,
  width: 0,
  height: 0,
  widthRatio: 0,
  heightRatio: 0,
})

function boundsFor(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  width: number,
  height: number,
): FrameBounds {
  if (maxX < minX || maxY < minY) return emptyBounds()
  const boundsWidth = maxX - minX + 1
  const boundsHeight = maxY - minY + 1
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: boundsWidth,
    height: boundsHeight,
    widthRatio: boundsWidth / width,
    heightRatio: boundsHeight / height,
  }
}

function isGridOrFloorPixel(red: number, green: number, blue: number): boolean {
  // The Grid's section color is #90a4c6 and the floor is #536d9d. Lighting
  // can darken both, but they remain distinctly blue/green biased instead of
  // the neutral wall shell or red-biased selected violet.
  return blue - red >= 28 && green - red >= 5
}

function isWallPixel(red: number, green: number, blue: number, alpha: number): boolean {
  if (alpha < 220 || isGridOrFloorPixel(red, green, blue)) return false

  // Lit #e8eff9 wall surfaces resolve to neutral greys such as #adb1b6.
  const neutralWall = Math.min(red, green, blue) >= 120 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 32

  // Lit #a78bfa selected spans resolve near #9165d2. Requiring a useful
  // green channel rejects the small #7c3aed opening selector/marker.
  const selectedWall = red >= 100 &&
    green >= 75 &&
    blue >= 150 &&
    red - green >= 8 &&
    blue - green >= 32

  return neutralWall || selectedWall
}

function hasStructuralWallFootprint(
  totalPixels: number,
  coverage: number,
  bounds: FrameBounds,
  largestComponent: CurrentThreeDFrameAnalysis['largestComponent'],
): boolean {
  // A single marker, a thin control stripe, or a few antialiased pixels must
  // not admit a frame. Require meaningful surface area, model-sized global
  // distribution, and one contiguous canonical wall surface.
  const minimumCoverage = Math.max(0.003, 900 / totalPixels)
  const minimumComponentCoverage = Math.max(0.0015, 480 / totalPixels)
  return coverage >= minimumCoverage &&
    bounds.widthRatio >= 0.18 &&
    bounds.heightRatio >= 0.13 &&
    largestComponent.count / totalPixels >= minimumComponentCoverage &&
    (largestComponent.widthRatio >= 0.12 || largestComponent.heightRatio >= 0.1)
}

/** Analyses a completed WebGL pixel buffer for visible canonical wall spans.
 * It deliberately classifies the renderer palette instead of accepting any
 * bright/blue pixel: background, grid, floor, and compact selectors cannot
 * acknowledge a canonical/WASM/renderer generation. */
export function analyzeCurrentThreeDFrame(
  width: number,
  height: number,
  pixels: Uint8Array,
): CurrentThreeDFrameAnalysis {
  const totalPixels = width * height
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || pixels.length < totalPixels * 4) {
    return {
      accepted: false,
      coverage: 0,
      wallPixelCount: 0,
      componentCount: 0,
      bounds: emptyBounds(),
      largestComponent: { ...emptyBounds(), count: 0 },
    }
  }

  const wallMask = new Uint8Array(totalPixels)
  let wallPixelCount = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4
    if (!isWallPixel(pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3])) continue
    wallMask[pixel] = 1
    wallPixelCount += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const seen = new Uint8Array(totalPixels)
  const queue = new Uint32Array(totalPixels)
  let componentCount = 0
  let largestComponent: CurrentThreeDFrameAnalysis['largestComponent'] = { ...emptyBounds(), count: 0 }
  for (let start = 0; start < totalPixels; start += 1) {
    if (!wallMask[start] || seen[start]) continue
    componentCount += 1
    let head = 0
    let tail = 0
    let count = 0
    let componentMinX = width
    let componentMinY = height
    let componentMaxX = -1
    let componentMaxY = -1
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const pixel = queue[head++]
      const x = pixel % width
      const y = Math.floor(pixel / width)
      count += 1
      componentMinX = Math.min(componentMinX, x)
      componentMinY = Math.min(componentMinY, y)
      componentMaxX = Math.max(componentMaxX, x)
      componentMaxY = Math.max(componentMaxY, y)

      const left = pixel - 1
      const right = pixel + 1
      const up = pixel - width
      const down = pixel + width
      if (x > 0 && wallMask[left] && !seen[left]) { seen[left] = 1; queue[tail++] = left }
      if (x + 1 < width && wallMask[right] && !seen[right]) { seen[right] = 1; queue[tail++] = right }
      if (y > 0 && wallMask[up] && !seen[up]) { seen[up] = 1; queue[tail++] = up }
      if (y + 1 < height && wallMask[down] && !seen[down]) { seen[down] = 1; queue[tail++] = down }
    }
    if (count > largestComponent.count) {
      largestComponent = {
        ...boundsFor(componentMinX, componentMinY, componentMaxX, componentMaxY, width, height),
        count,
      }
    }
  }

  const coverage = wallPixelCount / totalPixels
  const bounds = boundsFor(minX, minY, maxX, maxY, width, height)
  return {
    accepted: hasStructuralWallFootprint(totalPixels, coverage, bounds, largestComponent),
    coverage,
    wallPixelCount,
    componentCount,
    bounds,
    largestComponent,
  }
}
