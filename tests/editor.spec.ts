import { expect, test } from '@playwright/test'

test('opens a multi-file template, edits the graph, and exports it', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /内容平台/ }).click()

  await expect(
    page.getByRole('heading', { name: '关系图从哪个方向展开？' }),
  ).toBeVisible()
  await page.getByRole('button', { name: /从左到右/ }).click()

  await expect(page.getByText('内容平台', { exact: true })).toBeVisible()
  await expect(page.locator('.schema-node').filter({ hasText: /^User/ })).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('button', { name: '模型', exact: true }).click()
  await page.getByLabel('模型名称').fill('AuditLog')
  await page.getByRole('button', { name: '创建模型' }).click()

  await expect(
    page.locator('.schema-node').filter({ hasText: /^AuditLog/ }),
  ).toBeVisible({ timeout: 15_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('内容平台.zip')

  await page.waitForTimeout(700)
  await page.reload()
  const recentProject = page.locator('.recent-project').filter({ hasText: '内容平台' })
  await expect(recentProject).toBeVisible()
  await recentProject.locator('.recent-project-open').click()
  await expect(
    page.locator('.schema-node').filter({ hasText: /^AuditLog/ }),
  ).toBeVisible({ timeout: 15_000 })
})

test('uses full-screen code, canvas, and properties tabs on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从上到下/ }).click()

  const mobileTabs = page.getByRole('navigation', { name: '手机端工作区' })
  await expect(mobileTabs).toBeVisible()
  await mobileTabs.getByRole('button', { name: '代码' }).click()
  await expect(page.getByRole('region', { name: 'Schema 代码' })).toBeVisible()
  await mobileTabs.getByRole('button', { name: '画布' }).click()
  await expect(page.getByRole('region', { name: 'Schema 关系画布' })).toBeVisible()
  await mobileTabs.getByRole('button', { name: '属性' }).click()
  await expect(page.getByRole('complementary', { name: '属性面板' })).toBeVisible()
})

test('renders a 100-model schema on the relation canvas', async ({ page }) => {
  const largeSchema = Array.from(
    { length: 100 },
    (_, index) => `model Model${index} {\n  id Int @id\n}`,
  ).join('\n\n')

  await page.goto('/')
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(largeSchema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  await expect(page.locator('.schema-node')).toHaveCount(100, { timeout: 15_000 })
})
