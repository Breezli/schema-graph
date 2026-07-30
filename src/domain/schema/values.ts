import type { SchemaArgument, SchemaAttribute, SchemaValue } from './types'

export function getAttributeName(attribute: SchemaAttribute): string {
  return attribute.path.join('.')
}

export function findAttribute(
  attributes: readonly SchemaAttribute[],
  name: string,
): SchemaAttribute | undefined {
  return attributes.find((attribute) => getAttributeName(attribute) === name)
}

export function getNamedArgument(
  attribute: SchemaAttribute,
  name: string,
): SchemaArgument | undefined {
  return attribute.args.find((argument) => argument.name === name)
}

export function getPositionalArgument(
  attribute: SchemaAttribute,
  index: number,
): SchemaArgument | undefined {
  return attribute.args.filter((argument) => !argument.name)[index]
}

export function valueAsString(value: SchemaValue | undefined): string | undefined {
  if (!value) return undefined
  if (value.kind === 'literal' && typeof value.value === 'string') return value.value
  if (value.kind === 'path') return value.value.join('.')
  return undefined
}

export function valueAsPathList(value: SchemaValue | undefined): readonly string[] {
  if (!value) return []
  if (value.kind === 'path') return [value.value.join('.')]
  if (value.kind !== 'array') return []

  return value.items.flatMap((item) => {
    if (item.kind === 'path') return [item.value.join('.')]
    if (item.kind === 'literal' && typeof item.value === 'string') return [item.value]
    return []
  })
}
