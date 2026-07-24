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

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  const image = await readFile(path)
  expect(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
  expect(image.readUInt32BE(16)).toBe(1440)
  expect(image.readUInt32BE(20)).toBe(960)
  return path
}

test('runs upload, parse, canonical 2D/3D, save, restart, and reload as one production lifecycle', async ({ page }, testInfo) => {
  await page.goto('/')
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
  await page.getByRole('button', { name: '3D 选择窗 window-1' }).click()
  await expect(page.getByTestId('selected-opening-id')).toContainText('window-1')
  await expect(page.getByTestId('selected-opening-id')).toContainText('wall-2')
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
  const savedProject = await saved.json() as { id: string; revision: number; document: { result: { walls: Array<{ id: string }> } } }
  expect(savedProject.id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(savedProject.revision).toBe(1)
  expect(savedProject.document.result.walls.map((wall) => wall.id)).toEqual(['wall-1', 'wall-2', 'wall-3', 'wall-4'])
  await expect(page.getByText('项目已创建')).toBeVisible()

  expect(restartURL).toBeTruthy()
  const restarted = await page.request.post(restartURL!)
  expect(restarted.status()).toBe(200)
  const pids = await restarted.json() as { oldPid: number; newPid: number }
  expect(pids.newPid).not.toBe(pids.oldPid)

  await page.goto(`/?project=${savedProject.id}`)
  await expect(page.getByRole('button', { name: '校正 2D' })).toBeEnabled()
  await page.getByRole('button', { name: '校正 2D' }).click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()
  await page.getByTestId('wall-hit-wall-2').click({ position: { x: 1, y: 80 }, force: true })
  await expect(page.getByTestId('selected-wall-id')).toHaveText('wall-2')
  const accessibility = await page.locator('body').ariaSnapshot()
  expect(accessibility).not.toMatch(/(?:WASM|Grid|triangles|fallback|结构化 JSON)/i)
  await expect(page.locator('pre')).toHaveCount(0)
})

test('keeps invalid and duplicate canonical identity failures closed', async ({ page }) => {
  await page.goto('/?e2e=invalid-opening')
  await page.getByRole('button', { name: '生成 3D' }).click()
  await expect(page.getByRole('alert')).toContainText('当前开口数据无法生成 3D')
  await page.getByRole('button', { name: '返回 2D 校正' }).click()
  await expect(page.getByLabel('2D 墙体编辑器')).toBeVisible()

  await page.goto('/?e2e=duplicate-wall-id')
  await page.getByRole('button', { name: '生成 3D' }).click()
  await expect(page.getByRole('alert')).toContainText('当前开口数据无法生成 3D')
})
