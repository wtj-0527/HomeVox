import { expect, test } from '@playwright/test'

const baseURL = process.env.HOMEVOX_E2E_BASE_URL ?? 'http://127.0.0.1:18088'

test.use({ baseURL, viewport: { width: 1440, height: 960 } })

test('loads production Rust/WASM mesh, keeps the latest drag generation, exports PNG, and rebuilds after reload', async ({ page }) => {
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
  expect(dragged?.generation).toBeGreaterThan(initial?.generation ?? 0)
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
  const png = await download
  expect(png.suggestedFilename()).toMatch(/\.png$/)

  await page.reload()
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/active/)
  const reloaded = await page.evaluate(() => window.__homevoxE2E)
  expect(reloaded?.wasmCalls).toBeGreaterThan(0)
  expect(reloaded?.geometry.finite).toBe(true)
  expect(wasmResponses.some((contentType) => contentType.includes('application/wasm'))).toBe(true)

  await page.goto('/?e2e=wall-fixture&wasm=fallback')
  await expect(page.getByTestId('wasm-engine-state')).toHaveText(/fallback/)
  await expect(page.getByTestId('wasm-resource-metrics')).toHaveText(/fallback: load-failed/)
  await expect(page.getByRole('img', { name: '户型图墙体端点编辑区' })).toBeVisible()
})
