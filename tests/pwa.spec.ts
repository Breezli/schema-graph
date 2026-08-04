import { expect, test } from '@playwright/test'

test.skip(
  !process.env.PLAYWRIGHT_PREVIEW,
  'PWA test requires the production preview server.',
)

test('reloads the project home from the service worker while offline', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '给 Prisma Schema 一张可以编辑的地图。' }),
  ).toBeVisible()

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('heading', { name: '给 Prisma Schema 一张可以编辑的地图。' }),
  ).toBeVisible()

  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()
  await expect(
    page.getByRole('region', { name: 'Schema 代码' }).getByRole('code').first(),
  ).toBeVisible({ timeout: 30_000 })
})
