import type {
  BlockAttributeMember,
  CommentMember,
  ConfigDeclaration,
  ConfigEntryMember,
  EnumDeclaration,
  EnumValueMember,
  ModelDeclaration,
  SchemaArgument,
  SchemaAttribute,
  SchemaComment,
  SchemaDeclaration,
  SchemaField,
  SchemaTypeRef,
  SchemaValue,
  TypeAliasDeclaration,
} from './types'

function formatComment(comment: SchemaComment): string {
  return `${comment.kind === 'docComment' ? '///' : '//'} ${comment.text}`
}

function formatCommentBlock(member: CommentMember, indent = ''): string {
  return member.comments
    .map((comment) => `${indent}${formatComment(comment)}`)
    .join('\n')
}

export function formatSchemaValue(value: SchemaValue): string {
  switch (value.kind) {
    case 'literal':
      return typeof value.value === 'string'
        ? JSON.stringify(value.value)
        : String(value.value)
    case 'path':
      return value.value.join('.')
    case 'array':
      return `[${value.items.map(formatSchemaValue).join(', ')}]`
    case 'functionCall':
      return `${value.path.join('.')}(${value.args.map(formatSchemaArgument).join(', ')})`
  }
}

function formatSchemaArgument(argument: SchemaArgument): string {
  const value = formatSchemaValue(argument.value)
  return argument.name ? `${argument.name}: ${value}` : value
}

export function formatSchemaAttribute(
  attribute: SchemaAttribute,
  block = false,
): string {
  const args = attribute.args.length
    ? `(${attribute.args.map(formatSchemaArgument).join(', ')})`
    : ''
  return `${block ? '@@' : '@'}${attribute.path.join('.')}${args}`
}

export function formatSchemaType(type: SchemaTypeRef): string {
  const base = type.unsupported
    ? `Unsupported(${JSON.stringify(type.name)})`
    : type.name
  if (type.modifier === 'list') return `${base}[]`
  if (type.modifier === 'optional') return `${base}?`
  if (type.modifier === 'required') return `${base}!`
  return base
}

function withTrailingComment(value: string, comment?: SchemaComment): string {
  return comment ? `${value} ${formatComment(comment)}` : value
}

function formatField(field: SchemaField): string {
  const attributes = field.attributes.map((attribute) =>
    formatSchemaAttribute(attribute),
  )
  const suffix = attributes.length ? ` ${attributes.join(' ')}` : ''
  return withTrailingComment(
    `  ${field.name} ${formatSchemaType(field.type)}${suffix}`,
    field.trailingComment,
  )
}

function formatBlockAttribute(member: BlockAttributeMember): string {
  return withTrailingComment(
    `  ${formatSchemaAttribute(member.attribute, true)}`,
    member.trailingComment,
  )
}

function formatModel(declaration: ModelDeclaration): string {
  const members = declaration.members.map((member) => {
    if (member.kind === 'field') return formatField(member)
    if (member.kind === 'blockAttribute') return formatBlockAttribute(member)
    return formatCommentBlock(member, '  ')
  })
  return `${declaration.kind} ${declaration.name} {\n${members.join('\n')}\n}`
}

function formatEnumValue(member: EnumValueMember): string {
  const attributes = member.attributes.map((attribute) =>
    formatSchemaAttribute(attribute),
  )
  const suffix = attributes.length ? ` ${attributes.join(' ')}` : ''
  return withTrailingComment(`  ${member.name}${suffix}`, member.trailingComment)
}

function formatEnum(declaration: EnumDeclaration): string {
  const members = declaration.members.map((member) => {
    if (member.kind === 'enumValue') return formatEnumValue(member)
    if (member.kind === 'blockAttribute') return formatBlockAttribute(member)
    return formatCommentBlock(member, '  ')
  })
  return `enum ${declaration.name} {\n${members.join('\n')}\n}`
}

function formatConfigEntry(member: ConfigEntryMember): string {
  return withTrailingComment(
    `  ${member.name} = ${formatSchemaValue(member.value)}`,
    member.trailingComment,
  )
}

function formatConfig(declaration: ConfigDeclaration): string {
  const members = declaration.members.map((member) =>
    member.kind === 'config'
      ? formatConfigEntry(member)
      : formatCommentBlock(member, '  '),
  )
  return `${declaration.kind} ${declaration.name} {\n${members.join('\n')}\n}`
}

function formatTypeAlias(declaration: TypeAliasDeclaration): string {
  const attributes = declaration.attributes.map((attribute) =>
    formatSchemaAttribute(attribute),
  )
  const suffix = attributes.length ? ` ${attributes.join(' ')}` : ''
  return `type ${declaration.name} = ${formatSchemaType(declaration.type)}${suffix}`
}

export function formatSchemaDeclaration(declaration: SchemaDeclaration): string {
  switch (declaration.kind) {
    case 'model':
    case 'view':
    case 'type':
      return formatModel(declaration)
    case 'enum':
      return formatEnum(declaration)
    case 'datasource':
    case 'generator':
      return formatConfig(declaration)
    case 'typeAlias':
      return formatTypeAlias(declaration)
    case 'commentBlock':
      return formatCommentBlock(declaration)
  }
}

export function formatSchemaDocument(
  declarations: readonly SchemaDeclaration[],
): string {
  const content = declarations.map(formatSchemaDeclaration).join('\n\n')
  return content ? `${content}\n` : ''
}
