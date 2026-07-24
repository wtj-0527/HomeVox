import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const baseURL = process.env.HOMEVOX_E2E_BASE_URL ?? 'http://127.0.0.1:18088'
const restartURL = process.env.HOMEVOX_E2E_RESTART_URL

test.use({ baseURL, viewport: { width: 1440, height: 960 } })

test('loads production Rust/WASM mesh, persists a fixture project, keeps the latest drag generation, exports PNG, and rebuilds from storage', async ({ page }) => {
  const wasmResponses: string[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('.wasm')) wasmResponses.push(response.headers()['content-type'] ?? '')
  })

  await page.goto('/?e2e=wall-fixture')
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  await expect(page.getByTestId('wasm-grid')).toHaveText(/17×17×17/)

  const initial = await page.evaluate(() => window.__homevoxE2E)
  expect(initial?.wasmCalls).toBeGreaterThan(0)
  expect(initial?.geometry.positionCount).toBeGreaterThan(0)
  expect(initial?.geometry.normalCount).toBeGreaterThan(0)
  expect(initial?.geometry.finite).toBe(true)
  expect(initial?.metrics.triangleCount).toBeGreaterThan(0)
  expect(initial?.metrics.vertexCount).toBeGreaterThan(0)
  expect(initial?.metrics.inputBytes).toBe(17 ** 3 * 4)
  expect(initial?.metrics.outputBytes).toBeGreaterThan(0)

  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByText('项目已创建')).toBeVisible()
  const persistedProjectID = await page.evaluate(() => window.__homevoxE2E?.currentProjectId)
  expect(persistedProjectID).toMatch(/^[0-9a-f-]{36}$/i)

  const endpoint = page.getByTestId('endpoint-handle-0-start')
  const box = await endpoint.boundingBox()
  expect(box).not.toBeNull()
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(page.getByText('拖拽中')).toBeVisible()
  await page.mouse.move(x + 80, y + 50, { steps: 4 })
  await page.mouse.move(x + 120, y + 70, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.generation ?? 0))
    .toBeGreaterThan(initial?.generation ?? 0)
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  const dragged = await page.evaluate(() => window.__homevoxE2E)
  expect(dragged?.geometry.finite).toBe(true)

  await page.getByRole('button', { name: /撤销/ }).click()
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.generation ?? 0))
    .toBeGreaterThan(dragged?.generation ?? 0)
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  const undone = await page.evaluate(() => window.__homevoxE2E)
  await page.getByRole('button', { name: /重做/ }).click()
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.generation ?? 0))
    .toBeGreaterThan(undone?.generation ?? 0)
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  const redone = await page.evaluate(() => window.__homevoxE2E)
  expect(redone?.generation).toBeGreaterThan(dragged?.generation ?? 0)
  expect(redone?.geometry.finite).toBe(true)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出3D白模PNG' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)

  await page.goto(`/?e2e=wall-fixture&project=${persistedProjectID}`)
  await expect(page.getByText('项目已加载')).toBeVisible()
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  const reloaded = await page.evaluate(() => window.__homevoxE2E)
  expect(reloaded?.currentProjectId).toBe(persistedProjectID)
  expect(reloaded?.wasmCalls).toBeGreaterThan(0)
  expect(reloaded?.geometry.finite).toBe(true)
  expect(wasmResponses.some((contentType) => contentType.includes('application/wasm'))).toBe(true)
})

test('uses the adapter load failure branch to fall back while retaining the wall shell and 2D editor', async ({ page }) => {
  await page.goto('/?e2e=wall-fixture&wasm=load-failure')
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/fallback/)
  await expect(page.getByTestId('wasm-resource-metrics')).toHaveText(/fallback: load-failed/)
  await expect(page.getByTestId('wasm-resource-metrics')).toContainText(/wall-shell [1-9]/)
  await expect(page.getByRole('img', { name: '户型图墙体端点编辑区' })).toBeVisible()
})

test('edits wall-local openings atomically and preserves stable opening identity through project reload', async ({ page }) => {
  await page.goto('/?e2e=wall-fixture')
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)

  await page.getByTestId('three-opening-button-window-1').click()
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.selectedOpeningId)).toBe('window-1')
  await expect(page.getByTestId('window-preview-disclosure')).toHaveText(/confirmed=false（未知）/)
  await expect(page.getByTestId('window-preview-disclosure')).toHaveText(/非持久化默认值/)

  // A 2D selection must highlight the same opening in the live R3F scene.
  await page.getByTestId('opening-handle-window-1').click()
  await expect(page.getByTestId('three-opening-button-window-1')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('opening-handle-door-1').click()
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.selectedOpeningId)).toBe('door-1')
  await expect(page.getByTestId('door-preview-disclosure')).toHaveText(/confirmed=false（未知）/)
  await expect(page.getByTestId('door-preview-disclosure')).toHaveText(/全高门洞仅为非持久化预览假设/)
  const beforeOpeningEdit = await page.evaluate(() => window.__homevoxE2E?.generation ?? 0)
  await page.getByTestId('opening-width').fill('80')
  await expect(page.locator('pre')).toContainText('"width": 80')
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.generation ?? 0))
    .toBeGreaterThan(beforeOpeningEdit)
  expect((await page.evaluate(() => window.__homevoxE2E?.geometry.finite))).toBe(true)

  const editor = page.getByRole('img', { name: '户型图墙体端点编辑区' })
  const editorBox = await editor.boundingBox()
  expect(editorBox).not.toBeNull()
  const scale = Math.min((editorBox?.width ?? 0) / 600, (editorBox?.height ?? 0) / 440)
  await page.mouse.click((editorBox?.x ?? 0) + 150 * scale, (editorBox?.y ?? 0) + 80 * scale)
  await page.getByRole('button', { name: '添加门' }).click()
  await expect(page.getByTestId('opening-handle-door-manual-1')).toBeVisible()
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByTestId('opening-handle-door-manual-1')).toHaveCount(0)
  await page.getByRole('button', { name: /撤销/ }).click()
  await expect(page.getByTestId('opening-handle-door-manual-1')).toBeVisible()
  await page.getByRole('button', { name: /重做/ }).click()
  await expect(page.getByTestId('opening-handle-door-manual-1')).toHaveCount(0)

  const export2D = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出2D平面图PNG' }).click()
  expect((await export2D).suggestedFilename()).toMatch(/\.png$/)
  const export3D = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出3D白模PNG' }).click()
  expect((await export3D).suggestedFilename()).toMatch(/\.png$/)

  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByText('项目已创建')).toBeVisible()
  const projectID = await page.evaluate(() => window.__homevoxE2E?.currentProjectId)
  expect(projectID).toMatch(/^[0-9a-f-]{36}$/i)
  const persistedOpeningGeometry = await page.evaluate(() => window.__homevoxE2E?.geometry.fingerprint)
  await page.goto(`/?e2e=wall-fixture&project=${projectID}`)
  await expect(page.getByText('项目已加载')).toBeVisible()
  await page.getByTestId('opening-handle-door-1').click()
  await expect(page.getByTestId('opening-width')).toHaveValue('80')
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.geometry.fingerprint))
    .toBe(persistedOpeningGeometry)
  await page.getByTestId('opening-handle-door-1').click()
  await expect(page.getByTestId('door-preview-disclosure')).toHaveText(/confirmed=false（未知）/)
  await expect(page.getByTestId('door-preview-disclosure')).toHaveText(/不会保存为建筑参数/)
  await page.getByTestId('opening-handle-window-1').click()
  await expect(page.getByTestId('window-preview-disclosure')).toHaveText(/confirmed=false（未知）/)
  await expect(page.getByTestId('window-preview-disclosure')).toHaveText(/非持久化默认值/)
})

test('runs the real browser image-selection to Vision parse to persisted workspace loop', async ({ page }) => {
  expect(restartURL, 'production runner must provide its test-only restart checkpoint').toBeTruthy()
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'controlled-plan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAF0lEQVR4nGL6////fwZkwARjAAIAAP//YgEEAT/f/TcAAAAASUVORK5CYII=', 'base64'),
  })
  await expect(page.getByAltText('上传户型图预览')).toBeVisible()
  await page.getByRole('button', { name: '上传并解析' }).click()
  await expect(page.getByText('解析完成')).toBeVisible()
  await expect(page.getByRole('img', { name: '户型图墙体端点编辑区' })).toBeVisible()
  await page.getByLabel('项目名称').fill('controlled Vision loop')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByText('项目已创建')).toBeVisible()
  const projects = await page.request.get('/api/projects')
  expect(projects.ok()).toBe(true)
  const listed = await projects.json() as Array<{ id: string; name: string }>
  const projectID = listed.find((project) => project.name === 'controlled Vision loop')?.id
  expect(projectID).toMatch(/^[0-9a-f-]{36}$/i)
  const detailBefore = await page.request.get(`/api/projects/${projectID}`)
  expect(detailBefore.ok()).toBe(true)
  const beforeDocument = (await detailBefore.json() as { document: { result: { walls: unknown; doors: unknown; windows: unknown } } }).document
  const image = await page.request.get(`/api/projects/${projectID}/source-image`)
  expect(image.ok()).toBe(true)
  expect(image.headers()['content-type']).toContain('image/png')
  const imageBytes = await image.body()
  const beforeFingerprint = await page.evaluate(() => window.__homevoxE2E?.geometry.fingerprint)
  const restart = await page.request.post(restartURL!)
  expect(restart.ok()).toBe(true)
  const restartResult = await restart.json() as { oldPid: number; newPid: number }
  expect(restartResult.oldPid).toBeGreaterThan(0)
  expect(restartResult.newPid).toBeGreaterThan(0)
  expect(restartResult.newPid).not.toBe(restartResult.oldPid)
  await expect.poll(async () => {
    try {
      const health = await page.request.get('/api/health')
      const status = health.status()
      await health.dispose()
      return status
    } catch {
      return 0
    }
  }).toBe(200)
  await page.goto(`/?project=${projectID}`)
  await expect(page.getByText('项目已加载')).toBeVisible()
  await expect(page.getByTestId('opening-handle-door-1')).toBeVisible()
  await expect(page.getByTestId('opening-handle-window-1')).toBeVisible()
  const detailAfter = await page.request.get(`/api/projects/${projectID}`)
  expect(detailAfter.ok()).toBe(true)
  const afterDocument = (await detailAfter.json() as { document: { result: { walls: unknown; doors: unknown; windows: unknown } } }).document
  expect(afterDocument).toEqual(beforeDocument)
  expect(afterDocument.result.walls).toEqual(beforeDocument.result.walls)
  expect(afterDocument.result.doors).toEqual(beforeDocument.result.doors)
  expect(afterDocument.result.windows).toEqual(beforeDocument.result.windows)
  const imageAfter = await page.request.get(`/api/projects/${projectID}/source-image`)
  expect(imageAfter.ok()).toBe(true)
  expect(imageAfter.headers()['content-type']).toContain('image/png')
  expect(await imageAfter.body()).toEqual(imageBytes)
  await expect.poll(() => page.evaluate(() => window.__homevoxE2E?.geometry.fingerprint)).toBe(beforeFingerprint)
})

for (const [fixture, validationError] of [
  ['invalid-opening', /missing or degenerate wall/],
  ['duplicate-wall-id', /wall id must be unique/],
] as const) {
  test(`fails closed before voxel or WASM geometry for ${fixture} documents`, async ({ page }) => {
    await page.goto(`/?e2e=${fixture}`)
    await expect(page.getByTestId('geometry-validation-error')).toContainText(validationError)
    await expect(page.getByTestId('wasm-engine-state')).toHaveText(/fallback/)
    await expect(page.getByTestId('wasm-resource-metrics')).toContainText(/fallback: invalid-input/)
    const state = await page.evaluate(() => window.__homevoxE2E)
    expect(state?.wasmCalls).toBe(0)
    expect(state?.geometry.positionCount).toBe(0)
  })
}
