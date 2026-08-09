import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const baseURL = process.env.HOMEVOX_E2E_BASE_URL ?? 'http://127.0.0.1:18088'
const restartURL = process.env.HOMEVOX_E2E_RESTART_URL
const fixturePNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAAG4CAIAAAAWqA6UAAAJQklEQVR4nO3VsY1kVRRF0cmCCMgBEQfhkBoh4Y8QBm4ZR8OMxOdWaS9pmW20Xv1z95evf/0NAFlfzv8DADgkhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkPRvCn37+jX91/hG8p/PfBXgrz10bIbx3npz3dP67AG/luWsjhPdeX+z3X/98dV6jQ+e/C/BWnrs2Qnjv9cWE0McDTM9dGyG89/piQujjAabnro0Q3nt9MSH08QDTc9dGCO+9vpgQ+niA6blrI4T3Xl9MCH08wPTctRHCe68vJoQ+HmB67tqchfD8zr4nIYwwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYSKb0wDmJ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxAC8C6EEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgB4P8mhACkCSEAaUIIQJoQAnDmlz++vvpP/vJHCSEAZ4QQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBIBjQghAmhACkCaEAKQJIQDv4qQaQgjAuxBCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANJaIQSA7yeEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkPapIQSANyeEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKT9A4N4s+U669UwAAAAAElFTkSuQmCC',
  'base64',
)
test.use({ baseURL, viewport: { width: 1440, height: 960 } })

type E2EState = {
  geometry: { positionCount: number; normalCount: number; finite: boolean; fingerprint: number; meshVertexCountByWall: Record<string, number> }
  wasm: { state: string; fallback: string | null }
  threeD: {
    canonicalRevision: string | null
    geometryRevision: string | null
    rendererRevision: string | null
    frameRevision: string | null
    currentFrame: boolean
  }
  selectedWallId: string | null
  selectedOpeningId: string | null
  walls: Array<{ id: string | null; x1: number; y1: number; x2: number; y2: number }>
  openings: Array<{ id: string | null; wallId: string | null; position: number | null; width: number | null }>
}

type ParseFixture = {
  filename: string
  contentType: string
  size: number
  result: {
    rooms: unknown[]
    walls: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>
    doors: Array<{ id: string; kind: 'door'; wallId: string; position: number; width: number; source: string; confirmed: boolean }>
    windows: Array<{ id: string; kind: 'window'; wallId: string; position: number; width: number; source: string; confirmed: boolean }>
    scale: { unit: string; pixel_to_unit: number | null }
    metadata: { source: string; confidence: number; image_width: number; image_height: number }
  }
}

const canonicalFixture: ParseFixture = {
  filename: 'controlled-production-floorplan.png', contentType: 'image/png', size: fixturePNG.length,
  result: {
    rooms: [],
    walls: [
      { id: 'wall-1', x1: 80, y1: 80, x2: 520, y2: 80 },
      { id: 'wall-2', x1: 520, y1: 80, x2: 520, y2: 360 },
      { id: 'wall-3', x1: 520, y1: 360, x2: 80, y2: 360 },
      { id: 'wall-4', x1: 80, y1: 360, x2: 80, y2: 80 },
    ],
    doors: [{ id: 'door-1', kind: 'door', wallId: 'wall-1', position: 0.5, width: 72, source: 'test-route', confirmed: false }],
    windows: [{ id: 'window-1', kind: 'window', wallId: 'wall-2', position: 0.5, width: 64, source: 'test-route', confirmed: false }],
    scale: { unit: 'px', pixel_to_unit: null }, metadata: { source: 'test-route', confidence: 1, image_width: 600, image_height: 440 },
  },
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const image = await readFile(path)
  expect(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
  expect(image.readUInt32BE(16)).toBe(1440)
  expect(image.readUInt32BE(20)).toBe(960)
  return path
}

async function expectBox(page: Page, selector: string, expected: { x: number; y: number; width: number; height: number }): Promise<void> {
  const box = await page.locator(selector).boundingBox()
  expect(box, `${selector} missing`).not.toBeNull()
  if (!box) throw new Error(`${selector} missing`)
  expect(Math.round(box.x), `${selector} x`).toBe(expected.x)
  expect(Math.round(box.y), `${selector} y`).toBe(expected.y)
  expect(Math.round(box.width), `${selector} width`).toBe(expected.width)
  expect(Math.round(box.height), `${selector} height`).toBe(expected.height)
}

async function expectCustomerFacingCopy(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\b(?:unknown|canonical|wasm|renderer|revision|fallback|review|gate|json|raw|door|window|undo|redo|calls|timing)\b|未持久化|内部 ID/i)
}

/** Decode a Playwright PNG screenshot to assert what a person can see, rather
 * than treating canvas existence or an instrumented geometry object as proof. */
type PixelImage = { width: number; height: number; bytesPerPixel: number; pixels: Buffer }

function decodePngPixels(png: Buffer): PixelImage {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const chunks: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9] }
    if (type === 'IDAT') chunks.push(data)
    offset += length + 12
  }
  expect([2, 6]).toContain(colorType) // RGB/RGBA 8-bit screenshots from Chromium.
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel
  const compressed = inflateSync(Buffer.concat(chunks))
  const pixels = Buffer.alloc(stride * height)
  let input = 0
  for (let y = 0; y < height; y += 1) {
    const filter = compressed[input++]
    for (let x = 0; x < stride; x += 1) {
      const raw = compressed[input++]
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0
      const paeth = () => { const p = left + up - upperLeft; const a = Math.abs(p - left); const b = Math.abs(p - up); const c = Math.abs(p - upperLeft); return a <= b && a <= c ? left : b <= c ? up : upperLeft }
      pixels[y * stride + x] = (raw + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth())) & 0xff
    }
  }
  return { width, height, bytesPerPixel, pixels }
}

type PixelFootprint = {
  coverage: number
  widthRatio: number
  heightRatio: number
  count: number
}

function isWallRgb(red: number, green: number, blue: number): boolean {
  // Screenshot evidence is intentionally limited to the bright visible wall
  // faces/selected spans. Explicitly exclude section grid #90a4c6 and floor
  // #536d9d before applying the review-oriented material thresholds.
  if (blue - red >= 28 && green - red >= 5) return false
  return (red > 150 && green > 150 && blue > 155) ||
    (red > 95 && blue > 145 && blue - green > 20)
}

function wallFootprintFromImage({ width, height, bytesPerPixel, pixels }: PixelImage): PixelFootprint {
  const stride = width * bytesPerPixel
  let count = 0
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * stride + x * bytesPerPixel
      if (!isWallRgb(pixels[index], pixels[index + 1], pixels[index + 2])) continue
      count += 1
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    coverage: count / (width * height),
    widthRatio: maxX >= minX ? (maxX - minX + 1) / width : 0,
    heightRatio: maxY >= minY ? (maxY - minY + 1) / height : 0,
    count,
  }
}

function openingVoidCoverage(image: PixelImage, centerX: number, centerY: number): number {
  const outerRadius = 28
  const innerRadius = 11 // excludes the small stable-ID WebGL selection marker.
  let samples = 0
  let voidPixels = 0
  for (let y = Math.max(0, Math.floor(centerY - outerRadius)); y <= Math.min(image.height - 1, Math.ceil(centerY + outerRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - outerRadius)); x <= Math.min(image.width - 1, Math.ceil(centerX + outerRadius)); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance < innerRadius || distance > outerRadius) continue
      samples += 1
      const index = (y * image.width + x) * image.bytesPerPixel
      if (!isWallRgb(image.pixels[index], image.pixels[index + 1], image.pixels[index + 2])) voidPixels += 1
    }
  }
  return samples === 0 ? 0 : voidPixels / samples
}

function wallFootprint(png: Buffer): PixelFootprint {
  return wallFootprintFromImage(decodePngPixels(png))
}

function changedFootprint(before: Buffer, after: Buffer): PixelFootprint {
  const first = decodePngPixels(before)
  const second = decodePngPixels(after)
  expect(second.width).toBe(first.width)
  expect(second.height).toBe(first.height)
  expect(second.bytesPerPixel).toBe(first.bytesPerPixel)
  let count = 0
  let minX = first.width
  let maxX = -1
  let minY = first.height
  let maxY = -1
  for (let y = 0; y < first.height; y += 1) {
    for (let x = 0; x < first.width; x += 1) {
      const index = (y * first.width + x) * first.bytesPerPixel
      if (
        Math.abs(first.pixels[index] - second.pixels[index]) <= 8 &&
        Math.abs(first.pixels[index + 1] - second.pixels[index + 1]) <= 8 &&
        Math.abs(first.pixels[index + 2] - second.pixels[index + 2]) <= 8
      ) continue
      count += 1
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    coverage: count / (first.width * first.height),
    widthRatio: maxX >= minX ? (maxX - minX + 1) / first.width : 0,
    heightRatio: maxY >= minY ? (maxY - minY + 1) / first.height : 0,
    count,
  }
}

function cropPageToCanvas(pageImage: Buffer, box: { x: number; y: number; width: number; height: number }): PixelImage {
  const image = decodePngPixels(pageImage)
  const left = Math.max(0, Math.floor(box.x))
  const top = Math.max(0, Math.floor(box.y))
  const right = Math.min(image.width, Math.ceil(box.x + box.width))
  const bottom = Math.min(image.height, Math.ceil(box.y + box.height))
  const width = right - left
  const height = bottom - top
  const stride = width * image.bytesPerPixel
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    image.pixels.copy(
      pixels,
      y * stride,
      ((top + y) * image.width + left) * image.bytesPerPixel,
      ((top + y) * image.width + right) * image.bytesPerPixel,
    )
  }
  return { width, height, bytesPerPixel: image.bytesPerPixel, pixels }
}

function expectReviewableFootprint(footprint: PixelFootprint, source: string): void {
  expect(footprint.count, `${source}: no canonical wall pixels`).toBeGreaterThan(1_400)
  expect(footprint.coverage, `${source}: wall coverage is too sparse to review`).toBeGreaterThan(0.018)
  expect(footprint.widthRatio, `${source}: model is too narrow`).toBeGreaterThan(0.42)
  expect(footprint.heightRatio, `${source}: model is too short`).toBeGreaterThan(0.34)
}

async function waitForCurrentFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__homevoxE2E?.threeD?.currentFrame === true, undefined, { timeout: 5_000 })
}

async function assertReviewableThreeD(page: Page, testInfo: TestInfo, name: string, minimumWidth: number): Promise<string> {
  const canvas = page.getByTestId('three-render-surface')
  await waitForCurrentFrame(page)
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error('3D canvas is not laid out')
  expect(box.width).toBeGreaterThan(minimumWidth)
  expect(box.height).toBeGreaterThan(460)

  const canvasPath = testInfo.outputPath(`${name}-canvas.png`)
  await expect.poll(async () => {
    await canvas.screenshot({ path: canvasPath })
    return wallFootprint(await readFile(canvasPath)).coverage
  }).toBeGreaterThan(0.018)
  expectReviewableFootprint(wallFootprint(await readFile(canvasPath)), `${name} canvas`)

  const fullPath = await screenshot(page, testInfo, `${name}.png`)
  expectReviewableFootprint(wallFootprintFromImage(cropPageToCanvas(await readFile(fullPath), box)), `${name} full page`)
  return fullPath
}

async function assertSelectingOpeningWallKeepsCanvasPixels(page: Page, testInfo: TestInfo): Promise<void> {
  const canvas = page.getByTestId('three-render-surface')
  const beforePath = testInfo.outputPath('opening-wall-before-selection.png')
  const afterPath = testInfo.outputPath('opening-wall-after-selection.png')
  await canvas.screenshot({ path: beforePath })
  await page.getByTestId('three-wall-wall-2').click()
  await expect(page.getByTestId('three-wall-wall-2')).toHaveAttribute('aria-pressed', 'true')
  await canvas.screenshot({ path: afterPath })
  const before = await readFile(beforePath)
  const after = await readFile(afterPath)
  const changed = changedFootprint(before, after)
  // wall-2 owns window-1. Selection must be materially visible along the
  // actual wall spans while remaining far below a solid whole-canvas repaint.
  expect(changed.coverage).toBeGreaterThan(0.008)
  expect(changed.coverage).toBeLessThan(0.18)
  expect(changed.widthRatio).toBeGreaterThan(0.2)
  expect(changed.heightRatio).toBeGreaterThan(0.34)
  expectReviewableFootprint(wallFootprint(after), 'selected wall canvas')

  // window-1's selector is now located at the actual physical opening center.
  // Canvas screenshots omit the DOM selector, letting this verify that the
  // surrounding WebGL pixels remain a real hole after wall highlighting.
  const openingBox = await page.getByTestId('three-opening-button-window-1').boundingBox()
  const canvasBox = await canvas.boundingBox()
  expect(openingBox).not.toBeNull()
  expect(canvasBox).not.toBeNull()
  if (!openingBox || !canvasBox) throw new Error('window opening selector is not laid out')
  const openingCenterX = openingBox.x + openingBox.width / 2 - canvasBox.x
  const openingCenterY = openingBox.y + openingBox.height / 2 - canvasBox.y
  expect(openingVoidCoverage(decodePngPixels(after), openingCenterX, openingCenterY), 'window-1 opening was painted over by selection').toBeGreaterThan(0.4)
}

async function e2eState(page: Page): Promise<E2EState> {
  return page.evaluate(() => window.__homevoxE2E as E2EState)
}

async function selectFile(page: Page): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG,
  })
  await expect(page.getByRole('heading', { name: '导入真实户型图', level: 2 })).toBeVisible()
  await expect(page.getByLabel('已选择的户型图')).toBeVisible()
  await expect(page.getByAltText('上传户型图预览')).toBeVisible()
  await expect(page.getByText('controlled-production-floorplan.png')).toBeVisible()
}

async function parseSelectedFile(page: Page): Promise<void> {
  const parse = page.waitForResponse((response) =>
    response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST',
  )
  expect((await parse).status()).toBe(200)
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
}

async function uploadAndParse(page: Page): Promise<void> {
  const parse = page.waitForResponse((response) => response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST')
  await selectFile(page)
  expect((await parse).status()).toBe(200)
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
}

async function dragEndpoint(page: Page, testID: string, deltaX: number, deltaY: number): Promise<void> {
  const handle = page.getByTestId(testID)
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error(`missing endpoint handle ${testID}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 4 })
  await page.mouse.up()
}

test('runs upload, parse, canonical 2D/3D, save, restart, and reload as one production lifecycle', async ({ page, browser }, testInfo) => {
  await page.goto('/?e2e=instrument')
  await expect(page.getByTestId('product-topbar').getByRole('heading', { name: '导入真实户型图' })).toBeVisible()
  await expect(page.getByTestId('product-sidebar')).toHaveCSS('width', '232px')
  await expect(page.getByTestId('product-topbar')).toHaveCSS('height', '72px')
  await selectFile(page)
  await expectBox(page, '.import-workspace > div', { x: 268, y: 112, width: 700, height: 780 })
  await expectBox(page, '.import-workspace > aside', { x: 996, y: 112, width: 396, height: 780 })
  await expectBox(page, '.source-plan-image', { x: 318, y: 188, width: 600, height: 560 })
  await expectCustomerFacingCopy(page)
  await expect(page.locator('.product-step[data-completed="true"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /导入户型图，当前步骤，已完成/ })).toBeVisible()
  const captures = [await screenshot(page, testInfo, 'issue-19-import-ai.png')]
  await parseSelectedFile(page)
  const visionURL = new URL(baseURL); visionURL.port = '18089'; visionURL.pathname = '/e2e/requests'
  const visionFacts = await (await page.request.get(visionURL.toString())).json() as Array<{ prompt: string; width: number; height: number; imageDiffers: boolean; cropMatches?: boolean }>
  expect(visionFacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ prompt: 'candidate', width: 600, height: 440, imageDiffers: false }),
    expect.objectContaining({ prompt: 'parse', width: 560, height: 400, imageDiffers: true, cropMatches: true }),
  ]))
  await expect(page.getByRole('button', { name: /AI 识别，已完成/ })).toBeVisible()
  await page.getByRole('button', { name: /AI 识别，已完成/ }).click()
  await expect(page.getByLabel('户型裁切区域')).toHaveAttribute('viewBox', '0 0 600 440')
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled recrop outage' }) }))
  await page.getByLabel('户型裁切区域').focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: '确认裁切并判断' }).click()
  await expect(page.getByRole('alert')).toContainText('识别服务暂时不可用')
  await expect(page.getByRole('button', { name: /校正 2D，未解锁/ })).toBeDisabled()
  await page.unroute('**/api/floorplans/parse')
  const recropRetry = page.waitForResponse((response) => response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认裁切并判断' }).click()
  expect((await recropRetry).status()).toBe(200)
  await page.getByRole('button', { name: /校正 2D/ }).click()
  await expect(page.getByRole('button', { name: /校正 2D，当前步骤/ })).toBeVisible()
  await expectBox(page, '.two-d-editor-frame', { x: 256, y: 92, width: 870, height: 800 })
  await expectBox(page, '.two-d-product-workspace .inspector-card', { x: 1146, y: 92, width: 246, height: 800 })
  // The editor mounts only after import/recognition. Its hit targets must use
  // the actual CSS-pixel canvas size, not the old 0×0 fallback.
  const endpointHitTarget = await page.getByTestId('endpoint-handle-0-start').boundingBox()
  expect(endpointHitTarget).not.toBeNull()
  expect(Math.min(endpointHitTarget?.width ?? 0, endpointHitTarget?.height ?? 0)).toBeGreaterThanOrEqual(14)
  await expectCustomerFacingCopy(page)
  await page.getByTestId('wall-hit-wall-1').click({ position: { x: 80, y: 1 }, force: true })
  await expect.poll(async () => (await e2eState(page)).selectedWallId).toBe('wall-1')
  await expect(page.getByLabel('起点 X')).toHaveValue('60')
  await page.getByLabel('起点 X').fill('90')
  await page.getByLabel('起点 Y').fill('90')
  await page.getByRole('button', { name: '应用坐标' }).click()
  await expect.poll(async () => (await e2eState(page)).walls.find((wall) => wall.id === 'wall-1')).toMatchObject({ x1: 90, y1: 90 })

  const snapshotCreate = page.waitForResponse((response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST')
  await page.getByTestId('save-recognition-snapshot').click()
  const createdSnapshotResponse = await snapshotCreate
  expect(createdSnapshotResponse.status()).toBe(201)
	expect(createdSnapshotResponse.headers()['cache-control']).toBe('no-store')
	const createdSnapshot = await createdSnapshotResponse.json() as { id: string; revision: number; capability: string }
	expect(createdSnapshot.revision).toBe(1)
	expect(createdSnapshot.capability).toMatch(/^[A-Za-z0-9_-]{43}$/)
	await expect(page.getByRole('button', { name: '复制编辑链接' })).toBeVisible()
	const capabilityHeader = 'x-homevox-project-capability'
	const visionFactsBeforeResume = await (await page.request.get(visionURL.toString())).json() as unknown[]
	const visionRequestCountBeforeResume = visionFactsBeforeResume.length
	const independentContext = await browser.newContext()
	const independentPage = await independentContext.newPage()
	let failFirstResume = true
	await independentPage.route(`**/api/projects/${createdSnapshot.id}`, (route) => {
		if (route.request().method() === 'GET' && failFirstResume) {
			failFirstResume = false
			return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'controlled resume outage' } }) })
		}
		return route.continue()
	})
	await independentPage.goto(`/?e2e=instrument#project=${createdSnapshot.id}&cap=${createdSnapshot.capability}`)
	await expect(independentPage.getByRole('alert')).toContainText('项目加载失败')
	await expect(independentPage.getByRole('button', { name: '重试加载项目' })).toBeVisible()
	const independentProjectGet = independentPage.waitForRequest((request) => request.url().endsWith(`/api/projects/${createdSnapshot.id}`) && request.method() === 'GET')
	const independentSourceGet = independentPage.waitForRequest((request) => request.url().endsWith(`/api/projects/${createdSnapshot.id}/source-image`) && request.method() === 'GET')
	await independentPage.getByRole('button', { name: '重试加载项目' }).click()
	await expect(independentPage.getByLabel('2D 墙体编辑器')).toBeVisible()
	const independentProjectRequest = await independentProjectGet
	const independentSourceRequest = await independentSourceGet
	expect(independentProjectRequest.headers()[capabilityHeader] === createdSnapshot.capability).toBe(true)
	expect(independentSourceRequest.headers()[capabilityHeader] === createdSnapshot.capability).toBe(true)
	expect(new URL(independentPage.url()).hash).toBe('')
	const visionFactsAfterResume = await (await independentPage.request.get(visionURL.toString())).json() as unknown[]
	expect(visionFactsAfterResume).toHaveLength(visionRequestCountBeforeResume)
	await independentContext.close()
	const replacementContext = await browser.newContext()
	const replacementPage = await replacementContext.newPage()
	await replacementPage.route(`**/api/projects/${createdSnapshot.id}`, (route) => route.request().method() === 'GET'
		? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'controlled replacement outage' } }) })
		: route.continue())
	await replacementPage.goto(`/?e2e=instrument#project=${createdSnapshot.id}&cap=${createdSnapshot.capability}`)
	await expect(replacementPage.getByRole('alert')).toContainText('项目加载失败')
	await expect(replacementPage.getByRole('button', { name: '重试加载项目' })).toBeVisible()
	await replacementPage.locator('input[type="file"]').first().setInputFiles({
		name: 'replacement-floorplan.png',
		mimeType: 'image/png',
		buffer: fixturePNG,
	})
	await expect(replacementPage.getByRole('button', { name: '重试加载项目' })).toHaveCount(0)
	await expect(replacementPage.getByRole('alert')).toHaveCount(0)
	await replacementContext.close()
	await page.route(`**/api/projects/${createdSnapshot.id}`, (route) => route.request().method() === 'PUT'
		? (expect(route.request().headers()[capabilityHeader] === createdSnapshot.capability).toBe(true), route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'revision_conflict', message: 'project has changed' } }) }))
		: route.continue())
  await page.getByTestId('save-recognition-snapshot').click()
  const conflictAlert = page.getByRole('alert')
  await expect(conflictAlert).toContainText('项目已在其他页面更新，请加载最新版本后再保存')
  await expect(conflictAlert).not.toContainText(createdSnapshot.id)
  await expect(conflictAlert).not.toContainText(/revision|HTTP 409/i)
  await page.unroute(`**/api/projects/${createdSnapshot.id}`)
  const reload = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${createdSnapshot.id}`) && response.request().method() === 'GET')
  await page.getByRole('button', { name: '加载最新版本' }).click()
  const reloadResponse = await reload
  expect(reloadResponse.status()).toBe(200)
  expect(reloadResponse.request().headers()[capabilityHeader] === createdSnapshot.capability).toBe(true)
  await expect(page.getByTestId('wall-hit-wall-1')).toHaveAttribute('x1', '90')
  captures.push(await screenshot(page, testInfo, 'issue-19-2d-correction.png'))

  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: /校正 2D，已完成/ })).toBeVisible()
  await expect(page.getByLabel('3D 户型预览')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '空间预览已准备好' })).toBeVisible()
  await expectBox(page, '.three-generation > div', { x: 268, y: 112, width: 812, height: 780 })
  await expectBox(page, '.three-generation > aside', { x: 1108, y: 112, width: 284, height: 780 })
  await expectCustomerFacingCopy(page)
  await expect(page.getByLabel('2D 墙体编辑器')).toHaveCount(0)
  captures.push(await assertReviewableThreeD(page, testInfo, 'issue-19-3d-confirm', 700))

  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await expect(page.getByRole('button', { name: /生成 3D，已完成/ })).toBeVisible()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await expect(page.getByLabel('3D 户型预览')).toBeVisible()
  await expectBox(page, '.linked-product-workspace', { x: 256, y: 92, width: 1136, height: 800 })
  await expectCustomerFacingCopy(page)
  await assertReviewableThreeD(page, testInfo, 'issue-19-linked-workspace-initial', 500)
  await assertSelectingOpeningWallKeepsCanvasPixels(page, testInfo)
  await expect.poll(async () => (await e2eState(page)).selectedWallId).toBe('wall-2')
  await expect(page.getByTestId('wall-hit-wall-2')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('three-wall-wall-2')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('wall-hit-wall-3').click({ position: { x: 80, y: 1 }, force: true })
  await expect.poll(async () => (await e2eState(page)).selectedWallId).toBe('wall-3')
  await expect(page.getByTestId('three-wall-wall-3')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '选择窗洞' }).click()
  await expect.poll(async () => (await e2eState(page)).selectedOpeningId).toBe('window-1')
  await expect.poll(async () => (await e2eState(page)).selectedWallId).toBe('wall-2')
  await expect(page.getByTestId('wall-hit-wall-2')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('opening-width')).toHaveValue('64')
  await page.getByTestId('opening-width').fill('60')
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await waitForCurrentFrame(page)
  await expect(page.getByLabel('导出3D白模PNG')).toBeEnabled()
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByTestId('opening-width')).toHaveValue('64')
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await waitForCurrentFrame(page)
  await page.getByRole('button', { name: '重做' }).click()
  await expect(page.getByTestId('opening-width')).toHaveValue('60')
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await waitForCurrentFrame(page)
  await expect(page.getByLabel('导出3D白模PNG')).toBeEnabled()

  const geometryBeforeEndpointEdit = await e2eState(page)
  expect(geometryBeforeEndpointEdit.geometry.finite).toBe(true)
  expect(geometryBeforeEndpointEdit.geometry.positionCount).toBeGreaterThan(0)
  await dragEndpoint(page, 'endpoint-handle-0-start', 30, 20)
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await page.waitForFunction((before) => {
    const current = window.__homevoxE2E
    return Boolean(current?.geometry.finite && current.geometry.fingerprint !== before)
  }, geometryBeforeEndpointEdit.geometry.fingerprint)
  await waitForCurrentFrame(page)
  await expect(page.getByLabel('导出3D白模PNG')).toBeEnabled()
  const geometryAfterEndpointEdit = await e2eState(page)
  const editedWall = geometryAfterEndpointEdit.walls.find((wall) => wall.id === 'wall-1')
  expect(editedWall).toBeDefined()
  expect(editedWall).not.toEqual({ id: 'wall-1', x1: 80, y1: 80, x2: 520, y2: 80 })
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await page.waitForFunction((before) => window.__homevoxE2E?.geometry.fingerprint === before, geometryBeforeEndpointEdit.geometry.fingerprint)
  await waitForCurrentFrame(page)
  await page.getByRole('button', { name: '重做' }).click()
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  await page.waitForFunction((after) => window.__homevoxE2E?.geometry.fingerprint === after, geometryAfterEndpointEdit.geometry.fingerprint)
  await waitForCurrentFrame(page)
  await expect(page.getByRole('button', { name: /2D\/3D 联动，当前步骤/ })).toBeVisible()
  captures.push(await assertReviewableThreeD(page, testInfo, 'issue-19-linked-workspace', 500))
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: /2D\/3D 联动，已完成/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /保存项目，当前步骤/ })).toBeVisible()
  const hashes = await Promise.all(captures.map(async (path) => createHash('sha256').update(await readFile(path)).digest('hex')))
  expect(new Set(hashes).size).toBe(4)

  await page.getByLabel('项目名称').fill('Production lifecycle project')
  const save = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${createdSnapshot.id}`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const saved = await save
  expect(saved.status()).toBe(200)
  expect(saved.request().headers()[capabilityHeader] === createdSnapshot.capability).toBe(true)
  const savedProject = await saved.json() as { id: string; revision: number; document: { result: { walls: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>; windows: Array<{ id: string; wallId: string; position: number; width: number }> } } }
  expect(savedProject.id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(savedProject.revision).toBe(2)
  await expect(page.getByRole('button', { name: /保存项目.*已完成/ })).toBeVisible()
  expect(savedProject.document.result.walls.find((wall) => wall.id === 'wall-1')).toEqual(editedWall)
  expect(savedProject.document.result.windows).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'window-1', wallId: 'wall-2', width: 60 })]))

  expect(restartURL).toBeTruthy()
  const restarted = await page.request.post(restartURL!)
  expect(restarted.status()).toBe(200)
  const pids = await restarted.json() as { oldPid: number; newPid: number }
  expect(pids.newPid).not.toBe(pids.oldPid)

	const directReload = await page.request.get(`/api/projects/${savedProject.id}`, {
		headers: { 'X-HomeVox-Project-Capability': createdSnapshot.capability },
	})
	expect(directReload.status(), await directReload.text()).toBe(200)
	const restartedContext = await browser.newContext()
	const restartedPage = await restartedContext.newPage()
	const restartedProjectGet = restartedPage.waitForResponse((response) => response.url().endsWith(`/api/projects/${savedProject.id}`) && response.request().method() === 'GET')
	const restartedSourceGet = restartedPage.waitForResponse((response) => response.url().endsWith(`/api/projects/${savedProject.id}/source-image`) && response.request().method() === 'GET')
	await restartedPage.goto(`/?e2e=instrument#project=${savedProject.id}&cap=${createdSnapshot.capability}`)
	const restartedProjectResponse = await restartedProjectGet
	expect(restartedProjectResponse.status(), await restartedProjectResponse.text()).toBe(200)
	const restartedSourceResponse = await restartedSourceGet
	expect(restartedSourceResponse.status(), await restartedSourceResponse.text()).toBe(200)
	await expect(restartedPage.getByRole('button', { name: /校正 2D，当前步骤/ })).toBeEnabled()
	expect(new URL(restartedPage.url()).hash).toBe('')
	await expect(restartedPage.getByRole('button', { name: /导入户型图，已完成/ })).toBeVisible()
	await expect(restartedPage.getByRole('button', { name: /AI 识别，已完成/ })).toBeVisible()
	await expect(restartedPage.getByRole('button', { name: /保存项目，未解锁/ })).toBeDisabled()
	await restartedPage.getByRole('button', { name: /校正 2D，当前步骤/ }).click()
	await expect(restartedPage.getByLabel('2D 墙体编辑器')).toBeVisible()
	await restartedPage.getByTestId('opening-handle-window-1').click({ force: true })
	await expect(restartedPage.getByTestId('opening-width')).toHaveValue('60')
	await restartedPage.getByTestId('complete-product-step').click()
	await expect(restartedPage.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
	const reloadedGeometry = await e2eState(restartedPage)
  expect(reloadedGeometry.geometry.finite).toBe(true)
  expect(reloadedGeometry.geometry.fingerprint).toBe(geometryAfterEndpointEdit.geometry.fingerprint)
  expect(reloadedGeometry.walls.find((wall) => wall.id === 'wall-1')).toEqual(editedWall)
  const accessibility = await restartedPage.locator('body').ariaSnapshot()
  expect(accessibility).not.toMatch(/(?:WASM|Grid|triangles|fallback|结构化 JSON)/i)
  await expect(restartedPage.locator('pre')).toHaveCount(0)
  await restartedContext.close()
})

test('meshes the short parallel wall through the compiled Rust/WASM path', async ({ page }) => {
  const mixedOrientation: ParseFixture = {
    ...canonicalFixture,
    result: {
      ...canonicalFixture.result,
      walls: [
        ...canonicalFixture.result.walls,
        { id: 'long-interior', x1: 80, y1: 140, x2: 520, y2: 140 },
        { id: 'short-parallel', x1: 240, y1: 260, x2: 360, y2: 260 },
        { id: 'diagonal', x1: 360, y1: 200, x2: 450, y2: 290 },
      ],
      doors: [], windows: [],
      metadata: canonicalFixture.result.metadata,
    },
  }
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(mixedOrientation) }))
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await expect.poll(async () => (await e2eState(page)).wasm.state).toBe('active')
  const state = await e2eState(page)
  expect(state.geometry.finite).toBe(true)
  expect(state.geometry.meshVertexCountByWall['short-parallel']).toBeGreaterThan(0)
})

test('keeps a selected composite candidate and adjusted crop after parse failure', async ({ page }) => {
  const visionURL = new URL(baseURL)
  visionURL.port = '18089'
  visionURL.pathname = '/e2e/candidate-mode'
  const mode = await page.request.post(visionURL.toString(), { data: { mode: 'composite' } })
  expect(mode.status()).toBe(204)
  try {
    await page.goto('/?e2e=instrument')
    await selectFile(page)
    await expect(page.getByRole('button', { name: /候选 1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /候选 2/ })).toBeVisible()
    await page.getByRole('button', { name: /候选 2/ }).click()
    await expect(page.getByTestId('crop-selection')).toHaveAttribute('x', '320')
    await page.getByLabel('户型裁切区域').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('crop-selection')).toHaveAttribute('x', '321')
    await page.route('**/api/floorplans/parse', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled composite outage' }) }))
    await page.getByRole('button', { name: '确认裁切并判断' }).click()
    await expect(page.getByRole('alert')).toContainText('识别服务暂时不可用')
    await expect(page.getByRole('button', { name: /候选 2/ })).toBeVisible()
    await expect(page.getByTestId('crop-selection')).toHaveAttribute('x', '321')
    const retainedOriginal = page.getByLabel('户型裁切区域')
    await expect(retainedOriginal).toHaveAttribute('viewBox', '0 0 600 440')
    await expect(retainedOriginal.locator('image')).toHaveAttribute('href', /^blob:/)
    await expect(page.getByRole('button', { name: '确认裁切并判断' })).toBeEnabled()
  } finally {
    await page.request.post(visionURL.toString(), { data: { mode: 'single' } })
  }
})

test('shows an explicit judging process while a confirmed crop is being parsed', async ({ page }) => {
  let releaseParse!: () => void
  const parseReleased = new Promise<void>((resolve) => { releaseParse = resolve })
  await page.route('**/api/floorplans/candidates', (route) => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'ai_content_unreliable' }),
  }))
  await page.route('**/api/floorplans/parse', async (route) => {
    await parseReleased
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ai_content_unreliable' }),
    })
  })
  await page.goto('/?e2e=instrument')
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG,
  })
  await expect(page.getByRole('alert')).toContainText('手动全图裁切')
  await expect(page.getByLabel('户型裁切区域')).toBeVisible()
  await page.getByRole('button', { name: '确认裁切并判断' }).click()

  await expect(page.getByRole('status')).toContainText('正在判断当前裁切区域')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('无法可靠判断户型区域')).toHaveCount(0)
  await expect(page.getByLabel('户型裁切区域')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('当前裁切区域已锁定，判断完成后可继续调整。')).toBeVisible()
  await expect(page.getByTestId('crop-selection')).toHaveCSS('opacity', '0.35')
  await expect(page.locator('[data-crop-handle]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '全图裁切' })).toBeDisabled()
  const judgingButton = page.getByRole('button', { name: '正在判断…' })
  await expect(judgingButton).toBeDisabled()
  await expect(judgingButton).toHaveCSS('background-color', 'rgb(203, 213, 225)')

  releaseParse()
  await expect(page.getByRole('alert')).toContainText('当前裁切区域')
  await expect(page.getByRole('alert')).toContainText('完整、无遮挡')
})

test('does not describe an automatic single crop as user-confirmed after parse failure', async ({ page }) => {
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'ai_content_unreliable' }),
  }))
  await page.goto('/?e2e=instrument')
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG,
  })

  await expect(page.getByRole('alert')).toContainText('裁切到单个户型')
  await expect(page.getByRole('alert')).not.toContainText('当前裁切区域')
  await expect(page.getByLabel('户型裁切区域')).toBeVisible()
})

test('falls back to an adjustable full-image crop when candidate analysis fails', async ({ page }) => {
  await page.route('**/api/floorplans/candidates', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'ai_transport_unavailable', error: 'controlled analysis outage' }) }))
  await page.goto('/?e2e=instrument')
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG })
  await expect(page.getByRole('alert')).toContainText('手动全图裁切')
  await expect(page.getByRole('button', { name: /候选/ })).toHaveCount(0)
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('x', '0')
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('y', '0')
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('width', '600')
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('height', '440')
  await expect(page.getByRole('button', { name: '确认裁切并判断' })).toBeEnabled()
})

test('does not publish stale candidate analysis after a replacement file is selected', async ({ page }) => {
  let firstRequestStarted!: () => void
  let releaseFirst!: () => void
  const started = new Promise<void>((resolve) => { firstRequestStarted = resolve })
  const release = new Promise<void>((resolve) => { releaseFirst = resolve })
  let requests = 0
  await page.route('**/api/floorplans/candidates', async (route) => {
    requests += 1
    if (requests === 1) {
      firstRequestStarted()
      await release
      try {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'composite', candidates: [{ x: 20, y: 20, width: 260, height: 400 }, { x: 320, y: 20, width: 260, height: 400 }] }) })
      } catch {
        // The first browser request is expected to be aborted by replacement.
      }
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'uncertain', candidates: [] }) })
  })
  await page.goto('/?e2e=instrument')
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: fixturePNG })
  await started
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: fixturePNG })
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('width', '600')
  releaseFirst()
  await page.waitForTimeout(100)
  await expect(page.getByRole('button', { name: /候选/ })).toHaveCount(0)
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('x', '0')
  await expect(page.getByTestId('crop-selection')).toHaveAttribute('width', '600')
})

test('keeps invalid and duplicate canonical identity failures closed', async ({ page }) => {
  const invalid: ParseFixture = { ...canonicalFixture, result: { ...canonicalFixture.result, doors: [{ id: 'door-invalid', kind: 'door', wallId: 'missing-wall', position: 0.5, width: 72, source: 'test-route', confirmed: false }], windows: [] } }
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(invalid) }))
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await expect(page.getByText('这个户型有一处需要调整', { exact: false })).toBeVisible()
  await expect(page.getByTestId('complete-product-step')).toBeDisabled()
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await page.unroute('**/api/floorplans/parse')

  const duplicate: ParseFixture = { ...canonicalFixture, result: { ...canonicalFixture.result, walls: [{ id: 'wall-duplicate', x1: 80, y1: 80, x2: 520, y2: 80 }, { id: 'wall-duplicate', x1: 520, y1: 80, x2: 520, y2: 360 }], doors: [{ id: 'door-duplicate', kind: 'door', wallId: 'wall-duplicate', position: 0.5, width: 72, source: 'test-route', confirmed: false }], windows: [] } }
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(duplicate) }))
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await expect(page.getByText('这个户型有一处需要调整', { exact: false })).toBeVisible()
  await expect(page.getByTestId('complete-product-step')).toBeDisabled()
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
})

test('rejects a 2D endpoint drag that would create a zero-length wall', async ({ page }) => {
  const withoutOpenings: ParseFixture = { ...canonicalFixture, result: { ...canonicalFixture.result, doors: [], windows: [] } }
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(withoutOpenings) }))
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  const start = await page.getByTestId('endpoint-handle-0-start').boundingBox()
  const end = await page.getByTestId('endpoint-handle-0-end').boundingBox()
  expect(start).not.toBeNull()
  expect(end).not.toBeNull()
  if (!start || !end) throw new Error('missing wall endpoint handles')
  await dragEndpoint(page, 'endpoint-handle-0-start', end.x - start.x, end.y - start.y)
  const afterDrag = await e2eState(page)
  expect(afterDrag.walls.find((wall) => wall.id === 'wall-1')).toEqual({ id: 'wall-1', x1: 80, y1: 80, x2: 520, y2: 80 })
  await expect(page.getByRole('alert')).toContainText('暂时无法这样调整')
  await expect(page.getByTestId('complete-product-step')).toBeEnabled()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
})

test('keeps an unavailable Rust/WASM geometry result fail-closed', async ({ page }) => {
  await page.goto('/?e2e=instrument&wasm=load-failure')
  await uploadAndParse(page)
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('alert')).toContainText('当前无法显示空间预览')
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
  await page.getByRole('button', { name: '返回 2D 校正' }).first().click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
})

test('makes parse retry and persistence-unavailable states actionable', async ({ page }) => {
  await page.goto('/?e2e=instrument')
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled parse outage' }) }))
  await selectFile(page)
  await expect(page.getByRole('alert')).toContainText('识别服务暂时不可用')
  await expect(page.getByRole('button', { name: '确认裁切并判断' })).toBeVisible()
  await expect(page.getByRole('button', { name: /AI 识别，已完成/ })).toHaveCount(0)
  await page.unroute('**/api/floorplans/parse')
  const retry = page.waitForResponse((response) => response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认裁切并判断' }).click()
  expect((await retry).status()).toBe(200)
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await page.getByTestId('complete-product-step').click()
  await page.route('**/api/projects', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'controlled persistence outage' } }) })
    : route.continue())
  await page.getByRole('button', { name: '保存项目' }).click()
  await page.getByLabel('项目名称').fill('Unavailable persistence')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByRole('alert')).toContainText('项目保存失败')
})

test('keeps the narrow-screen workflow keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  const correctionStep = page.getByRole('button', { name: '校正 2D' })
  await correctionStep.focus()
  await expect(correctionStep).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  const continueButton = page.getByTestId('complete-product-step')
  await continueButton.focus()
  await expect(continueButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '空间预览已准备好' })).toBeVisible()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
})

test('keeps 3D export unavailable in the pure 2D view after an invalid drag is rejected', async ({ page }) => {
  const withoutOpenings: ParseFixture = { ...canonicalFixture, result: { ...canonicalFixture.result, doors: [], windows: [] } }
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(withoutOpenings) }))
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await expect(page.getByLabel('导出3D白模PNG')).toBeEnabled()
  await page.getByRole('button', { name: /校正 2D/ }).click()
  const start = await page.getByTestId('endpoint-handle-0-start').boundingBox()
  const end = await page.getByTestId('endpoint-handle-0-end').boundingBox()
  expect(start).not.toBeNull()
  expect(end).not.toBeNull()
  if (!start || !end) throw new Error('missing wall endpoint handles')
  await dragEndpoint(page, 'endpoint-handle-0-start', end.x - start.x, end.y - start.y)
  await expect(page.getByRole('alert')).toContainText('暂时无法这样调整')
  await expect(page.getByLabel('导出3D白模PNG')).toBeDisabled()
  let downloads = 0
  page.on('download', () => { downloads += 1 })
  await page.getByLabel('导出3D白模PNG').evaluate((element) => (element as HTMLButtonElement).click())
  expect(downloads).toBe(0)
})

test('disables export for a valid canonical edit until the matching WASM, renderer, and visible frame arrive', async ({ page }) => {
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await waitForCurrentFrame(page)
  const exportButton = page.getByLabel('导出3D白模PNG')
  await expect(exportButton).toBeEnabled()
  const before = await e2eState(page)

  await page.getByRole('button', { name: '选择窗洞' }).click()
  await page.getByTestId('opening-width').fill('60')
  const during = await e2eState(page)
  expect(during.threeD.canonicalRevision).not.toBe(before.threeD.canonicalRevision)
  expect(during.threeD.currentFrame).toBe(false)
  await expect(exportButton).toBeDisabled()
  let downloads = 0
  page.on('download', () => { downloads += 1 })
  await exportButton.evaluate((element) => (element as HTMLButtonElement).click())
  expect(downloads).toBe(0)

  await page.waitForFunction((revision) => {
    const current = window.__homevoxE2E
    return current?.threeD.canonicalRevision === revision &&
      current.threeD.geometryRevision === revision &&
      current.threeD.rendererRevision === revision &&
      current.threeD.frameRevision === revision &&
      current.threeD.currentFrame === true
  }, during.threeD.canonicalRevision)
  await expect(exportButton).toBeEnabled()
})

test('drops an in-flight old 3D canvas blob after a legal canonical edit', async ({ page }) => {
  await page.goto('/?e2e=instrument')
  await uploadAndParse(page)
  await page.getByTestId('complete-product-step').click()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await waitForCurrentFrame(page)
  const exportButton = page.getByLabel('导出3D白模PNG')
  await expect(exportButton).toBeEnabled()

  await page.evaluate(() => {
    type PendingBlobGate = { started: boolean; release: (() => void) | null }
    const target = window as typeof window & { __homevoxPendingBlobGate?: PendingBlobGate }
    const surface = document.querySelector('[data-testid="three-render-surface"]')
    const canvas = surface instanceof HTMLCanvasElement
      ? surface
      : surface?.querySelector('canvas') ?? null
    if (!canvas) throw new Error('missing 3D canvas')
    const originalToBlob = canvas.toBlob.bind(canvas)
    const gate: PendingBlobGate = { started: false, release: null }
    target.__homevoxPendingBlobGate = gate
    canvas.toBlob = (callback, type, quality) => {
      gate.started = true
      gate.release = () => originalToBlob(callback, type, quality)
    }
  })
  let downloads = 0
  page.on('download', () => { downloads += 1 })
  await exportButton.click()
  await page.waitForFunction(() => {
    const target = window as typeof window & { __homevoxPendingBlobGate?: { started: boolean } }
    return target.__homevoxPendingBlobGate?.started === true
  })

  const beforeEdit = await e2eState(page)
  await page.getByRole('button', { name: '选择窗洞' }).click()
  await page.getByTestId('opening-width').fill('60')
  const duringEdit = await e2eState(page)
  expect(duringEdit.threeD.canonicalRevision).not.toBe(beforeEdit.threeD.canonicalRevision)
  await expect(exportButton).toBeDisabled()

  await page.evaluate(() => {
    const target = window as typeof window & { __homevoxPendingBlobGate?: { release: (() => void) | null } }
    const release = target.__homevoxPendingBlobGate?.release
    if (!release) throw new Error('3D canvas blob export did not start')
    release()
  })
  await expect(page.getByRole('alert')).toContainText('导出未完成，请稍后再试。')
  await expect(exportButton).toHaveText('导出空间图')
  expect(downloads).toBe(0)
})
