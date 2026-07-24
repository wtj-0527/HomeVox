import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const baseURL = process.env.HOMEVOX_E2E_BASE_URL ?? 'http://127.0.0.1:18088'
const restartURL = process.env.HOMEVOX_E2E_RESTART_URL
const fixturePNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAF0lEQVR4nGL6////fwZkwARjAAIAAP//YgEEAT/f/TcAAAAASUVORK5CYII=',
  'base64',
)
test.use({ baseURL, viewport: { width: 1440, height: 960 } })

type E2EState = {
  geometry: { positionCount: number; normalCount: number; finite: boolean; fingerprint: number }
  walls: Array<{ id: string | null; x1: number; y1: number; x2: number; y2: number }>
  openings: Array<{ id: string | null; wallId: string | null; position: number | null; width: number | null }>
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

async function e2eState(page: Page): Promise<E2EState> {
  return page.evaluate(() => window.__homevoxE2E as E2EState)
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

test('runs upload, parse, canonical 2D/3D, save, restart, and reload as one production lifecycle', async ({ page }, testInfo) => {
  await page.goto('/?e2e=instrument')
  await expect(page.getByRole('heading', { name: '导入真实户型图' })).toBeVisible()
  const captures = [await screenshot(page, testInfo, 'issue-19-import-ai.png')]

  await page.locator('input[type="file"]').setInputFiles({
    name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG,
  })
  await expect(page.getByRole('heading', { name: 'AI 识别', level: 3 })).toBeVisible()
  const parse = page.waitForResponse((response) =>
    response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '开始 AI 识别' }).click()
  expect((await parse).status()).toBe(200)
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await page.getByTestId('wall-hit-wall-1').click({ position: { x: 80, y: 1 }, force: true })
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-1')
  captures.push(await screenshot(page, testInfo, 'issue-19-2d-correction.png'))

  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('heading', { name: '确认 3D 空间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  await expect(page.getByLabel('2D 墙体编辑器')).toHaveCount(0)
  captures.push(await screenshot(page, testInfo, 'issue-19-3d-confirm.png'))

  await page.getByRole('button', { name: '完成并打开 3D' }).click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await expect(page.getByLabel('3D 户型预览')).toBeVisible()
  // Select a real 3D wall, then prove the same stable wallId highlights in 2D and Inspector.
  await page.getByTestId('three-wall-wall-2').click()
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-2')
  await expect(page.getByTestId('wall-hit-wall-2')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('three-wall-wall-2')).toHaveAttribute('aria-pressed', 'true')

  // Reverse the selection from the real 2D wall hit target back into the 3D view.
  await page.getByTestId('wall-hit-wall-3').click({ position: { x: 80, y: 1 }, force: true })
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-3')
  await expect(page.getByTestId('three-wall-wall-3')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '3D 选择窗 window-1' }).click()
  await expect(page.getByTestId('selected-opening-id')).toContainText('window-1')
  await expect(page.getByTestId('selected-opening-id')).toContainText('wall-2')
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-2')
  await expect(page.getByTestId('wall-hit-wall-2')).toHaveAttribute('data-selected', 'true')

  // An opening edit is canonical, undoable and redoable before it is persisted.
  await expect(page.getByTestId('opening-width')).toHaveValue('64')
  await page.getByTestId('opening-width').fill('60')
  await expect(page.getByTestId('opening-width')).toHaveValue('60')
  await page.getByRole('button', { name: '撤销（Ctrl/Cmd + Z）' }).click()
  await expect(page.getByTestId('opening-width')).toHaveValue('64')
  await page.getByRole('button', { name: '重做（Ctrl/Cmd + Shift+Z 或 Ctrl/Cmd + Y）' }).click()
  await expect(page.getByTestId('opening-width')).toHaveValue('60')

  // A real linked 2D endpoint edit must regenerate finite WASM geometry and
  // share the same Undo/Redo history as opening edits.
  const geometryBeforeEndpointEdit = await e2eState(page)
  expect(geometryBeforeEndpointEdit.geometry.finite).toBe(true)
  expect(geometryBeforeEndpointEdit.geometry.positionCount).toBeGreaterThan(0)
  await dragEndpoint(page, 'endpoint-handle-0-start', 30, 20)
  await page.waitForFunction((before) => {
    const current = window.__homevoxE2E
    return Boolean(current?.geometry.finite && current.geometry.fingerprint !== before)
  }, geometryBeforeEndpointEdit.geometry.fingerprint)
  const geometryAfterEndpointEdit = await e2eState(page)
  const editedWall = geometryAfterEndpointEdit.walls.find((wall) => wall.id === 'wall-1')
  expect(editedWall).toBeDefined()
  expect(editedWall).not.toEqual({ id: 'wall-1', x1: 80, y1: 80, x2: 520, y2: 80 })
  expect(geometryAfterEndpointEdit.geometry.fingerprint).not.toBe(geometryBeforeEndpointEdit.geometry.fingerprint)
  await page.getByRole('button', { name: '撤销（Ctrl/Cmd + Z）' }).click()
  await page.waitForFunction((before) => window.__homevoxE2E?.geometry.fingerprint === before, geometryBeforeEndpointEdit.geometry.fingerprint)
  await page.getByRole('button', { name: '重做（Ctrl/Cmd + Shift+Z 或 Ctrl/Cmd + Y）' }).click()
  await page.waitForFunction((after) => window.__homevoxE2E?.geometry.fingerprint === after, geometryAfterEndpointEdit.geometry.fingerprint)
  captures.push(await screenshot(page, testInfo, 'issue-19-linked-workspace.png'))
  const hashes = await Promise.all(captures.map(async (path) => createHash('sha256').update(await readFile(path)).digest('hex')))
  expect(new Set(hashes).size).toBe(4)

  await page.getByRole('button', { name: '保存项目' }).click()
  await page.getByLabel('项目名称').fill('Production lifecycle project')
  const save = page.waitForResponse((response) =>
    response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '创建项目' }).click()
  const saved = await save
  expect(saved.status()).toBe(201)
  const savedProject = await saved.json() as { id: string; revision: number; document: { result: { walls: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>; windows: Array<{ id: string; wallId: string; position: number; width: number }> } } }
  expect(savedProject.id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(savedProject.revision).toBe(1)
  expect(savedProject.document.result.walls.map((wall) => wall.id)).toEqual(['wall-1', 'wall-2', 'wall-3', 'wall-4'])
  expect(savedProject.document.result.walls.find((wall) => wall.id === 'wall-1')).toEqual(editedWall)
  expect(savedProject.document.result.windows).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'window-1', wallId: 'wall-2', width: 60 })]))
  await expect(page.getByText('项目已创建')).toBeVisible()

  expect(restartURL).toBeTruthy()
  const restarted = await page.request.post(restartURL!)
  expect(restarted.status()).toBe(200)
  const pids = await restarted.json() as { oldPid: number; newPid: number }
  expect(pids.newPid).not.toBe(pids.oldPid)

  await page.goto(`/?e2e=instrument&project=${savedProject.id}`)
  await expect(page.getByRole('button', { name: '校正 2D' })).toBeEnabled()
  await page.getByRole('button', { name: '校正 2D' }).click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await page.getByTestId('wall-hit-wall-2').click({ position: { x: 1, y: 80 }, force: true })
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-2')
  await page.getByTestId('opening-handle-window-1').click({ force: true })
  await expect(page.getByTestId('selected-opening-id')).toContainText('window-1')
  await expect(page.getByTestId('opening-width')).toHaveValue('60')
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
  const reloadedGeometry = await e2eState(page)
  expect(reloadedGeometry.geometry.finite).toBe(true)
  expect(reloadedGeometry.geometry.fingerprint).toBe(geometryAfterEndpointEdit.geometry.fingerprint)
  expect(reloadedGeometry.walls.find((wall) => wall.id === 'wall-1')).toEqual(editedWall)
  expect(reloadedGeometry.openings).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'window-1', wallId: 'wall-2', width: 60 }),
  ]))
  const accessibility = await page.locator('body').ariaSnapshot()
  expect(accessibility).not.toMatch(/(?:WASM|Grid|triangles|fallback|结构化 JSON)/i)
  await expect(page.locator('pre')).toHaveCount(0)
})

test('keeps invalid and duplicate canonical identity failures closed', async ({ page }) => {
  await page.goto('/?e2e=invalid-opening')
  await page.getByRole('button', { name: '生成 3D' }).click()
  await expect(page.getByRole('alert')).toContainText('当前开口数据无法生成 3D')
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
  await page.getByRole('button', { name: '返回 2D 校正' }).first().click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()

  await page.goto('/?e2e=duplicate-wall-id')
  await page.getByRole('button', { name: '生成 3D' }).click()
  await expect(page.getByRole('alert')).toContainText('当前开口数据无法生成 3D')
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
})

test('keeps an unavailable Rust/WASM geometry result fail-closed', async ({ page }) => {
  await page.goto('/?e2e=wall-fixture&wasm=load-failure')
  await page.getByRole('button', { name: '生成 3D' }).click()
  await expect(page.getByRole('alert')).toContainText('当前 3D 预览不可用')
  await expect(page.getByLabel('3D 户型预览')).toHaveCount(0)
  await expect(page.getByTestId('wall-shell-floor')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2D/3D 联动' })).toBeDisabled()
  await page.getByRole('button', { name: '返回 2D 校正' }).first().click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
})

test('makes parse retry and persistence-unavailable states actionable', async ({ page }) => {
  await page.goto('/?e2e=instrument')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'controlled-production-floorplan.png', mimeType: 'image/png', buffer: fixturePNG,
  })
  await page.route('**/api/floorplans/parse', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'controlled parse outage' }),
  }))
  await page.getByRole('button', { name: '开始 AI 识别' }).click()
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.getByRole('button', { name: '重试 AI 识别' })).toBeVisible()
  await page.unroute('**/api/floorplans/parse')
  const parse = page.waitForResponse((response) =>
    response.url().endsWith('/api/floorplans/parse') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '重试 AI 识别' }).click()
  expect((await parse).status()).toBe(200)
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()

  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'controlled persistence outage' } }) })
    }
    return route.continue()
  })
  await page.getByRole('button', { name: '保存项目' }).click()
  await page.getByLabel('项目名称').fill('Unavailable persistence')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByRole('status')).toContainText('项目保存失败')
  await page.unroute('**/api/projects')
})

test('keeps the narrow-screen workflow keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?e2e=wall-fixture')
  const correctionStep = page.getByRole('button', { name: '校正 2D' })
  await correctionStep.focus()
  await expect(correctionStep).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  const continueButton = page.getByRole('button', { name: '继续' })
  await continueButton.focus()
  await expect(continueButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '确认 3D 空间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '完成并打开 3D' })).toBeVisible()
})
