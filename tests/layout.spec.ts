import { expect, type Locator, type Page, test } from '@playwright/test'

const hierarchySchema = `model Root {
  id Int @id
  middles Middle[]
  leaves Leaf[]
}

model Middle {
  id Int @id
  rootId Int
  root Root @relation(fields: [rootId], references: [id])
  leaves Leaf[]
}

model Leaf {
  id Int @id
  middleId Int
  rootId Int
  middle Middle @relation(fields: [middleId], references: [id])
  root Root @relation(fields: [rootId], references: [id])
}`

async function openPastedLayout(
  page: Page,
  direction: 'RIGHT' | 'DOWN',
): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(hierarchySchema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page
    .getByRole('button', { name: direction === 'RIGHT' ? /从左到右/ : /从上到下/ })
    .click()
  await expect(page.locator('.schema-node')).toHaveCount(3, { timeout: 15_000 })
  await closeTourIfVisible(page)
  await expect(page.locator('.canvas-panel')).toHaveAttribute(
    'data-initial-fit-status',
    'complete',
    { timeout: 30_000 },
  )
}

async function closeTourIfVisible(page: Page): Promise<void> {
  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  if (await closeTour.isVisible()) await closeTour.click()
}

function schemaNode(page: Page, name: string): Locator {
  return page.locator('.schema-node').filter({
    has: page.locator('header strong', { hasText: new RegExp(`^${name}$`) }),
  })
}

async function nodePosition(node: Locator): Promise<{ x: number; y: number }> {
  return node.evaluate((element) => {
    const flowNode = element.closest('.react-flow__node')
    if (!flowNode) throw new Error('Schema card is missing its React Flow node')
    const matrix = new DOMMatrix(getComputedStyle(flowNode).transform)
    return { x: matrix.e, y: matrix.f }
  })
}

async function viewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function expectThreeRanks(page: Page, axis: 'x' | 'y'): Promise<void> {
  const leaf = schemaNode(page, 'Leaf')
  const middle = schemaNode(page, 'Middle')
  const root = schemaNode(page, 'Root')
  await expect
    .poll(
      async () => {
        const [leafPosition, middlePosition, rootPosition] = await Promise.all([
          nodePosition(leaf),
          nodePosition(middle),
          nodePosition(root),
        ])
        return (
          leafPosition[axis] < middlePosition[axis] &&
          middlePosition[axis] < rootPosition[axis]
        )
      },
      { timeout: 15_000 },
    )
    .toBe(true)
}

test('RIGHT layout keeps the shortcut hierarchy ranked and uses right/left handles', async ({
  page,
}) => {
  await openPastedLayout(page, 'RIGHT')
  await expectThreeRanks(page, 'x')
  await closeTourIfVisible(page)

  const nodes = page.locator('.schema-node')
  await expect(nodes.first()).toHaveAttribute('data-layout-direction', 'right')
  await expect(nodes.locator('.node-handle.react-flow__handle-right')).toHaveCount(3)
  await expect(nodes.locator('.node-handle.react-flow__handle-left')).toHaveCount(3)
})

test('DOWN layout puts the root below descendants, uses bottom/top handles, and fits initially', async ({
  page,
}) => {
  await openPastedLayout(page, 'DOWN')
  await expectThreeRanks(page, 'y')
  await closeTourIfVisible(page)

  const nodes = page.locator('.schema-node')
  await expect(nodes.first()).toHaveAttribute('data-layout-direction', 'down')
  await expect(nodes.locator('.node-handle.react-flow__handle-bottom')).toHaveCount(3)
  await expect(nodes.locator('.node-handle.react-flow__handle-top')).toHaveCount(3)
  await expect.poll(async () => (await viewport(page)).zoom).toBeLessThan(0.95)
})

test('explicit auto-layout runs without changing the viewport', async ({ page }) => {
  await openPastedLayout(page, 'RIGHT')
  await expectThreeRanks(page, 'x')
  await closeTourIfVisible(page)
  await page.locator('.react-flow__controls-zoomin').click()
  await page.waitForTimeout(220)
  const before = await viewport(page)

  await page.getByTitle('自动布局').click()
  await page.waitForTimeout(700)
  const after = await viewport(page)

  expect(after.zoom).toBeCloseTo(before.zoom, 5)
  expect(after.x).toBeCloseTo(before.x, 3)
  expect(after.y).toBeCloseTo(before.y, 3)
})

test('manual positions survive reopening a saved project', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /内容平台/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()
  const post = schemaNode(page, 'Post')
  await expect(post).toBeVisible({ timeout: 15_000 })
  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  if (await closeTour.isVisible()) await closeTour.click()
  await expect(page.locator('.canvas-panel')).toHaveAttribute(
    'data-initial-fit-status',
    'complete',
    { timeout: 30_000 },
  )

  const header = post.locator('header')
  const box = await header.boundingBox()
  if (!box) throw new Error('Post card header is not visible')
  const before = await nodePosition(post)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 55, {
    steps: 8,
  })
  await page.mouse.up()
  const dragged = await nodePosition(post)
  expect(
    Math.abs(dragged.x - before.x) + Math.abs(dragged.y - before.y),
  ).toBeGreaterThan(20)

  await page.getByTitle('返回项目首页').click()
  await page.waitForTimeout(700)
  const recentProject = page.locator('.recent-project').filter({ hasText: '内容平台' })
  await expect(recentProject).toBeVisible()
  await recentProject.locator('.recent-project-open').click()
  const reopenedPost = schemaNode(page, 'Post')
  await expect(reopenedPost).toBeVisible({ timeout: 15_000 })
  const reopened = await nodePosition(reopenedPost)

  expect(reopened.x).toBeCloseTo(dragged.x, 1)
  expect(reopened.y).toBeCloseTo(dragged.y, 1)
})

test('a multi-node drag is reverted by one undo', async ({ page }) => {
  await openPastedLayout(page, 'RIGHT')
  await expectThreeRanks(page, 'x')
  await closeTourIfVisible(page)
  const leaf = schemaNode(page, 'Leaf')
  const middle = schemaNode(page, 'Middle')

  await leaf.locator('header').click()
  await middle.locator('header').click({ modifiers: ['Control'] })
  await expect(leaf).toHaveClass(/is-selected/)
  await expect(middle).toHaveClass(/is-selected/)
  const [leafBefore, middleBefore] = await Promise.all([
    nodePosition(leaf),
    nodePosition(middle),
  ])

  const box = await middle.locator('header').boundingBox()
  if (!box) throw new Error('Middle card header is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 45, {
    steps: 8,
  })
  await page.mouse.up()

  await expect
    .poll(async () => {
      const [leafAfter, middleAfter] = await Promise.all([
        nodePosition(leaf),
        nodePosition(middle),
      ])
      const leafDistance =
        Math.abs(leafAfter.x - leafBefore.x) + Math.abs(leafAfter.y - leafBefore.y)
      const middleDistance =
        Math.abs(middleAfter.x - middleBefore.x) +
        Math.abs(middleAfter.y - middleBefore.y)
      return leafDistance > 20 && middleDistance > 20
    })
    .toBe(true)

  await page.getByTitle('撤销 Ctrl+Z').click()
  await expect
    .poll(async () => {
      const [leafAfterUndo, middleAfterUndo] = await Promise.all([
        nodePosition(leaf),
        nodePosition(middle),
      ])
      return (
        Math.abs(leafAfterUndo.x - leafBefore.x) < 0.01 &&
        Math.abs(leafAfterUndo.y - leafBefore.y) < 0.01 &&
        Math.abs(middleAfterUndo.x - middleBefore.x) < 0.01 &&
        Math.abs(middleAfterUndo.y - middleBefore.y) < 0.01
      )
    })
    .toBe(true)
})
