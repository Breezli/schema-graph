import {
  parsePrismaSchema,
  type ArrayExpression,
  type BaseType,
  type BlockAttribute,
  type CommentBlock,
  type Config,
  type ConfigBlock,
  type EnumDeclaration as ParserEnumDeclaration,
  type EnumValue,
  type FieldAttribute,
  type FieldDeclaration,
  type FunctionCall,
  type ModelDeclaration as ParserModelDeclaration,
  type NamedArgument,
  type PrismaType,
  type ScalarLiteral,
  type SchemaArgument as ParserSchemaArgument,
  type SchemaDeclaration as ParserSchemaDeclaration,
  type SchemaExpression,
  type SourceRange as ParserSourceRange,
  type TrailingComment,
  type TypeAlias,
} from '@loancrate/prisma-schema-parser'

import type { SchemaParserPort } from '@/domain/schema/ports'
import type {
  BlockAttributeMember,
  CommentMember,
  ConfigDeclaration,
  ConfigEntryMember,
  EnumDeclaration,
  EnumMember,
  EnumValueMember,
  ModelDeclaration,
  ModelMember,
  ParseFileResult,
  SchemaArgument,
  SchemaAttribute,
  SchemaComment,
  SchemaDeclaration,
  SchemaDiagnostic,
  SchemaField,
  SchemaTypeRef,
  SchemaValue,
  SourceRange,
  SourceReference,
  TypeAliasDeclaration,
  VirtualSchemaFile,
} from '@/domain/schema/types'
import { formatSchemaDocument } from '@/domain/schema/writer'

function mapRange(range?: ParserSourceRange): SourceRange | undefined {
  if (!range) return undefined
  return {
    start: { ...range.start },
    end: { ...range.end },
  }
}

function sourceReference(filePath: string, range?: ParserSourceRange): SourceReference {
  return { filePath, range: mapRange(range) }
}

function createId(
  filePath: string,
  kind: string,
  name: string,
  range?: ParserSourceRange,
): string {
  const anonymousHint = name ? '' : `:${range?.start.offset ?? 'virtual'}`
  return `${kind}:${filePath}:${name}${anonymousHint}`
}

function createMemberId(
  declarationId: string,
  kind: string,
  name: string,
  range?: ParserSourceRange,
): string {
  const anonymousHint = name ? '' : `:${range?.start.offset ?? 'virtual'}`
  return `${kind}:${declarationId}:${name}${anonymousHint}`
}

function mapComment(comment: TrailingComment, filePath: string): SchemaComment {
  return {
    kind: comment.kind,
    text: comment.text,
    source: sourceReference(filePath, comment.location),
  }
}

type ParserLocatedNode = {
  readonly kind: string
  readonly location?: ParserSourceRange
}

function groupComments(comments: readonly SchemaComment[]): CommentMember[] {
  const groups: SchemaComment[][] = []

  for (const comment of comments) {
    const previous = groups.at(-1)?.at(-1)
    const previousRange = previous?.source?.range
    const currentRange = comment.source?.range
    if (
      previous &&
      previousRange &&
      currentRange &&
      currentRange.start.line === previousRange.end.line + 1
    ) {
      groups.at(-1)?.push(comment)
    } else {
      groups.push([comment])
    }
  }

  return groups.map((comments) => ({ kind: 'commentBlock', comments }))
}

function splitCommentBlock(block: CommentBlock, filePath: string): CommentMember[] {
  return groupComments(block.comments.map((entry) => mapComment(entry, filePath)))
}

function isImmediatelyBefore(
  comments: CommentMember,
  location?: ParserSourceRange,
): boolean {
  const lastRange = comments.comments.at(-1)?.source?.range
  return Boolean(
    location && lastRange && lastRange.end.line + 1 === location.start.line,
  )
}

function mapCommentableSequence<
  TNode extends ParserLocatedNode,
  TResult extends { readonly kind: string },
>(
  nodes: readonly TNode[],
  filePath: string,
  mapNode: (
    node: Exclude<TNode, CommentBlock>,
    leadingComments?: readonly SchemaComment[],
  ) => TResult,
  attachTrailingComment?: (value: TResult, comment: SchemaComment) => TResult,
): Array<TResult | CommentMember> {
  const mapped: Array<TResult | CommentMember> = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    if (node.kind !== 'commentBlock') {
      mapped.push(mapNode(node as Exclude<TNode, CommentBlock>))
      continue
    }

    let groups = splitCommentBlock(node as unknown as CommentBlock, filePath)
    const previous = nodes[index - 1]
    const firstComment = groups[0]?.comments[0]
    if (
      attachTrailingComment &&
      previous &&
      previous.kind !== 'commentBlock' &&
      previous.location &&
      firstComment?.source?.range?.start.line === previous.location.end.line
    ) {
      const previousValue = mapped.at(-1)
      if (previousValue && previousValue.kind !== 'commentBlock') {
        mapped[mapped.length - 1] = attachTrailingComment(
          previousValue as TResult,
          firstComment,
        )
      }
      groups = groupComments(groups.flatMap((group) => group.comments).slice(1))
    }
    const next = nodes[index + 1]
    const finalGroup = groups.at(-1)
    if (
      next &&
      next.kind !== 'commentBlock' &&
      finalGroup &&
      isImmediatelyBefore(finalGroup, next.location)
    ) {
      mapped.push(...groups.slice(0, -1))
      mapped.push(mapNode(next as Exclude<TNode, CommentBlock>, finalGroup.comments))
      index += 1
    } else {
      mapped.push(...groups)
    }
  }

  return mapped
}

function mapArgument(argument: ParserSchemaArgument, filePath: string): SchemaArgument {
  if (argument.kind === 'namedArgument') {
    const named = argument as NamedArgument
    return {
      name: named.name.value,
      value: mapValue(named.expression, filePath),
    }
  }

  return { value: mapValue(argument, filePath) }
}

function mapValue(value: SchemaExpression, filePath: string): SchemaValue {
  switch (value.kind) {
    case 'literal':
      return { kind: 'literal', value: (value as ScalarLiteral).value }
    case 'path':
      return { kind: 'path', value: [...value.value] }
    case 'array':
      return {
        kind: 'array',
        items: (value as ArrayExpression).items.map((item) => mapValue(item, filePath)),
      }
    case 'functionCall': {
      const call = value as FunctionCall
      return {
        kind: 'functionCall',
        path: [...call.path.value],
        args: (call.args ?? []).map((argument) => mapArgument(argument, filePath)),
      }
    }
  }
}

function mapAttribute(
  attribute: FieldAttribute | BlockAttribute,
  filePath: string,
): SchemaAttribute {
  return {
    path: [...attribute.path.value],
    args: (attribute.args ?? []).map((argument) => mapArgument(argument, filePath)),
    source: sourceReference(filePath, attribute.location),
  }
}

function mapType(type: PrismaType): SchemaTypeRef {
  if (type.kind === 'optional' || type.kind === 'list' || type.kind === 'required') {
    return mapBaseType(type.type, type.kind)
  }

  return mapBaseType(type, 'plain')
}

function mapBaseType(
  base: BaseType,
  modifier: SchemaTypeRef['modifier'],
): SchemaTypeRef {
  if (base.kind === 'unsupported') {
    return {
      name: String(base.type.value),
      modifier,
      unsupported: true,
    }
  }

  return {
    name: base.name.value,
    modifier,
    unsupported: false,
  }
}

function mapField(
  field: FieldDeclaration,
  filePath: string,
  declarationId: string,
  leadingComments?: readonly SchemaComment[],
): SchemaField {
  return {
    kind: 'field',
    id: createMemberId(declarationId, 'field', field.name.value, field.location),
    name: field.name.value,
    type: mapType(field.type),
    attributes: (field.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    leadingComments,
    trailingComment: field.comment ? mapComment(field.comment, filePath) : undefined,
    source: sourceReference(filePath, field.location),
  }
}

function mapBlockAttribute(
  attribute: BlockAttribute,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): BlockAttributeMember {
  return {
    kind: 'blockAttribute',
    attribute: mapAttribute(attribute, filePath),
    leadingComments,
    trailingComment: attribute.comment
      ? mapComment(attribute.comment, filePath)
      : undefined,
    source: sourceReference(filePath, attribute.location),
  }
}

function mapModel(
  declaration: ParserModelDeclaration,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): ModelDeclaration {
  const declarationId = createId(
    filePath,
    declaration.kind,
    declaration.name.value,
    declaration.location,
  )
  const members = mapCommentableSequence(
    declaration.members,
    filePath,
    (member, memberLeadingComments): Exclude<ModelMember, CommentMember> => {
      if (member.kind === 'field') {
        return mapField(member, filePath, declarationId, memberLeadingComments)
      }
      return mapBlockAttribute(member, filePath, memberLeadingComments)
    },
  )

  return {
    kind: declaration.kind,
    id: declarationId,
    name: declaration.name.value,
    members,
    leadingComments,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapEnumValue(
  value: EnumValue,
  filePath: string,
  declarationId: string,
  leadingComments?: readonly SchemaComment[],
): EnumValueMember {
  return {
    kind: 'enumValue',
    id: createMemberId(declarationId, 'enumValue', value.name.value, value.location),
    name: value.name.value,
    attributes: (value.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    leadingComments,
    trailingComment: value.comment ? mapComment(value.comment, filePath) : undefined,
    source: sourceReference(filePath, value.location),
  }
}

function mapEnum(
  declaration: ParserEnumDeclaration,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): EnumDeclaration {
  const declarationId = createId(
    filePath,
    'enum',
    declaration.name.value,
    declaration.location,
  )
  const members = mapCommentableSequence(
    declaration.members,
    filePath,
    (member, memberLeadingComments): Exclude<EnumMember, CommentMember> => {
      if (member.kind === 'enumValue') {
        return mapEnumValue(member, filePath, declarationId, memberLeadingComments)
      }
      return mapBlockAttribute(member, filePath, memberLeadingComments)
    },
  )

  return {
    kind: 'enum',
    id: declarationId,
    name: declaration.name.value,
    members,
    leadingComments,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapConfigEntry(
  entry: Config,
  filePath: string,
  declarationId: string,
  leadingComments?: readonly SchemaComment[],
): ConfigEntryMember {
  return {
    kind: 'config',
    id: createMemberId(declarationId, 'config', entry.name.value, entry.location),
    name: entry.name.value,
    value: mapValue(entry.value, filePath),
    leadingComments,
    trailingComment: entry.comment ? mapComment(entry.comment, filePath) : undefined,
    source: sourceReference(filePath, entry.location),
  }
}

function mapConfig(
  declaration: ConfigBlock,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): ConfigDeclaration {
  const declarationId = createId(
    filePath,
    declaration.kind,
    declaration.name.value,
    declaration.location,
  )
  return {
    kind: declaration.kind,
    id: declarationId,
    name: declaration.name.value,
    members: mapCommentableSequence(
      declaration.members,
      filePath,
      (member, memberLeadingComments) =>
        mapConfigEntry(member, filePath, declarationId, memberLeadingComments),
    ),
    leadingComments,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapTypeAlias(
  declaration: TypeAlias,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): TypeAliasDeclaration {
  return {
    kind: 'typeAlias',
    id: createId(filePath, 'typeAlias', declaration.name.value, declaration.location),
    name: declaration.name.value,
    type: mapType(declaration.type),
    attributes: (declaration.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    leadingComments,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapDeclaration(
  declaration: Exclude<ParserSchemaDeclaration, CommentBlock>,
  filePath: string,
  leadingComments?: readonly SchemaComment[],
): Exclude<SchemaDeclaration, CommentMember> {
  switch (declaration.kind) {
    case 'model':
    case 'view':
    case 'type':
      return mapModel(declaration, filePath, leadingComments)
    case 'enum':
      return mapEnum(declaration, filePath, leadingComments)
    case 'datasource':
    case 'generator':
      return mapConfig(declaration, filePath, leadingComments)
    case 'typeAlias':
      return mapTypeAlias(declaration, filePath, leadingComments)
  }
}

function withTrailingComment(
  declaration: Exclude<SchemaDeclaration, CommentMember>,
  trailingComment: SchemaComment,
): Exclude<SchemaDeclaration, CommentMember> {
  return { ...declaration, trailingComment }
}

interface ParserSyntaxError extends Error {
  readonly location?: ParserSourceRange
}

function toSyntaxDiagnostic(error: unknown, file: VirtualSchemaFile): SchemaDiagnostic {
  const parserError = error as Partial<ParserSyntaxError>
  return {
    severity: 'error',
    code: 'syntax-error',
    message: parserError.message ?? 'Prisma Schema 语法解析失败。',
    filePath: file.path,
    range: mapRange(parserError.location),
  }
}

export class LoancrateSchemaParser implements SchemaParserPort {
  parseFile(file: VirtualSchemaFile): ParseFileResult {
    try {
      const ast = parsePrismaSchema(file.content)
      const declarations = mapCommentableSequence(
        ast.declarations,
        file.path,
        (declaration, leadingComments) =>
          mapDeclaration(declaration, file.path, leadingComments),
        withTrailingComment,
      )
      return {
        ok: true,
        value: {
          file,
          declarations,
          canonicalContent: formatSchemaDocument(declarations),
        },
      }
    } catch (error) {
      return { ok: false, diagnostics: [toSyntaxDiagnostic(error, file)] }
    }
  }
}
