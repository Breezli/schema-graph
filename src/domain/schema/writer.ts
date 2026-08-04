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

function withLeadingComments(
  value: string,
  comments?: readonly SchemaComment[],
  indent = '',
): string {
  if (!comments?.length) return value
  const leading = comments
    .map((comment) => `${indent}${formatComment(comment)}`)
    .join('\n')
  return `${leading}\n${value}`
}

function joinMembers(
  members: readonly { readonly standalone: boolean; readonly value: string }[],
): string {
  return members.reduce((content, member, index) => {
    if (index === 0) return member.value
    const previous = members[index - 1]
    const separator = previous?.standalone || member.standalone ? '\n\n' : '\n'
    return `${content}${separator}${member.value}`
  }, '')
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
  return withLeadingComments(
    withTrailingComment(
      `  ${field.name} ${formatSchemaType(field.type)}${suffix}`,
      field.trailingComment,
    ),
    field.leadingComments,
    '  ',
  )
}

function formatBlockAttribute(member: BlockAttributeMember): string {
  return withLeadingComments(
    withTrailingComment(
      `  ${formatSchemaAttribute(member.attribute, true)}`,
      member.trailingComment,
    ),
    member.leadingComments,
    '  ',
  )
}

function formatModel(declaration: ModelDeclaration): string {
  const members = declaration.members.map((member) => {
    if (member.kind === 'field') {
      return { standalone: false, value: formatField(member) }
    }
    if (member.kind === 'blockAttribute') {
      return { standalone: false, value: formatBlockAttribute(member) }
    }
    return { standalone: true, value: formatCommentBlock(member, '  ') }
  })
  return withTrailingComment(
    withLeadingComments(
      `${declaration.kind} ${declaration.name} {\n${joinMembers(members)}\n}`,
      declaration.leadingComments,
    ),
    declaration.trailingComment,
  )
}

function formatEnumValue(member: EnumValueMember): string {
  const attributes = member.attributes.map((attribute) =>
    formatSchemaAttribute(attribute),
  )
  const suffix = attributes.length ? ` ${attributes.join(' ')}` : ''
  return withLeadingComments(
    withTrailingComment(`  ${member.name}${suffix}`, member.trailingComment),
    member.leadingComments,
    '  ',
  )
}

function formatEnum(declaration: EnumDeclaration): string {
  const members = declaration.members.map((member) => {
    if (member.kind === 'enumValue') {
      return { standalone: false, value: formatEnumValue(member) }
    }
    if (member.kind === 'blockAttribute') {
      return { standalone: false, value: formatBlockAttribute(member) }
    }
    return { standalone: true, value: formatCommentBlock(member, '  ') }
  })
  return withTrailingComment(
    withLeadingComments(
      `enum ${declaration.name} {\n${joinMembers(members)}\n}`,
      declaration.leadingComments,
    ),
    declaration.trailingComment,
  )
}

function formatConfigEntry(member: ConfigEntryMember): string {
  return withLeadingComments(
    withTrailingComment(
      `  ${member.name} = ${formatSchemaValue(member.value)}`,
      member.trailingComment,
    ),
    member.leadingComments,
    '  ',
  )
}

function formatConfig(declaration: ConfigDeclaration): string {
  const members = declaration.members.map((member) =>
    member.kind === 'config'
      ? { standalone: false, value: formatConfigEntry(member) }
      : { standalone: true, value: formatCommentBlock(member, '  ') },
  )
  return withTrailingComment(
    withLeadingComments(
      `${declaration.kind} ${declaration.name} {\n${joinMembers(members)}\n}`,
      declaration.leadingComments,
    ),
    declaration.trailingComment,
  )
}

function formatTypeAlias(declaration: TypeAliasDeclaration): string {
  const attributes = declaration.attributes.map((attribute) =>
    formatSchemaAttribute(attribute),
  )
  const suffix = attributes.length ? ` ${attributes.join(' ')}` : ''
  return withTrailingComment(
    withLeadingComments(
      `type ${declaration.name} = ${formatSchemaType(declaration.type)}${suffix}`,
      declaration.leadingComments,
    ),
    declaration.trailingComment,
  )
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
