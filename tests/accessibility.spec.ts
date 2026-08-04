import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'

const commentedSchema = `/// 用户模型
model User {
  /// 用户主键
  id Int @id
  /// 用户文章
  posts Post[]
}

/// 文章模型
model Post {
  /// 文章主键
  id Int @id
  /// 作者标识
  authorId Int
  /// 作者关系
  author User @relation(fields: [authorId], references: [id])
}`

const touchTargetSchema = `model TouchTarget {
  id Int @id
  title String
  summary String?
}`

async function closeOnboardingTour(page: Page): Promise<void> {
  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  await closeTour.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
  if (await closeTour.isVisible()) await closeTour.click()
}

async function waitForMonaco(page: Page): Promise<void> {
  const codeRegion = page.getByRole('region', { name: 'Schema 代码' })
  const editor = codeRegion.getByRole('code').first()
  await expect(codeRegion).toBeVisible()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await expect(codeRegion.getByRole('textbox').first()).toBeAttached({
    timeout: 30_000,
  })
}

async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.locator('.schema-node').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.canvas-panel')).toHaveAttribute(
    'data-initial-fit-status',
    'complete',
    { timeout: 30_000 },
  )

  const mobileTabs = page.getByRole('navigation', { name: '手机端工作区' })
  if (await mobileTabs.isVisible()) {
    await mobileTabs.getByRole('button', { name: '代码' }).click()
    await waitForMonaco(page)
    await mobileTabs.getByRole('button', { name: '画布' }).click()
  } else {
    await waitForMonaco(page)
  }
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()
  await closeOnboardingTour(page)
  await waitForWorkspace(page)
}

async function openPastedWorkspace(
  page: Page,
  schema: string,
  direction: '从左到右' | '从上到下' = '从左到右',
): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(schema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page.getByRole('button', { name: new RegExp(direction) }).click()
  await closeOnboardingTour(page)
  await waitForWorkspace(page)
}

async function expectNoWcagAAViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  const details = results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(' ')}`)
          .join('\n')}`,
    )
    .join('\n\n')

  expect(results.violations, details || 'Expected no WCAG A/AA violations').toEqual([])
}

function elementSize(locator: Locator): Promise<{
  width: number
  height: number
  visualWidth: number
  visualHeight: number
}> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const htmlElement = element as HTMLElement
    return {
      width: htmlElement.offsetWidth,
      height: htmlElement.offsetHeight,
      visualWidth: rect.width,
      visualHeight: rect.height,
    }
  })
}

function handleDotOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element, '::after').opacity),
  )
}

test('project home has no WCAG A or AA accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expectNoWcagAAViolations(page)
})

test('workspace passes the Axe gate in dark, light, and contextual comment states', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await openPastedWorkspace(page, commentedSchema)

  const lightThemeButton = page.getByRole('button', { name: '切换到浅色主题' })
  await expect(lightThemeButton).toHaveAttribute('title', '切换到浅色主题')
  await expectNoWcagAAViolations(page)

  const userNode = page.locator('.schema-node').filter({
    has: page.locator('header strong', { hasText: /^User$/ }),
  })
  const postNode = page.locator('.schema-node').filter({
    has: page.locator('header strong', { hasText: /^Post$/ }),
  })
  await userNode.locator('header').click()
  await expect(userNode).toHaveAttribute('data-comment-context', 'root')
  await expect(postNode).toHaveAttribute('data-comment-context', 'related')
  await expect(userNode.locator('.schema-field-comment-tag')).toHaveCount(2)
  await expect(postNode.locator('.schema-field-comment-tag')).toHaveCount(3)
  await expect(page.locator('.schema-comment-sidecar')).toHaveCount(0)

  await lightThemeButton.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: '切换到深色主题' })).toHaveAttribute(
    'title',
    '切换到深色主题',
  )
  await expectNoWcagAAViolations(page)
})

test('splitters and collapsed panes expose correct keyboard and ARIA state', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await openWorkspace(page)

  const codeSplitter = page.getByRole('separator', { name: '调整代码面板宽度' })
  await expect(codeSplitter).toHaveAttribute('aria-orientation', 'vertical')
  await expect(codeSplitter).toHaveAttribute('aria-valuenow', '25')
  await codeSplitter.focus()
  await page.keyboard.press('ArrowRight')
  await expect(codeSplitter).toHaveAttribute('aria-valuenow', '26')
  await page.keyboard.press('Home')
  await expect(codeSplitter).toHaveAttribute('aria-valuenow', '16')
  await page.keyboard.press('End')
  await expect(codeSplitter).toHaveAttribute('aria-valuenow', '40')

  const propertySplitter = page.getByRole('separator', {
    name: '调整属性面板宽度',
  })
  await expect(propertySplitter).toHaveAttribute('aria-orientation', 'vertical')
  await expect(propertySplitter).toHaveAttribute('aria-valuenow', '20')
  await propertySplitter.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(propertySplitter).toHaveAttribute('aria-valuenow', '21')
  await page.keyboard.press('Home')
  await expect(propertySplitter).toHaveAttribute('aria-valuenow', '16')
  await page.keyboard.press('End')
  await expect(propertySplitter).toHaveAttribute('aria-valuenow', '34')

  const codeToggle = page.locator('button[aria-controls="workspace-code-pane"]')
  const propertiesToggle = page.locator(
    'button[aria-controls="workspace-properties-pane"]',
  )
  const codePane = page.locator('#workspace-code-pane')
  const propertiesPane = page.locator('#workspace-properties-pane')

  await expect(codeToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(propertiesToggle).toHaveAttribute('aria-expanded', 'true')
  const codePaneControl = codePane.locator('button').first()
  await codePaneControl.focus()
  await expect(codePaneControl).toBeFocused()
  await codeToggle.evaluate((element) => (element as HTMLButtonElement).click())
  await expect(codePane.locator(':focus')).toHaveCount(0)

  const propertiesPaneControl = propertiesPane.locator('button').first()
  await propertiesPaneControl.focus()
  await expect(propertiesPaneControl).toBeFocused()
  await propertiesToggle.evaluate((element) => (element as HTMLButtonElement).click())
  await expect(propertiesPane.locator(':focus')).toHaveCount(0)

  await expect(codeToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(propertiesToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(codePane).toHaveAttribute('aria-hidden', 'true')
  await expect(propertiesPane).toHaveAttribute('aria-hidden', 'true')
  await expect(codePane.getByRole('region', { name: 'Schema 代码' })).toHaveCount(0)
  await expect(
    propertiesPane.getByRole('complementary', { name: '属性面板' }),
  ).toHaveCount(0)
  await expect(
    codePane.locator(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).toHaveCount(0)
  await expect(
    propertiesPane.locator(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).toHaveCount(0)
  await expectNoWcagAAViolations(page)

  await codeToggle.click()
  await propertiesToggle.click()
  await expect(codeToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(propertiesToggle).toHaveAttribute('aria-expanded', 'true')
  await waitForMonaco(page)
  await expect(page.getByRole('complementary', { name: '属性面板' })).toBeVisible()
})

test('mobile keeps collapsed panes and the theme toggle accessible', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await openWorkspace(page)

  await page.locator('button[aria-controls="workspace-code-pane"]').click()
  await page.locator('button[aria-controls="workspace-properties-pane"]').click()
  await page.setViewportSize({ width: 390, height: 844 })

  const mobileTabs = page.getByRole('navigation', { name: '手机端工作区' })
  await expect(mobileTabs).toBeVisible()
  await mobileTabs.getByRole('button', { name: '代码' }).click()
  await waitForMonaco(page)
  await expect(page.locator('#workspace-code-pane')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  )
  await mobileTabs.getByRole('button', { name: '属性' }).click()
  await expect(page.getByRole('complementary', { name: '属性面板' })).toBeVisible()
  await expect(page.locator('#workspace-properties-pane')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  )
  await mobileTabs.getByRole('button', { name: '画布' }).click()
  await expect(page.getByRole('region', { name: 'Schema 关系画布' })).toBeVisible()

  const mobileThemeButton = page.getByRole('button', {
    name: '切换到浅色主题',
  })
  await expect(mobileThemeButton).toHaveCount(1)
  await expect(mobileThemeButton).toBeVisible()
  await expect(mobileThemeButton).toHaveAttribute('title', '切换到浅色主题')
  await mobileThemeButton.click()
  await expect(page.getByRole('button', { name: '切换到深色主题' })).toHaveCount(1)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expectNoWcagAAViolations(page)
})

test('mobile graph and workspace controls reserve accessible touch targets', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await openPastedWorkspace(page, touchTargetSchema)

  const modelNode = page.locator('.schema-node').filter({
    has: page.locator('.field-handle'),
  })
  const fieldEntry = modelNode.locator('.schema-field-entry').first()
  const fieldRow = fieldEntry.locator('.schema-field-row')
  const fieldHandle = fieldEntry.locator('.field-handle')
  const nodeHandle = modelNode.locator('.node-handle').first()

  await expect(fieldHandle).toHaveAttribute('role', 'button')
  await expect(fieldHandle).toHaveAttribute('tabindex', '0')
  await expect(fieldHandle).toHaveAttribute('aria-keyshortcuts', 'Enter Space')
  await expect(nodeHandle).toHaveAttribute('role', 'button')
  await expect(nodeHandle).toHaveAttribute('tabindex', '0')

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(1, 1)
  await expect.poll(() => handleDotOpacity(fieldHandle)).toBe(0)
  await expect.poll(() => handleDotOpacity(nodeHandle)).toBe(0)

  await modelNode.locator('header').hover()
  await expect.poll(() => handleDotOpacity(nodeHandle)).toBe(1)
  await fieldEntry.hover()
  await expect.poll(() => handleDotOpacity(fieldHandle)).toBe(1)

  await page.mouse.move(1, 1)
  await fieldHandle.focus()
  await expect.poll(() => handleDotOpacity(fieldHandle)).toBe(1)
  await nodeHandle.focus()
  await expect.poll(() => handleDotOpacity(nodeHandle)).toBe(1)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(1, 1)

  await modelNode
    .locator('header')
    .evaluate((element) => (element as HTMLElement).click())
  await expect(modelNode).toHaveClass(/is-selected/)
  await expect.poll(() => handleDotOpacity(nodeHandle)).toBe(1)

  await page
    .locator('.react-flow__pane')
    .evaluate((element) => (element as HTMLElement).click())
  await fieldRow.evaluate((element) => (element as HTMLButtonElement).click())
  await expect(fieldRow).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => handleDotOpacity(fieldHandle)).toBe(1)

  const [fieldRowSize, fieldHandleSize, nodeHandleSize] = await Promise.all([
    elementSize(fieldRow),
    elementSize(fieldHandle),
    elementSize(nodeHandle),
  ])
  expect(fieldRowSize.height).toBeGreaterThanOrEqual(56)
  expect(fieldRowSize.visualHeight).toBeGreaterThanOrEqual(44)
  expect(fieldHandleSize.width).toBeGreaterThanOrEqual(56)
  expect(fieldHandleSize.height).toBeGreaterThanOrEqual(56)
  expect(fieldHandleSize.visualWidth).toBeGreaterThanOrEqual(44)
  expect(fieldHandleSize.visualHeight).toBeGreaterThanOrEqual(44)
  expect(nodeHandleSize.width).toBeGreaterThanOrEqual(56)
  expect(nodeHandleSize.height).toBeGreaterThanOrEqual(56)
  expect(nodeHandleSize.visualWidth).toBeGreaterThanOrEqual(44)
  expect(nodeHandleSize.visualHeight).toBeGreaterThanOrEqual(44)

  const handleGeometry = await modelNode.evaluate((node) => {
    const rect = (element: Element) => element.getBoundingClientRect()
    const overlaps = (left: DOMRect, right: DOMRect) =>
      !(
        left.right <= right.left + 0.5 ||
        right.right <= left.left + 0.5 ||
        left.bottom <= right.top + 0.5 ||
        right.bottom <= left.top + 0.5
      )
    const entries = Array.from(node.querySelectorAll('.schema-field-entry'))
    const fieldHandles = entries.map((entry) =>
      rect(entry.querySelector('.field-handle')!),
    )
    const textIsClear = entries.every((entry, index) => {
      const handleRect = fieldHandles[index]!
      const text = entry.querySelector('.schema-field-row span')
      const type = entry.querySelector('.schema-field-row code')
      return (
        text !== null &&
        type !== null &&
        !overlaps(handleRect, rect(text)) &&
        !overlaps(handleRect, rect(type))
      )
    })
    const adjacentHandlesAreClear = fieldHandles.every(
      (handle, index) => index === 0 || !overlaps(fieldHandles[index - 1]!, handle),
    )
    const nodeHandles = Array.from(node.querySelectorAll('.node-handle')).map(rect)
    const nodeHandlesAreClear = nodeHandles.every((handle) =>
      fieldHandles.every((field) => !overlaps(handle, field)),
    )
    const fieldDot = getComputedStyle(node.querySelector('.field-handle')!, '::after')
    const nodeDot = getComputedStyle(node.querySelector('.node-handle')!, '::after')
    return {
      textIsClear,
      adjacentHandlesAreClear,
      nodeHandlesAreClear,
      fieldDotWidth: Number.parseFloat(fieldDot.width),
      nodeDotWidth: Number.parseFloat(nodeDot.width),
    }
  })
  expect(handleGeometry.textIsClear).toBe(true)
  expect(handleGeometry.adjacentHandlesAreClear).toBe(true)
  expect(handleGeometry.nodeHandlesAreClear).toBe(true)
  expect(handleGeometry.fieldDotWidth).toBe(7)
  expect(handleGeometry.nodeDotWidth).toBe(8)

  const toolboxControls = page.locator('.canvas-toolbox button')
  const canvasControls = page.locator('.react-flow__controls-button')
  const mobileControls = page
    .getByRole('navigation', { name: '手机端工作区' })
    .getByRole('button')
  await expect(toolboxControls).toHaveCount(3)
  await expect(canvasControls).toHaveCount(3)
  await expect(mobileControls).toHaveCount(4)

  for (const control of await toolboxControls.all()) {
    const size = await elementSize(control)
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
  }
  for (const control of await canvasControls.all()) {
    const size = await elementSize(control)
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
  }
  for (const control of await mobileControls.all()) {
    const size = await elementSize(control)
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
  }

  for (const name of ['返回项目首页', '复制', '下载']) {
    const size = await elementSize(page.getByRole('button', { name, exact: true }))
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
  }
})
