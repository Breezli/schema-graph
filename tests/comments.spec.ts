import { expect, type Locator, type Page, test } from '@playwright/test'

const userModelComment = '用户模型的完整说明，包含账户、文章与权限关系的上下文'
const postModelComment = '文章模型的完整说明'
const longFieldComment = '字段一有一段很长的说明，用于验证标签省略显示与完整标题'

const commentedSchema = `// ${userModelComment}
model User {
  // 主键 ID
  id Int @id
  // ${longFieldComment}
  fieldOne String
  // 字段二
  fieldTwo String
  // 字段三
  fieldThree String
  // 字段四
  fieldFour String
  // 字段五
  fieldFive String
  // 字段六
  fieldSix String
  // 标准密度下隐藏的字段
  hiddenField String
  // 用户发布的文章
  posts Post[]
}

// ${postModelComment}
model Post {
  // 主键 ID
  id Int @id
  // 作者 ID
  authorId Int
  // 作者关系
  author User @relation(fields: [authorId], references: [id])
  // 文章标题
  title String
}`

function schemaNode(page: Page, name: string): Locator {
  return page.locator('.schema-node').filter({
    has: page.locator('header strong', { hasText: new RegExp(`^${name}$`) }),
  })
}

async function viewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function waitForViewportStable(page: Page): Promise<void> {
  await expect(page.locator('.canvas-panel')).toHaveAttribute(
    'data-initial-fit-status',
    'complete',
    { timeout: 30_000 },
  )
  await page.locator('.react-flow__viewport').evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let previousTransform = getComputedStyle(element).transform
        let stableFrames = 0
        const check = () => {
          const currentTransform = getComputedStyle(element).transform
          stableFrames = currentTransform === previousTransform ? stableFrames + 1 : 0
          previousTransform = currentTransform
          if (stableFrames >= 2) {
            resolve()
            return
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
  )
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

test('attaches model and contextual field comments without changing graph geometry', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /粘贴 Schema/ }).click()
  await page.getByLabel('Prisma Schema 内容').fill(commentedSchema)
  await page.getByRole('button', { name: '打开工作台' }).click()
  await page.getByRole('button', { name: /从左到右/ }).click()

  const closeTour = page.getByRole('button', { name: '关闭新手指引' })
  if (await closeTour.isVisible()) await closeTour.click()

  const user = schemaNode(page, 'User')
  const post = schemaNode(page, 'Post')
  await expect(user).toBeVisible({ timeout: 15_000 })
  await expect(post).toBeVisible()
  await waitForViewportStable(page)
  const userModelNote = user.locator('header .schema-model-comment')
  const postModelNote = post.locator('header .schema-model-comment')
  await expect(userModelNote).toHaveAttribute('role', 'note')
  await expect(userModelNote).toHaveAttribute('title', userModelComment)
  await expect(postModelNote).toHaveAttribute('title', postModelComment)
  await expect(userModelNote.locator('.visually-hidden')).toHaveText(
    `User：${userModelComment}`,
  )
  const modelCommentPlacement = await user.evaluate((element) => {
    const header = element.querySelector('header')!.getBoundingClientRect()
    const title = element.querySelector('.schema-node-title')!.getBoundingClientRect()
    const comment = element
      .querySelector('.schema-model-comment')!
      .getBoundingClientRect()
    const visibleText = element.querySelector<HTMLElement>(
      '.schema-model-comment > [aria-hidden="true"]',
    )!
    return {
      headerRight: header.right,
      titleRight: title.right,
      commentLeft: comment.left,
      commentRight: comment.right,
      maxWidth: getComputedStyle(element.querySelector('.schema-model-comment')!)
        .maxWidth,
      truncated: visibleText.scrollWidth > visibleText.clientWidth,
    }
  })
  expect(modelCommentPlacement.commentLeft).toBeGreaterThanOrEqual(
    modelCommentPlacement.titleRight,
  )
  expect(modelCommentPlacement.commentRight).toBeLessThanOrEqual(
    modelCommentPlacement.headerRight,
  )
  expect(modelCommentPlacement.maxWidth).toBe('88px')
  expect(modelCommentPlacement.truncated).toBe(true)

  const canvas = page.locator('.canvas-panel')
  await expect(canvas.getByText('字段注', { exact: true })).toHaveCount(0)
  await expect(canvas.getByText('模型注', { exact: true })).toHaveCount(0)
  await expect(page.locator('.schema-comment-sidecar')).toHaveCount(0)
  await expect(page.locator('.schema-field-comment-tag')).toHaveCount(0)
  await expect(page.locator('.schema-hidden-comment-rail')).toHaveCount(0)

  const userSizeBefore = await user.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  const postSizeBefore = await post.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  const viewportBefore = await viewport(page)

  await user.locator('header').click()

  await expect(user).toHaveAttribute('data-comment-context', 'root')
  await expect(post).toHaveAttribute('data-comment-context', 'related')

  const userTags = user.locator('.schema-field-comment-tag')
  const postTags = post.locator('.schema-field-comment-tag')
  await expect(userTags).toHaveCount(7)
  await expect(postTags).toHaveCount(4)
  await expect(
    post.locator('.schema-field-comment-tag[data-field-name="author"]'),
  ).toHaveAttribute('title', 'Post.author：作者关系')

  const longTag = user.locator('.schema-field-comment-tag[data-field-name="fieldOne"]')
  await expect(longTag).toHaveAttribute('role', 'note')
  await expect(longTag).toHaveAttribute('title', `User.fieldOne：${longFieldComment}`)
  await expect(longTag.locator('.visually-hidden')).toHaveText(
    `User.fieldOne：${longFieldComment}`,
  )
  const tagPresentation = await longTag.evaluate((element) => {
    const text = element.querySelector<HTMLElement>('.schema-field-comment-tag-text')!
    const style = getComputedStyle(element)
    const textStyle = getComputedStyle(text)
    return {
      width: style.width,
      maxWidth: style.maxWidth,
      textOverflow: textStyle.textOverflow,
      truncated: text.scrollWidth > text.clientWidth,
    }
  })
  expect(tagPresentation.width).toBe('116px')
  expect(tagPresentation.maxWidth).toBe('116px')
  expect(tagPresentation.textOverflow).toBe('ellipsis')
  expect(tagPresentation.truncated).toBe(true)

  const hiddenRail = user.getByRole('list', {
    name: 'User 当前密度下隐藏的字段说明',
  })
  await expect(hiddenRail).toBeVisible()
  await expect(hiddenRail).toHaveAttribute('tabindex', '0')
  await expect(hiddenRail.getByRole('listitem')).toHaveCount(2)
  const hiddenComment = hiddenRail.locator(
    '.schema-hidden-comment-item[data-field-name="hiddenField"]',
  )
  const hiddenFullText =
    'User.hiddenField：标准密度下隐藏的字段；当前密度下字段未显示在卡片中'
  await expect(hiddenComment).toContainText('hiddenField')
  await expect(hiddenComment).toContainText('标准密度下隐藏的字段')
  await expect(hiddenComment).toHaveAttribute('title', hiddenFullText)
  await expect(hiddenComment.locator('.visually-hidden')).toHaveText(hiddenFullText)

  const userSizeAfter = await user.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  const postSizeAfter = await post.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(userSizeAfter.width).toBeCloseTo(userSizeBefore.width, 3)
  expect(userSizeAfter.height).toBeCloseTo(userSizeBefore.height, 3)
  expect(postSizeAfter.width).toBeCloseTo(postSizeBefore.width, 3)
  expect(postSizeAfter.height).toBeCloseTo(postSizeBefore.height, 3)

  const viewportAfter = await viewport(page)
  expect(viewportAfter.zoom).toBeCloseTo(viewportBefore.zoom, 5)
  expect(viewportAfter.x).toBeCloseTo(viewportBefore.x, 3)
  expect(viewportAfter.y).toBeCloseTo(viewportBefore.y, 3)

  const [userRect, postRect, tagRect, railRect] = await Promise.all([
    user.boundingBox(),
    post.boundingBox(),
    longTag.boundingBox(),
    hiddenRail.boundingBox(),
  ])
  if (!userRect || !postRect || !tagRect || !railRect) {
    throw new Error('Expected visible graph cards and attached comment tags')
  }
  expect(rectanglesOverlap(userRect, postRect)).toBe(false)
  expect(tagRect.x + tagRect.width).toBeLessThanOrEqual(userRect.x)
  expect(railRect.x + railRect.width).toBeLessThanOrEqual(userRect.x)
  expect(rectanglesOverlap(tagRect, postRect)).toBe(false)
  expect(rectanglesOverlap(railRect, postRect)).toBe(false)
})
