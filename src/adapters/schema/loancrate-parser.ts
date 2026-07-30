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

function mapCommentBlock(block: CommentBlock, filePath: string): CommentMember {
  return {
    kind: 'commentBlock',
    comments: block.comments.map((comment) => mapComment(comment, filePath)),
  }
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
): SchemaField {
  return {
    kind: 'field',
    id: createMemberId(declarationId, 'field', field.name.value, field.location),
    name: field.name.value,
    type: mapType(field.type),
    attributes: (field.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    trailingComment: field.comment ? mapComment(field.comment, filePath) : undefined,
    source: sourceReference(filePath, field.location),
  }
}

function mapBlockAttribute(
  attribute: BlockAttribute,
  filePath: string,
): BlockAttributeMember {
  return {
    kind: 'blockAttribute',
    attribute: mapAttribute(attribute, filePath),
    trailingComment: attribute.comment
      ? mapComment(attribute.comment, filePath)
      : undefined,
    source: sourceReference(filePath, attribute.location),
  }
}

function mapModel(
  declaration: ParserModelDeclaration,
  filePath: string,
): ModelDeclaration {
  const declarationId = createId(
    filePath,
    declaration.kind,
    declaration.name.value,
    declaration.location,
  )
  const members: ModelMember[] = declaration.members.map((member) => {
    if (member.kind === 'field') return mapField(member, filePath, declarationId)
    if (member.kind === 'blockAttribute') return mapBlockAttribute(member, filePath)
    return mapCommentBlock(member, filePath)
  })

  return {
    kind: declaration.kind,
    id: declarationId,
    name: declaration.name.value,
    members,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapEnumValue(
  value: EnumValue,
  filePath: string,
  declarationId: string,
): EnumValueMember {
  return {
    kind: 'enumValue',
    id: createMemberId(declarationId, 'enumValue', value.name.value, value.location),
    name: value.name.value,
    attributes: (value.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    trailingComment: value.comment ? mapComment(value.comment, filePath) : undefined,
    source: sourceReference(filePath, value.location),
  }
}

function mapEnum(
  declaration: ParserEnumDeclaration,
  filePath: string,
): EnumDeclaration {
  const declarationId = createId(
    filePath,
    'enum',
    declaration.name.value,
    declaration.location,
  )
  const members: EnumMember[] = declaration.members.map((member) => {
    if (member.kind === 'enumValue')
      return mapEnumValue(member, filePath, declarationId)
    if (member.kind === 'blockAttribute') return mapBlockAttribute(member, filePath)
    return mapCommentBlock(member, filePath)
  })

  return {
    kind: 'enum',
    id: declarationId,
    name: declaration.name.value,
    members,
    source: sourceReference(filePath, declaration.location),
  }
}

function mapConfigEntry(
  entry: Config,
  filePath: string,
  declarationId: string,
): ConfigEntryMember {
  return {
    kind: 'config',
    id: createMemberId(declarationId, 'config', entry.name.value, entry.location),
    name: entry.name.value,
    value: mapValue(entry.value, filePath),
    trailingComment: entry.comment ? mapComment(entry.comment, filePath) : undefined,
    source: sourceReference(filePath, entry.location),
  }
}

function mapConfig(declaration: ConfigBlock, filePath: string): ConfigDeclaration {
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
    members: declaration.members.map((member) =>
      member.kind === 'config'
        ? mapConfigEntry(member, filePath, declarationId)
        : mapCommentBlock(member, filePath),
    ),
    source: sourceReference(filePath, declaration.location),
  }
}

function mapTypeAlias(declaration: TypeAlias, filePath: string): TypeAliasDeclaration {
  return {
    kind: 'typeAlias',
    id: createId(filePath, 'typeAlias', declaration.name.value, declaration.location),
    name: declaration.name.value,
    type: mapType(declaration.type),
    attributes: (declaration.attributes ?? []).map((attribute) =>
      mapAttribute(attribute, filePath),
    ),
    source: sourceReference(filePath, declaration.location),
  }
}

function mapDeclaration(
  declaration: ParserSchemaDeclaration,
  filePath: string,
): SchemaDeclaration {
  switch (declaration.kind) {
    case 'model':
    case 'view':
    case 'type':
      return mapModel(declaration, filePath)
    case 'enum':
      return mapEnum(declaration, filePath)
    case 'datasource':
    case 'generator':
      return mapConfig(declaration, filePath)
    case 'typeAlias':
      return mapTypeAlias(declaration, filePath)
    case 'commentBlock':
      return mapCommentBlock(declaration, filePath)
  }
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
      const declarations = ast.declarations.map((declaration) =>
        mapDeclaration(declaration, file.path),
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
