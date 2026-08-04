import { expect, test } from '@playwright/test'

test('opens the Schema Graph project home', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: '给 Prisma Schema 一张可以编辑的地图。' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /新建本地项目/ })).toBeVisible()
})

test('explains an empty local-project export without breaking the flow', async ({
  page,
}) => {
  await page.goto('/')
  const exportAction = page.getByRole('button', { name: '导出本地项目数据' })
  await expect(exportAction).toBeVisible()
  await exportAction.click()

  const dialog = page.getByRole('dialog', { name: '确认导出本地项目数据' })
  await expect(dialog).toContainText(
    '当前没有本地项目。仍可下载只含格式、版本和空记录的 JSON 文件。',
  )
  await expect(dialog.getByRole('group', { name: '项目 0' })).toBeVisible()
  await expect(dialog.getByRole('group', { name: '文件 0' })).toBeVisible()
  await expect(dialog.getByRole('group', { name: '布局 0' })).toBeVisible()

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(exportAction).toBeFocused()
})

test('prepares, confirms, and downloads the local-project JSON export', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  if (await closeTour.isVisible()) await closeTour.click()

  await page.getByTitle('返回项目首页').click()
  await expect(
    page.locator('.recent-project').filter({ hasText: '电商核心' }),
  ).toBeVisible()

  const exportAction = page.getByRole('button', { name: '导出本地项目数据' })
  await expect(exportAction).toBeVisible()
  await exportAction.click()

  const dialog = page.getByRole('dialog', { name: '确认导出本地项目数据' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('完整 Prisma Schema 源码')
  await expect(dialog).toContainText('数据库连接字符串、账号、密码或访问令牌')
  await expect(dialog.getByRole('group', { name: '项目 1' })).toBeVisible()
  await expect(dialog.getByRole('group', { name: '文件 1' })).toBeVisible()
  await expect(dialog.getByRole('group', { name: '布局 1' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '确认并下载 JSON' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(
    /^schema-graph-local-projects-\d{4}-\d{2}-\d{2}\.json$/,
  )
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('本地项目数据已下载')).toBeVisible()
})
