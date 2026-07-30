import { expect, test } from '@playwright/test'

test('opens the Schema Graph project home', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: '给 Prisma Schema 一张可以编辑的地图。' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /新建本地项目/ })).toBeVisible()
})
