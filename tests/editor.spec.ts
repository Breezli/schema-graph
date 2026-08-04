import { expect, type Locator, type Page, test } from '@playwright/test'

async function openPastedSchemaEditor(page: Page, schema: string): Promise<Locator> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(schema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  if (await closeTour.isVisible()) await closeTour.click()

  const editor = page
    .getByRole('region', { name: 'Schema 代码' })
    .getByRole('code')
    .first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  return editor
}

async function placeAfterFieldName(
  page: Page,
  editor: Locator,
  lineOffset: number,
  fieldName: string,
): Promise<void> {
  await editor.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < lineOffset; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  for (let index = 0; index < fieldName.length; index += 1) {
    await page.keyboard.press('ArrowRight')
  }
}

async function visibleEditorLines(editor: Locator): Promise<string[]> {
  return editor
    .locator('.view-line')
    .evaluateAll((lines) =>
      lines.map((line) => (line.textContent ?? '').replaceAll('\u00a0', ' ')),
    )
}

async function firstVisibleEditorLine(editor: Locator): Promise<number> {
  return editor.locator('.line-numbers').evaluateAll((elements) => {
    const lineNumbers = elements.flatMap((element) => {
      const value = Number((element.textContent ?? '').trim())
      return Number.isFinite(value) && value > 0 ? [value] : []
    })
    return lineNumbers.length ? Math.min(...lineNumbers) : 0
  })
}

test('opens a multi-file template, edits the graph, and exports it', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /内容平台/ }).click()

  await expect(
    page.getByRole('heading', { name: '关系图从哪个方向展开？' }),
  ).toBeVisible({ timeout: 30_000 })
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

test('renders a connected 100-model schema on the relation canvas', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const largeSchema = Array.from({ length: 100 }, (_, index) => {
    const parent =
      index === 0
        ? ''
        : `\n  parentId Int\n  parent Model${index - 1} @relation(fields: [parentId], references: [id])`
    const children = index === 99 ? '' : `\n  children Model${index + 1}[]`
    return `model Model${index} {\n  id Int @id${parent}${children}\n}`
  }).join('\n\n')

  await page.goto('/')
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(largeSchema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  await expect(page.locator('.schema-node')).toHaveCount(100, { timeout: 30_000 })
  await expect(page.locator('.react-flow__edge')).toHaveCount(99, { timeout: 30_000 })
})

test('Monaco keeps focus and source updates for keyboard Space and insertText', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  const skipTour = page.getByRole('button', { name: '跳过指引' })
  if (await skipTour.isVisible()) await skipTour.click()

  const codePanel = page.getByRole('region', { name: 'Schema 代码' })
  const editor = codePanel.getByRole('code').first()
  const editorInput = editor.getByRole('textbox', {
    name: 'Schema editor: schema.prisma',
  })
  const source = editor.locator('.view-lines')
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('// A')
  await page.keyboard.press('Space')
  await page.keyboard.type('B')

  await expect(source).toContainText('// A B')
  await expect(editorInput).toBeFocused()

  await page.keyboard.press('Enter')
  await page.keyboard.insertText('model InsertTextModel {\n  id Int @id\n}')

  await expect(
    page.locator('.schema-node').filter({ hasText: /^InsertTextModel/ }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(editorInput).toBeFocused()
})

test('Monaco Tab aligns Prisma fields and advances from name to type to attributes', async ({
  page,
}) => {
  const editor = await openPastedSchemaEditor(
    page,
    `model Post {
  short Int
  muchLonger String @unique
}`,
  )

  await placeAfterFieldName(page, editor, 1, 'short')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('@id')

  await expect
    .poll(() => visibleEditorLines(editor))
    .toContain('  short      Int    @id')
  await expect
    .poll(() => visibleEditorLines(editor))
    .toContain('  muchLonger String @unique')
})

test('Monaco edits and atomic Tab use application undo and redo without double undo', async ({
  page,
}) => {
  const editor = await openPastedSchemaEditor(
    page,
    `model Post {
  id Int @id
  displayName String @unique
}`,
  )
  const originalLines = await visibleEditorLines(editor)

  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n// application history edit')
  await expect
    .poll(() => visibleEditorLines(editor))
    .toContain('// application history edit')
  const afterNormalEdit = await visibleEditorLines(editor)

  await placeAfterFieldName(page, editor, 1, 'id')
  await page.keyboard.press('Tab')
  await expect
    .poll(() => visibleEditorLines(editor))
    .toContain('  id          Int    @id')
  const afterAtomicTab = await visibleEditorLines(editor)

  await page.keyboard.press('Control+z')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(afterNormalEdit)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(afterAtomicTab)

  await page.keyboard.press('Control+z')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(afterNormalEdit)
  await page.keyboard.press('Control+z')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(originalLines)

  await page.keyboard.press('Control+y')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(afterNormalEdit)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => visibleEditorLines(editor)).toEqual(afterAtomicTab)
})

test('disables canonical copy and download while the current source is invalid', async ({
  page,
}) => {
  const editor = await openPastedSchemaEditor(
    page,
    `model User {
  id Int @id
}`,
  )
  const copy = page.getByRole('button', { name: '复制' })
  const download = page.getByRole('button', { name: '下载' })
  await expect(copy).toBeEnabled()
  await expect(download).toBeEnabled()

  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('model Broken {')

  await expect(page.getByText('代码有误，画布只读')).toBeVisible({ timeout: 15_000 })
  await expect(copy).toBeDisabled()
  await expect(download).toBeDisabled()
  await expect(copy).toHaveAttribute('title', 'Schema 代码有误，修复后才能复制或下载')
  await expect(download).toHaveAttribute(
    'title',
    'Schema 代码有误，修复后才能复制或下载',
  )
})

test('shows Monaco diagnostics and navigates from the visible problem description', async ({
  page,
}) => {
  const editor = await openPastedSchemaEditor(
    page,
    `model User {
  id Int @id
  broken String @
}`,
  )
  const problems = page.getByRole('region', { name: 'Schema 问题' })

  await expect(problems).toBeVisible({ timeout: 15_000 })
  await expect(problems).toContainText('错误')
  await expect(problems).toContainText('Prisma Schema 语法错误')
  await expect(problems).toContainText('schema.prisma')
  await expect(problems).toContainText('第 3 行 · 第 18 列')
  await expect(editor.locator('.squiggly-error')).toBeVisible({ timeout: 15_000 })

  await problems.getByRole('button').click()

  await expect(
    editor.getByRole('textbox', { name: 'Schema editor: schema.prisma' }),
  ).toBeFocused()
  await expect(
    editor.locator('.view-line').filter({ hasText: 'broken String @' }),
  ).toBeVisible()
  await expect(problems).toBeVisible()
})

test('later parse highlights do not pull Monaco away from a manual top edit', async ({
  page,
}) => {
  const fillerModels = Array.from(
    { length: 48 },
    (_, index) => `model Filler${index} {\n  id Int @id\n}`,
  )
  const editor = await openPastedSchemaEditor(
    page,
    `${fillerModels.join('\n\n')}\n\nmodel Target {\n  id Int @id\n}`,
  )
  const codePanel = page.getByRole('region', { name: 'Schema 代码' })
  const status = codePanel.locator('.parse-indicator').first()
  const structure = page.getByRole('navigation', { name: '项目结构' })

  await structure.getByRole('button', { name: 'Target', exact: true }).click()
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeGreaterThan(100)

  await editor.click()
  await page.keyboard.press('Control+Home')
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeLessThanOrEqual(2)
  await page.keyboard.insertText('// 顶部编辑\n')

  await expect(editor.locator('.view-lines')).toContainText('// 顶部编辑')
  await expect(status).toHaveText('解析中')
  await expect(status).toHaveText('结构有效', { timeout: 15_000 })
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeLessThanOrEqual(2)
})

test('consumed selection navigation does not replay after reopening the code pane', async ({
  page,
}) => {
  const fillerModels = Array.from(
    { length: 48 },
    (_, index) => `model Filler${index} {\n  id Int @id\n}`,
  )
  const editor = await openPastedSchemaEditor(
    page,
    `${fillerModels.join('\n\n')}\n\nmodel Target {\n  id Int @id\n}`,
  )
  const structure = page.getByRole('navigation', { name: '项目结构' })
  const codeToggle = page.locator('button[aria-controls="workspace-code-pane"]')

  await structure.getByRole('button', { name: 'Target', exact: true }).click()
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeGreaterThan(100)

  await editor.click()
  await page.keyboard.press('Control+Home')
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeLessThanOrEqual(2)

  await codeToggle.click()
  await expect(page.getByRole('region', { name: 'Schema 代码' })).toHaveCount(0)
  await codeToggle.click()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(700)

  const reopenedFirstLine = await firstVisibleEditorLine(editor)
  expect(reopenedFirstLine).toBeGreaterThan(0)
  expect(reopenedFirstLine).toBeLessThanOrEqual(2)
})

test('consumed diagnostic navigation does not replay focus or position after reopening the code pane', async ({
  page,
}) => {
  const fillerModels = Array.from(
    { length: 48 },
    (_, index) => `model Filler${index} {\n  id Int @id\n}`,
  )
  const editor = await openPastedSchemaEditor(
    page,
    `${fillerModels.join('\n\n')}\n\nmodel Broken {\n  id Int @id\n  broken String @\n}`,
  )
  const problems = page.getByRole('region', { name: 'Schema 问题' })
  const editorInput = editor.getByRole('textbox', {
    name: 'Schema editor: schema.prisma',
  })
  const codeToggle = page.locator('button[aria-controls="workspace-code-pane"]')

  await expect(problems).toBeVisible({ timeout: 15_000 })
  await problems.getByRole('button').click()
  await expect(editorInput).toBeFocused()
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeGreaterThan(100)

  await page.keyboard.press('Control+Home')
  await expect.poll(() => firstVisibleEditorLine(editor)).toBeLessThanOrEqual(2)

  await codeToggle.click()
  await expect(page.getByRole('region', { name: 'Schema 代码' })).toHaveCount(0)
  await codeToggle.click()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(700)

  const reopenedFirstLine = await firstVisibleEditorLine(editor)
  expect(reopenedFirstLine).toBeGreaterThan(0)
  expect(reopenedFirstLine).toBeLessThanOrEqual(2)
  await expect(editorInput).not.toBeFocused()
  await expect(codeToggle).toBeFocused()
})

test('Monaco leaves Shift+Tab and ineligible rows to native indentation', async ({
  page,
}) => {
  const editor = await openPastedSchemaEditor(
    page,
    `model Post {
  id Int @id
}

// note

enum Role {
  USER
}`,
  )

  await placeAfterFieldName(page, editor, 1, 'id')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => visibleEditorLines(editor)).toContain('id Int @id')
  await page.keyboard.press('Control+z')

  await editor.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect.poll(() => visibleEditorLines(editor)).toContain('  // note')

  await editor.click()
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < 7; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect.poll(() => visibleEditorLines(editor)).toContain('    USER')
})

test('production preview loads Monaco and its worker without a CDN', async ({
  context,
  page,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_PREVIEW,
    'Monaco request assertions require the production preview server.',
  )

  const monacoCdnRequests: string[] = []
  const editorWorkerRequests: string[] = []
  context.on('request', (request) => {
    const url = request.url()
    if (/\/assets\/editor\.worker-[^/]+\.js/.test(url)) {
      editorWorkerRequests.push(url)
    }
    if (
      new URL(url).origin !== 'http://127.0.0.1:4173' &&
      /monaco-editor|editor\.worker|\/vs\/loader/i.test(url)
    ) {
      monacoCdnRequests.push(url)
    }
  })

  await page.goto('/')
  await page.getByRole('button', { name: /电商核心/ }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  const editor = page
    .getByRole('region', { name: 'Schema 代码' })
    .getByRole('code')
    .first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => editorWorkerRequests.length > 0, { timeout: 20_000 })
    .toBe(true)
  expect(
    editorWorkerRequests.every(
      (url) => new URL(url).origin === page.url().split('/').slice(0, 3).join('/'),
    ),
  ).toBe(true)
  expect(monacoCdnRequests).toEqual([])
})
