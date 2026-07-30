import type {
  ModelDeclaration,
  RelationCardinality,
  SchemaDeclaration,
  SchemaDiagnostic,
  SchemaField,
  SchemaGraphSnapshot,
  SchemaLogicalRelation,
  SchemaRelation,
  SchemaSymbol,
} from './types'
import {
  findAttribute,
  getNamedArgument,
  getPositionalArgument,
  valueAsPathList,
  valueAsString,
} from './values'

const BUILTIN_SCALARS = new Set([
  'BigInt',
  'Boolean',
  'Bytes',
  'DateTime',
  'Decimal',
  'Float',
  'Int',
  'Json',
  'String',
])

interface AnalysisResult {
  readonly graph: SchemaGraphSnapshot
  readonly diagnostics: readonly SchemaDiagnostic[]
}

function isNamedDeclaration(
  declaration: SchemaDeclaration,
): declaration is Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }> {
  return declaration.kind !== 'commentBlock'
}

function isModelLike(declaration: SchemaDeclaration): declaration is ModelDeclaration {
  return (
    declaration.kind === 'model' ||
    declaration.kind === 'view' ||
    declaration.kind === 'type'
  )
}

function buildSymbols(
  declarations: readonly SchemaDeclaration[],
): Readonly<Record<string, readonly SchemaSymbol[]>> {
  const symbols: Record<string, SchemaSymbol[]> = {}

  for (const declaration of declarations) {
    if (!isNamedDeclaration(declaration)) continue
    if (declaration.kind === 'datasource' || declaration.kind === 'generator') continue

    const symbol: SchemaSymbol = {
      name: declaration.name,
      kind: declaration.kind,
      declarationId: declaration.id,
      filePath: declaration.source.filePath,
    }
    ;(symbols[declaration.name] ??= []).push(symbol)
  }

  return symbols
}

function duplicateSymbolDiagnostics(
  declarations: readonly SchemaDeclaration[],
  symbols: Readonly<Record<string, readonly SchemaSymbol[]>>,
): readonly SchemaDiagnostic[] {
  const declarationById = new Map(
    declarations
      .filter(isNamedDeclaration)
      .map((declaration) => [declaration.id, declaration] as const),
  )
  const diagnostics: SchemaDiagnostic[] = []

  for (const [name, matches] of Object.entries(symbols)) {
    if (matches.length < 2) continue
    for (const match of matches) {
      const declaration = declarationById.get(match.declarationId)
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-symbol',
        message: `全局 Schema 中存在重复声明“${name}”。`,
        filePath: match.filePath,
        range: declaration?.source.range,
      })
    }
  }

  return diagnostics
}

function duplicateFieldDiagnostics(
  models: readonly ModelDeclaration[],
): readonly SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = []

  for (const model of models) {
    const fields = model.members.filter((member) => member.kind === 'field')
    const seen = new Map<string, SchemaField>()
    for (const field of fields) {
      const previous = seen.get(field.name)
      if (previous) {
        diagnostics.push({
          severity: 'error',
          code: 'duplicate-field',
          message: `“${model.name}”中存在重复字段“${field.name}”。`,
          filePath: field.source.filePath,
          range: field.source.range,
        })
      } else {
        seen.set(field.name, field)
      }
    }
  }

  return diagnostics
}

function unknownTypeDiagnostics(
  models: readonly ModelDeclaration[],
  symbols: Readonly<Record<string, readonly SchemaSymbol[]>>,
): readonly SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = []

  for (const model of models) {
    for (const member of model.members) {
      if (member.kind !== 'field' || member.type.unsupported) continue
      if (BUILTIN_SCALARS.has(member.type.name) || symbols[member.type.name]) continue

      diagnostics.push({
        severity: 'error',
        code: 'unknown-field-type',
        message: `字段“${model.name}.${member.name}”引用了未知类型“${member.type.name}”。`,
        filePath: member.source.filePath,
        range: member.source.range,
      })
    }
  }

  return diagnostics
}

function resolveRelations(models: readonly ModelDeclaration[]): {
  readonly relations: readonly SchemaRelation[]
  readonly diagnostics: readonly SchemaDiagnostic[]
} {
  const relationTargets = new Map(
    models
      .filter((model) => model.kind === 'model' || model.kind === 'view')
      .map((model) => [model.name, model] as const),
  )
  const relations: SchemaRelation[] = []
  const diagnostics: SchemaDiagnostic[] = []

  for (const sourceModel of models) {
    const sourceFields = sourceModel.members.filter((member) => member.kind === 'field')
    const sourceFieldNames = new Set(sourceFields.map((field) => field.name))

    for (const sourceField of sourceFields) {
      const targetModel = relationTargets.get(sourceField.type.name)
      if (!targetModel) continue

      const relationAttribute = findAttribute(sourceField.attributes, 'relation')
      const targetFieldNames = new Set(
        targetModel.members
          .filter((member) => member.kind === 'field')
          .map((field) => field.name),
      )
      const fields = valueAsPathList(
        getNamedArgument(relationAttribute ?? { path: [], args: [] }, 'fields')?.value,
      )
      const references = valueAsPathList(
        getNamedArgument(relationAttribute ?? { path: [], args: [] }, 'references')
          ?.value,
      )
      const name = relationAttribute
        ? (valueAsString(getPositionalArgument(relationAttribute, 0)?.value) ??
          valueAsString(getNamedArgument(relationAttribute, 'name')?.value))
        : undefined

      for (const fieldName of fields) {
        if (!sourceFieldNames.has(fieldName)) {
          diagnostics.push({
            severity: 'error',
            code: 'unknown-relation-field',
            message: `关系“${sourceModel.name}.${sourceField.name}”引用了不存在的本地字段“${fieldName}”。`,
            filePath: sourceField.source.filePath,
            range: sourceField.source.range,
          })
        }
      }

      for (const fieldName of references) {
        if (!targetFieldNames.has(fieldName)) {
          diagnostics.push({
            severity: 'error',
            code: 'unknown-relation-reference',
            message: `关系“${sourceModel.name}.${sourceField.name}”引用了“${targetModel.name}”中不存在的字段“${fieldName}”。`,
            filePath: sourceField.source.filePath,
            range: sourceField.source.range,
          })
        }
      }

      relations.push({
        id: `relation:${sourceField.id}:${targetModel.id}:${name ?? ''}`,
        name,
        sourceModelId: sourceModel.id,
        sourceModelName: sourceModel.name,
        sourceFieldId: sourceField.id,
        sourceFieldName: sourceField.name,
        targetModelId: targetModel.id,
        targetModelName: targetModel.name,
        sourceCardinality:
          sourceField.type.modifier === 'list'
            ? 'many'
            : sourceField.type.modifier === 'optional'
              ? 'optional'
              : 'one',
        fields,
        references,
        onDelete: relationAttribute
          ? valueAsString(getNamedArgument(relationAttribute, 'onDelete')?.value)
          : undefined,
        onUpdate: relationAttribute
          ? valueAsString(getNamedArgument(relationAttribute, 'onUpdate')?.value)
          : undefined,
        map: relationAttribute
          ? valueAsString(getNamedArgument(relationAttribute, 'map')?.value)
          : undefined,
        source: sourceField.source,
      })
    }
  }

  return { relations, diagnostics }
}

function relationCardinality(
  cardinality: SchemaRelation['sourceCardinality'],
): RelationCardinality {
  if (cardinality === 'optional') return 'zero-one'
  return cardinality
}

function isUniqueFieldSet(
  model: ModelDeclaration,
  fieldNames: readonly string[],
): boolean {
  if (!fieldNames.length) return false
  if (fieldNames.length === 1) {
    const field = model.members.find(
      (member): member is SchemaField =>
        member.kind === 'field' && member.name === fieldNames[0],
    )
    if (
      field?.attributes.some((attribute) => {
        const name = attribute.path.join('.')
        return name === 'id' || name === 'unique'
      })
    ) {
      return true
    }
  }

  return model.members.some((member) => {
    if (member.kind !== 'blockAttribute') return false
    const name = member.attribute.path.join('.')
    if (name !== 'id' && name !== 'unique') return false
    const fields = valueAsPathList(member.attribute.args[0]?.value)
    return (
      fields.length === fieldNames.length &&
      fields.every((fieldName) => fieldNames.includes(fieldName))
    )
  })
}

function buildLogicalRelations(
  models: readonly ModelDeclaration[],
  relations: readonly SchemaRelation[],
): readonly SchemaLogicalRelation[] {
  const modelById = new Map(models.map((model) => [model.id, model] as const))
  const fieldById = new Map(
    models.flatMap((model) =>
      model.members
        .filter((member): member is SchemaField => member.kind === 'field')
        .map((field) => [field.id, field] as const),
    ),
  )
  const groups = new Map<string, SchemaRelation[]>()

  for (const relation of relations) {
    const pair = [relation.sourceModelId, relation.targetModelId].sort().join('::')
    const key = `${pair}::${relation.name ?? '__default__'}`
    const entries = groups.get(key) ?? []
    entries.push(relation)
    groups.set(key, entries)
  }

  return [...groups.entries()].map(([groupKey, members]) => {
    const foreignKeyRelation = members.find((member) => member.fields.length > 0)
    const first = foreignKeyRelation ?? members[0]
    if (!first) throw new Error(`Empty logical relation group: ${groupKey}`)
    const inverse = members.find(
      (member) =>
        member.id !== first.id &&
        member.sourceModelId === first.targetModelId &&
        member.targetModelId === first.sourceModelId,
    )
    const sourceModel = modelById.get(first.sourceModelId)
    const targetModel = modelById.get(first.targetModelId)
    if (!sourceModel || !targetModel) {
      throw new Error(`Missing relation model for ${groupKey}`)
    }

    const selfRelation = sourceModel.id === targetModel.id
    const sourceRelations = selfRelation
      ? [first]
      : members.filter((member) => member.sourceModelId === sourceModel.id)
    const targetRelations = selfRelation
      ? members.filter((member) => member.id !== first.id)
      : members.filter((member) => member.sourceModelId === targetModel.id)
    const foreignKeyFields = foreignKeyRelation
      ? foreignKeyRelation.fields
          .map((name) =>
            sourceModel.members.find(
              (member): member is SchemaField =>
                member.kind === 'field' && member.name === name,
            ),
          )
          .filter((field): field is SchemaField => Boolean(field))
      : []
    const sourceFields = [
      ...sourceRelations.map((relation) => fieldById.get(relation.sourceFieldId)),
      ...foreignKeyFields,
    ].filter((field): field is SchemaField => Boolean(field))
    const targetFields = targetRelations
      .map((relation) => fieldById.get(relation.sourceFieldId))
      .filter((field): field is SchemaField => Boolean(field))

    return {
      id: `logical:${groupKey}`,
      name: first.name,
      source: {
        modelId: sourceModel.id,
        modelName: sourceModel.name,
        fieldIds: sourceFields.map((field) => field.id),
        fieldNames: sourceFields.map((field) => field.name),
        cardinality: inverse
          ? relationCardinality(inverse.sourceCardinality)
          : foreignKeyRelation &&
              isUniqueFieldSet(sourceModel, foreignKeyRelation.fields)
            ? 'zero-one'
            : 'many',
        sources: sourceFields.map((field) => field.source),
      },
      target: {
        modelId: targetModel.id,
        modelName: targetModel.name,
        fieldIds: targetFields.map((field) => field.id),
        fieldNames: targetFields.map((field) => field.name),
        cardinality: relationCardinality(first.sourceCardinality),
        sources: targetFields.map((field) => field.source),
      },
      memberRelationIds: members.map((member) => member.id),
      foreignKey: foreignKeyRelation
        ? {
            sourceModelId: foreignKeyRelation.sourceModelId,
            targetModelId: foreignKeyRelation.targetModelId,
            relationFieldId: foreignKeyRelation.sourceFieldId,
            fieldNames: foreignKeyRelation.fields,
            referenceNames: foreignKeyRelation.references,
          }
        : undefined,
    }
  })
}

export function analyzeSchemaDeclarations(
  revision: number,
  declarations: readonly SchemaDeclaration[],
): AnalysisResult {
  const symbols = buildSymbols(declarations)
  const models = declarations.filter(isModelLike)
  const relationResult = resolveRelations(models)
  const logicalRelations = buildLogicalRelations(models, relationResult.relations)
  const diagnostics = [
    ...duplicateSymbolDiagnostics(declarations, symbols),
    ...duplicateFieldDiagnostics(models),
    ...unknownTypeDiagnostics(models, symbols),
    ...relationResult.diagnostics,
  ]

  return {
    graph: {
      revision,
      declarations,
      symbols,
      relations: relationResult.relations,
      logicalRelations,
    },
    diagnostics,
  }
}
