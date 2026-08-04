import { expect, type Locator, type Page, test } from '@playwright/test'

async function openContentWorkspace(page: Page, closeTour = true): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /内容平台/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()
  await expect(page.locator('.schema-node')).toHaveCount(8, { timeout: 15_000 })
  const tourClose = page.getByRole('button', { name: '关闭新手指引' })
  if (closeTour && (await tourClose.isVisible())) await tourClose.click()
  await expect(page.locator('.canvas-panel')).toHaveAttribute(
    'data-initial-fit-status',
    'complete',
    { timeout: 30_000 },
  )
}

async function viewport(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function clickVisiblePath(page: Page, path: Locator): Promise<void> {
  const point = await path.evaluate((element) => {
    const svgPath = element as SVGPathElement
    const matrix = svgPath.getScreenCTM()
    if (!matrix) throw new Error('Unable to resolve the edge screen transform')

    for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const local = svgPath.getPointAtLength(svgPath.getTotalLength() * fraction)
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
      if (document.elementFromPoint(screen.x, screen.y) === svgPath) {
        return { x: screen.x, y: screen.y }
      }
    }

    throw new Error('Unable to find a visible point on the logical edge')
  })
  await page.mouse.click(point.x, point.y)
}

test('preserves the viewport after graph updates and keeps zoom while focusing navigation', async ({
  page,
}) => {
  await openContentWorkspace(page)
  await page.locator('.react-flow__controls-zoomin').click()
  await page.locator('.react-flow__controls-zoomin').click()
  const beforeUpdate = await viewport(page)

  await page.getByRole('button', { name: '模型', exact: true }).click()
  await page.getByLabel('模型名称').fill('ViewportAudit')
  await page.getByRole('button', { name: '创建模型' }).click()
  await expect(
    page.locator('.schema-node').filter({ hasText: /^ViewportAudit/ }),
  ).toBeVisible({ timeout: 15_000 })
  const afterUpdate = await viewport(page)
  expect(afterUpdate.zoom).toBeCloseTo(beforeUpdate.zoom, 5)
  expect(afterUpdate.x).toBeCloseTo(beforeUpdate.x, 3)
  expect(afterUpdate.y).toBeCloseTo(beforeUpdate.y, 3)

  await page.getByTitle('models/content.prisma').click()
  const beforeFocus = await viewport(page)
  await page.getByTitle('在画布中聚焦 Post').click()
  await page.waitForTimeout(380)
  const afterFocus = await viewport(page)
  expect(afterFocus.zoom).toBeCloseTo(beforeFocus.zoom, 5)
  expect(
    Math.abs(afterFocus.x - beforeFocus.x) + Math.abs(afterFocus.y - beforeFocus.y),
  ).toBeGreaterThan(10)
  await expect(page.locator('.monaco-selected-source-line')).toBeVisible()
})

test('links field and logical-edge selections to cards and one or two Monaco panes', async ({
  page,
}) => {
  await openContentWorkspace(page)
  const postNode = page.locator('.schema-node').filter({
    has: page.locator('header strong', { hasText: /^Post$/ }),
  })
  const authorField = postNode
    .locator('.schema-field-row')
    .filter({ hasText: /^authorUser/ })
  await authorField.click()
  await expect(authorField).toHaveClass(/is-selected/)
  await expect(page.locator('.monaco-selected-source-line')).toBeVisible()

  const relationPath = page
    .getByRole('group', { name: /Edge from .*Post to .*User/ })
    .locator('.react-flow__edge-interaction')
  await clickVisiblePath(page, relationPath)
  const splitPanes = page.locator('.editor-column.is-split .editor-pane')
  await expect(splitPanes).toHaveCount(2)
  await expect(splitPanes.nth(0).locator('.editor-filebar')).toContainText(
    'models/content.prisma',
  )
  await expect(splitPanes.nth(1).locator('.editor-filebar')).toContainText(
    'models/identity.prisma',
  )
  await expect(
    splitPanes.nth(0).locator('.monaco-selected-source-line').first(),
  ).toBeVisible()
  await expect(splitPanes.nth(1).locator('.monaco-linked-peer-line')).toBeVisible()
  const selectedRows = await page
    .locator('.schema-field-row.is-selected')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        model: row.closest('.schema-node')?.querySelector('header strong')?.textContent,
        field: row.querySelector('span')?.textContent,
      })),
    )
  expect(selectedRows).toHaveLength(3)
  expect(selectedRows).toEqual(
    expect.arrayContaining([
      { model: 'Post', field: 'authorId' },
      { model: 'Post', field: 'author' },
      { model: 'User', field: 'posts' },
    ]),
  )
  await expect(page.locator('.monaco-selected-source-line').first()).toBeVisible()
  await expect(page.locator('.monaco-linked-peer-line').first()).toBeVisible()
  await expect(page.locator('.edge-cardinality')).not.toHaveCount(0)
  await expect(page.locator('.logical-edge-label').first()).toContainText('FK')

  const userPostsField = page
    .locator('.schema-node')
    .filter({ hasText: /^User/ })
    .locator('.schema-field-row')
    .filter({ hasText: /^posts/ })
  await userPostsField.click()
  await expect(postNode).toHaveClass(/is-fk-child/)
  await expect(splitPanes).toHaveCount(2)
  await expect(splitPanes.nth(0).locator('.editor-filebar')).toContainText(
    'models/identity.prisma',
  )
  await expect(splitPanes.nth(1).locator('.editor-filebar')).toContainText(
    'models/content.prisma',
  )
  await expect(splitPanes.nth(0).locator('.monaco-selected-source-line')).toBeVisible()
  await expect(splitPanes.nth(0).locator('.monaco-linked-peer-line')).toHaveCount(0)
  await expect(
    splitPanes.nth(1).locator('.monaco-linked-peer-line').first(),
  ).toBeVisible()

  await page.getByRole('tab', { name: '外观' }).click()
  await page.getByRole('button', { name: '数字' }).click()
  await expect(page.locator('.numeric-cardinality').first()).toBeVisible()
  await page.getByRole('button', { name: /高亮必填字段/ }).click()
  await expect(page.locator('.schema-field-row.is-required').first()).toBeVisible()
})

test('starts the seven-step tour once and exposes a permanent manual trigger', async ({
  page,
}) => {
  await openContentWorkspace(page, false)
  const tour = page.getByRole('region', { name: '新手指引' })
  await expect(tour).toBeVisible()
  await expect(tour.getByRole('heading')).toHaveText('从项目结构开始')
  await tour.getByRole('button', { name: /下一步/ }).click()
  await expect(tour.getByRole('heading')).toHaveText('代码和图始终同步')
  await tour.getByRole('button', { name: '关闭新手指引' }).click()

  await page.getByRole('button', { name: '打开新手指引' }).click()
  await expect(tour.getByRole('heading')).toHaveText('从项目结构开始')
})
