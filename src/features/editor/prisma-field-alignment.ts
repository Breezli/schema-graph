export type PrismaLineEnding = '\n' | '\r\n'

/** One-based, Monaco-compatible document position. */
export interface PrismaDocumentPosition {
  readonly line: number
  readonly column: number
}

export type PrismaCursor = number | PrismaDocumentPosition

export interface PrismaSelection {
  readonly start: PrismaCursor
  readonly end: PrismaCursor
}

export interface PrismaFieldAlignmentRequest {
  readonly text: string
  readonly cursor: PrismaCursor
  readonly lineEnding: PrismaLineEnding
  readonly selection?: PrismaSelection
  readonly cursorCount?: number
}

export interface PrismaReplacementRange {
  readonly startOffset: number
  readonly endOffset: number
  readonly start: PrismaDocumentPosition
  readonly end: PrismaDocumentPosition
}

export interface PrismaFieldAlignmentEdit {
  readonly kind: 'edit'
  readonly replacementRange: PrismaReplacementRange
  readonly replacementText: string
  readonly cursorOffset: number
  readonly cursor: PrismaDocumentPosition
  readonly columns: {
    /** One-based column; always 3 because field indentation is two spaces. */
    readonly name: number
    readonly type: number
    readonly attributes: number
  }
  readonly declaration: {
    readonly kind: 'model' | 'view' | 'type'
    readonly name: string
  }
  readonly changed: boolean
}

export type PrismaFieldAlignmentNoopReason =
  | 'multiple-cursors'
  | 'nonempty-selection'
  | 'invalid-cursor'
  | 'outside-eligible-declaration'
  | 'ineligible-row'
  | 'unsupported-cursor-context'

export interface PrismaFieldAlignmentNoop {
  readonly kind: 'noop'
  readonly fallback: true
  readonly reason: PrismaFieldAlignmentNoopReason
}

export type PrismaFieldAlignmentResult =
  PrismaFieldAlignmentEdit | PrismaFieldAlignmentNoop

interface LineRecord {
  readonly index: number
  readonly start: number
  readonly contentEnd: number
  readonly end: number
  readonly content: string
}

interface DeclarationBlock {
  readonly kind: 'model' | 'view' | 'type'
  readonly name: string
  readonly open: number
  readonly bodyBraceDepth: number
  close: number
}

interface DeclarationCandidate {
  readonly kind: 'model' | 'view' | 'type' | 'enum' | 'datasource' | 'generator'
  readonly name: string
}

interface FieldRow {
  readonly line: LineRecord
  readonly name: string
  readonly nameStart: number
  readonly nameEnd: number
  readonly type?: string
  readonly typeStart?: number
  readonly typeEnd?: number
  readonly remainder?: string
  readonly remainderStart?: number
}

interface LineLexicalMetadata {
  /** Structural brace depth at the beginning of the physical line. */
  readonly bodyBraceDepth: number
  readonly startsInBlockComment: boolean
  readonly startsInString: boolean
  readonly continuationDepth: {
    readonly parentheses: number
    readonly brackets: number
    readonly braces: number
  }
}

interface LexicalScan {
  readonly structuralText: string
  readonly lines: readonly LineLexicalMetadata[]
}

function noop(reason: PrismaFieldAlignmentNoopReason): PrismaFieldAlignmentNoop {
  return { kind: 'noop', fallback: true, reason }
}

function collectLines(text: string): LineRecord[] {
  const lines: LineRecord[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    let contentEnd = start
    while (
      contentEnd < text.length &&
      text[contentEnd] !== '\n' &&
      text[contentEnd] !== '\r'
    ) {
      contentEnd += 1
    }

    let end = contentEnd
    if (text[end] === '\r' && text[end + 1] === '\n') end += 2
    else if (text[end] === '\r' || text[end] === '\n') end += 1

    lines.push({
      index,
      start,
      contentEnd,
      end,
      content: text.slice(start, contentEnd),
    })
    index += 1
    start = end
  }

  if (text.length === 0 || text.endsWith('\n') || text.endsWith('\r')) {
    lines.push({
      index,
      start: text.length,
      contentEnd: text.length,
      end: text.length,
      content: '',
    })
  }

  return lines
}

function positionToOffset(
  cursor: PrismaCursor,
  lines: readonly LineRecord[],
  textLength: number,
): number | undefined {
  if (typeof cursor === 'number') {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > textLength) return undefined
    return cursor
  }

  if (!Number.isInteger(cursor.line) || !Number.isInteger(cursor.column))
    return undefined
  const line = lines[cursor.line - 1]
  if (!line || cursor.column < 1 || cursor.column > line.content.length + 1) {
    return undefined
  }
  return line.start + cursor.column - 1
}

function lineAtOffset(
  lines: readonly LineRecord[],
  offset: number,
): LineRecord | undefined {
  for (const line of lines) {
    if (offset >= line.start && offset <= line.contentEnd) return line
  }
  return undefined
}

function offsetToPosition(
  lines: readonly LineRecord[],
  offset: number,
): PrismaDocumentPosition {
  const line = lineAtOffset(lines, offset) ?? lines[lines.length - 1]
  if (!line) return { line: 1, column: 1 }
  return { line: line.index + 1, column: offset - line.start + 1 }
}

/**
 * Replaces comments and quoted strings with spaces while preserving offsets and
 * records the state/depth at every physical line boundary. This lets field-row
 * detection distinguish declaration-body rows from multiline continuations.
 */
function scanLexicalText(text: string, lines: readonly LineRecord[]): LexicalScan {
  const output = text.split('')
  const lineMetadata: LineLexicalMetadata[] = []
  let index = 0
  let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code'
  let quote = ''
  let parentheses = 0
  let brackets = 0
  let braces = 0
  let nextLineIndex = 0

  const recordLineMetadata = () => {
    while (lines[nextLineIndex]?.start === index) {
      lineMetadata.push({
        bodyBraceDepth: braces,
        startsInBlockComment: state === 'block-comment',
        startsInString: state === 'string',
        continuationDepth: { parentheses, brackets, braces },
      })
      nextLineIndex += 1
    }
  }

  while (index < text.length) {
    recordLineMetadata()
    const character = text[index]
    const next = text[index + 1]

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') state = 'code'
      else output[index] = ' '
      index += 1
      continue
    }

    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        output[index] = ' '
        output[index + 1] = ' '
        index += 2
        state = 'code'
      } else {
        if (character !== '\n' && character !== '\r') output[index] = ' '
        index += 1
      }
      continue
    }

    if (state === 'string') {
      if (character === '\\') {
        output[index] = ' '
        if (
          index + 1 < text.length &&
          text[index + 1] !== '\n' &&
          text[index + 1] !== '\r'
        ) {
          output[index + 1] = ' '
          index += 2
        } else {
          index += 1
        }
      } else {
        if (character !== '\n' && character !== '\r') output[index] = ' '
        index += 1
        if (character === quote) state = 'code'
      }
      continue
    }

    if (character === '/' && next === '/') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 2
      state = 'line-comment'
    } else if (character === '/' && next === '*') {
      output[index] = ' '
      output[index + 1] = ' '
      index += 2
      state = 'block-comment'
    } else if (character === '"' || character === "'") {
      output[index] = ' '
      quote = character
      state = 'string'
      index += 1
    } else if (character === '(') {
      parentheses += 1
      index += 1
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1)
      index += 1
    } else if (character === '[') {
      brackets += 1
      index += 1
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1)
      index += 1
    } else if (character === '{') {
      braces += 1
      index += 1
    } else if (character === '}') {
      braces = Math.max(0, braces - 1)
      index += 1
    } else {
      index += 1
    }
  }

  recordLineMetadata()

  return { structuralText: output.join(''), lines: lineMetadata }
}

function scanDeclarationBlocks(text: string, structural: string): DeclarationBlock[] {
  const candidates = new Map<number, DeclarationCandidate>()
  const declarationPattern =
    /\b(model|view|type|enum|datasource|generator)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g

  for (const match of structural.matchAll(declarationPattern)) {
    if (match.index === undefined) continue
    const matchedText = match[0]
    const open = match.index + matchedText.lastIndexOf('{')
    candidates.set(open, {
      kind: match[1] as DeclarationCandidate['kind'],
      name: match[2] ?? '',
    })
  }

  const blocks: DeclarationBlock[] = []
  const braceStack: Array<{ open: number; block?: DeclarationBlock }> = []
  let parentheses = 0
  let brackets = 0

  for (let index = 0; index < structural.length; index += 1) {
    const character = structural[index]
    if (character === '(') parentheses += 1
    else if (character === ')') parentheses = Math.max(0, parentheses - 1)
    else if (character === '[') brackets += 1
    else if (character === ']') brackets = Math.max(0, brackets - 1)
    else if (character === '{') {
      const candidate = candidates.get(index)
      let block: DeclarationBlock | undefined
      if (candidate && braceStack.length === 0 && parentheses === 0 && brackets === 0) {
        if (
          candidate.kind === 'model' ||
          candidate.kind === 'view' ||
          candidate.kind === 'type'
        ) {
          block = {
            kind: candidate.kind,
            name: candidate.name,
            open: index,
            bodyBraceDepth: braceStack.length + 1,
            close: text.length,
          }
          blocks.push(block)
        }
      }
      braceStack.push({ open: index, block })
    } else if (character === '}') {
      const opened = braceStack.pop()
      if (opened?.block) opened.block.close = index
    }
  }

  return blocks
}

function isWhitespace(value: string): boolean {
  return /^[\t ]*$/.test(value)
}

function tokenEnd(content: string, start: number): number {
  let parentheses = 0
  let brackets = 0
  let braces = 0
  let quote = ''

  for (let index = start; index < content.length; index += 1) {
    const character = content[index]

    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }

    if (character === '"' || character === "'") quote = character
    else if (character === '(') parentheses += 1
    else if (character === ')') parentheses = Math.max(0, parentheses - 1)
    else if (character === '[') brackets += 1
    else if (character === ']') brackets = Math.max(0, brackets - 1)
    else if (character === '{') braces += 1
    else if (character === '}') braces = Math.max(0, braces - 1)
    else if (
      (character === ' ' || character === '\t') &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return index
    }
  }

  return content.length
}

function parseFieldRow(line: LineRecord): FieldRow | undefined {
  const content = line.content
  let cursor = 0
  while (content[cursor] === ' ' || content[cursor] === '\t') cursor += 1

  const leading = content.slice(cursor)
  if (
    leading.length === 0 ||
    leading.startsWith('//') ||
    leading.startsWith('/*') ||
    leading.startsWith('@@') ||
    leading.startsWith('}')
  ) {
    return undefined
  }

  const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(leading)
  if (!nameMatch) return undefined

  const nameStart = cursor
  const name = nameMatch[0]
  const nameEnd = nameStart + name.length
  cursor = nameEnd
  while (content[cursor] === ' ' || content[cursor] === '\t') cursor += 1

  if (cursor >= content.length) {
    return { line, name, nameStart, nameEnd }
  }

  if (content.startsWith('//', cursor) || content[cursor] === '@') {
    return {
      line,
      name,
      nameStart,
      nameEnd,
      remainder: content.slice(cursor),
      remainderStart: cursor,
    }
  }

  const typeStart = cursor
  const typeEnd = tokenEnd(content, typeStart)
  const type = content.slice(typeStart, typeEnd)
  cursor = typeEnd
  while (content[cursor] === ' ' || content[cursor] === '\t') cursor += 1

  return {
    line,
    name,
    nameStart,
    nameEnd,
    type,
    typeStart,
    typeEnd,
    ...(cursor < content.length
      ? { remainder: content.slice(cursor), remainderStart: cursor }
      : {}),
  }
}

function targetForCursor(
  row: FieldRow,
  cursorInLine: number,
): 'type' | 'attributes' | undefined {
  if (cursorInLine < row.nameEnd) return undefined

  if (!row.type || row.typeStart === undefined || row.typeEnd === undefined) {
    const limit = row.remainderStart ?? row.line.content.length
    if (
      cursorInLine <= limit &&
      isWhitespace(row.line.content.slice(row.nameEnd, cursorInLine))
    ) {
      return 'type'
    }
    return undefined
  }

  if (cursorInLine < row.typeStart) {
    return isWhitespace(row.line.content.slice(row.nameEnd, cursorInLine))
      ? 'type'
      : undefined
  }

  if (cursorInLine === row.typeStart) return 'attributes'

  if (cursorInLine < row.typeEnd) return undefined

  const limit = row.remainderStart ?? row.line.content.length
  if (
    cursorInLine <= limit &&
    isWhitespace(row.line.content.slice(row.typeEnd, cursorInLine))
  ) {
    return 'attributes'
  }

  return undefined
}

function renderFieldRow(
  row: FieldRow,
  typeOffset: number,
  attributesOffset: number,
  currentRow: FieldRow,
  target: 'type' | 'attributes',
): string {
  let output = `  ${row.name}`

  if (row.type) {
    output = output.padEnd(typeOffset, ' ') + row.type
    if (row.remainder) {
      output = output.padEnd(attributesOffset, ' ') + row.remainder
    } else if (row === currentRow && target === 'attributes') {
      output = output.padEnd(attributesOffset, ' ')
    }
  } else if (row.remainder) {
    output = output.padEnd(attributesOffset, ' ') + row.remainder
  } else if (row === currentRow && target === 'type') {
    output = output.padEnd(typeOffset, ' ')
  }

  return output
}

/**
 * Produces one deterministic replacement for Prisma field alignment and a
 * resulting cursor position. The scanner is deliberately independent of the
 * strict schema parser so it remains useful while the current row is invalid.
 */
export function alignPrismaFieldsForTab(
  request: PrismaFieldAlignmentRequest,
): PrismaFieldAlignmentResult {
  if ((request.cursorCount ?? 1) !== 1) return noop('multiple-cursors')

  const lines = collectLines(request.text)
  const cursorOffset = positionToOffset(request.cursor, lines, request.text.length)
  if (cursorOffset === undefined) return noop('invalid-cursor')

  if (request.selection) {
    const selectionStart = positionToOffset(
      request.selection.start,
      lines,
      request.text.length,
    )
    const selectionEnd = positionToOffset(
      request.selection.end,
      lines,
      request.text.length,
    )
    if (selectionStart === undefined || selectionEnd === undefined) {
      return noop('invalid-cursor')
    }
    if (selectionStart !== selectionEnd) return noop('nonempty-selection')
  }

  const currentLine = lineAtOffset(lines, cursorOffset)
  if (!currentLine) return noop('invalid-cursor')

  const lexical = scanLexicalText(request.text, lines)
  const declaration = scanDeclarationBlocks(request.text, lexical.structuralText).find(
    (block) => cursorOffset > block.open && cursorOffset <= block.close,
  )
  if (!declaration) return noop('outside-eligible-declaration')

  const rows = lines
    .filter((line) => {
      if (line.start <= declaration.open || line.start >= declaration.close) {
        return false
      }

      const metadata = lexical.lines[line.index]
      return (
        metadata !== undefined &&
        metadata.bodyBraceDepth === declaration.bodyBraceDepth &&
        metadata.continuationDepth.parentheses === 0 &&
        metadata.continuationDepth.brackets === 0 &&
        metadata.continuationDepth.braces === declaration.bodyBraceDepth &&
        !metadata.startsInBlockComment &&
        !metadata.startsInString
      )
    })
    .map(parseFieldRow)
    .filter((row): row is FieldRow => row !== undefined)

  const currentRow = rows.find((row) => row.line.index === currentLine.index)
  if (!currentRow) return noop('ineligible-row')

  const target = targetForCursor(currentRow, cursorOffset - currentLine.start)
  if (!target) return noop('unsupported-cursor-context')

  const longestName = Math.max(...rows.map((row) => row.name.length))
  const longestType = Math.max(0, ...rows.map((row) => row.type?.length ?? 0))
  const typeOffset = 2 + longestName + 1
  const attributesOffset = typeOffset + longestType + 1

  const firstLineIndex = rows[0]?.line.index
  const lastLineIndex = rows[rows.length - 1]?.line.index
  if (firstLineIndex === undefined || lastLineIndex === undefined) {
    return noop('ineligible-row')
  }

  const replacementLines: string[] = []
  let cursorWithinReplacement = 0
  for (let index = firstLineIndex; index <= lastLineIndex; index += 1) {
    const line = lines[index]
    if (!line) continue
    const row = rows.find((candidate) => candidate.line.index === index)
    const rendered = row
      ? renderFieldRow(row, typeOffset, attributesOffset, currentRow, target)
      : line.content
    if (index === currentLine.index) {
      cursorWithinReplacement =
        replacementLines.reduce(
          (length, value) => length + value.length + request.lineEnding.length,
          0,
        ) + (target === 'type' ? typeOffset : attributesOffset)
    }
    replacementLines.push(rendered)
  }

  const firstLine = lines[firstLineIndex]
  const lastLine = lines[lastLineIndex]
  if (!firstLine || !lastLine) return noop('ineligible-row')

  const replacementText = replacementLines.join(request.lineEnding)
  const replacementStart = firstLine.start
  const replacementEnd = lastLine.contentEnd
  const resultingCursorOffset = replacementStart + cursorWithinReplacement
  const resultingText =
    request.text.slice(0, replacementStart) +
    replacementText +
    request.text.slice(replacementEnd)
  const resultingLines = collectLines(resultingText)

  return {
    kind: 'edit',
    replacementRange: {
      startOffset: replacementStart,
      endOffset: replacementEnd,
      start: offsetToPosition(lines, replacementStart),
      end: offsetToPosition(lines, replacementEnd),
    },
    replacementText,
    cursorOffset: resultingCursorOffset,
    cursor: offsetToPosition(resultingLines, resultingCursorOffset),
    columns: {
      name: 3,
      type: typeOffset + 1,
      attributes: attributesOffset + 1,
    },
    declaration: { kind: declaration.kind, name: declaration.name },
    changed: request.text.slice(replacementStart, replacementEnd) !== replacementText,
  }
}
