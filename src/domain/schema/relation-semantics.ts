import type {
  ModelDeclaration,
  SchemaField,
  SchemaForeignKeySemantics,
  SchemaGraphSnapshot,
  SchemaLogicalRelation,
} from './types'

export type SchemaRelationResolutionGraph = Pick<
  SchemaGraphSnapshot,
  'declarations' | 'relations' | 'logicalRelations'
>

function isModelDeclaration(value: unknown): value is ModelDeclaration {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  const kind = value.kind
  return kind === 'model' || kind === 'view' || kind === 'type'
}

export function deriveForeignKeySemantics(
  relation: SchemaLogicalRelation,
): SchemaForeignKeySemantics | undefined {
  const foreignKey = relation.foreignKey
  if (
    !foreignKey ||
    foreignKey.fieldNames.length === 0 ||
    foreignKey.referenceNames.length === 0 ||
    foreignKey.fieldNames.length !== foreignKey.referenceNames.length
  ) {
    return undefined
  }

  return {
    childModelId: foreignKey.sourceModelId,
    parentModelId: foreignKey.targetModelId,
    childRelationFieldId: foreignKey.relationFieldId,
    childFieldNames: foreignKey.fieldNames,
    parentReferenceNames: foreignKey.referenceNames,
  }
}

/**
 * Resolves only the selectable parent-side list inverse of an explicit,
 * unambiguous foreign-key relation. All other field/relation shapes are
 * intentionally declined for Phase C selection behavior.
 */
export function resolveParentListLogicalRelation(
  graph: SchemaRelationResolutionGraph,
  modelId: string,
  fieldId: string,
): SchemaLogicalRelation | undefined {
  const clickedModel = graph.declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModelDeclaration(declaration) && declaration.id === modelId,
  )
  const clickedField = clickedModel?.members.find(
    (member): member is SchemaField => member.kind === 'field' && member.id === fieldId,
  )
  if (!clickedModel || !clickedField || clickedField.type.modifier !== 'list') {
    return undefined
  }

  const matches = graph.logicalRelations.filter((logicalRelation) => {
    const semantics = deriveForeignKeySemantics(logicalRelation)
    if (!semantics || semantics.parentModelId !== clickedModel.id) return false

    const childModel = graph.declarations.find(
      (declaration): declaration is ModelDeclaration =>
        isModelDeclaration(declaration) && declaration.id === semantics.childModelId,
    )
    if (!childModel || clickedField.type.name !== childModel.name) return false

    const memberRelations = graph.relations.filter((relation) =>
      logicalRelation.memberRelationIds.includes(relation.id),
    )
    const foreignKeyRelations = memberRelations.filter(
      (relation) =>
        relation.sourceModelId === semantics.childModelId &&
        relation.targetModelId === semantics.parentModelId &&
        relation.sourceFieldId === semantics.childRelationFieldId &&
        relation.fields.length > 0 &&
        relation.references.length > 0 &&
        relation.fields.length === relation.references.length &&
        relation.fields.length === semantics.childFieldNames.length &&
        relation.fields.every(
          (name, index) => name === semantics.childFieldNames[index],
        ) &&
        relation.references.every(
          (name, index) => name === semantics.parentReferenceNames[index],
        ),
    )
    if (foreignKeyRelations.length !== 1) return false

    const parentListInverses = memberRelations.filter(
      (relation) =>
        relation.sourceFieldId !== semantics.childRelationFieldId &&
        relation.sourceModelId === semantics.parentModelId &&
        relation.targetModelId === semantics.childModelId &&
        relation.sourceCardinality === 'many' &&
        relation.fields.length === 0 &&
        relation.references.length === 0,
    )

    return (
      parentListInverses.length === 1 &&
      parentListInverses[0]?.sourceFieldId === clickedField.id
    )
  })

  return matches.length === 1 ? matches[0] : undefined
}
