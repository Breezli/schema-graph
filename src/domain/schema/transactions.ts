import type {
  ModelDeclaration,
  ModelMember,
  SchemaArgument,
  SchemaAttribute,
  SchemaDeclaration,
  SchemaField,
  SchemaProjectSnapshot,
  SchemaTypeRef,
  VirtualSchemaFile,
} from './types'
import { findAttribute } from './values'
import { formatSchemaDocument } from './writer'

export type SchemaMutationResult =
  | {
      readonly ok: true
      readonly files: readonly VirtualSchemaFile[]
      readonly focusName?: string
    }
  | { readonly ok: false; readonly message: string }

let generatedId = 0

function nextId(kind: string): string {
  generatedId += 1
  return `generated:${kind}:${Date.now()}:${generatedId}`
}

function isModel(declaration: SchemaDeclaration): declaration is ModelDeclaration {
  return (
    declaration.kind === 'model' ||
    declaration.kind === 'view' ||
    declaration.kind === 'type'
  )
}

function declarationFilePath(
  declaration: SchemaDeclaration,
  fallbackPath: string,
): string {
  if (declaration.kind === 'commentBlock') {
    return declaration.comments[0]?.source?.filePath ?? fallbackPath
  }
  return declaration.source.filePath
}

function rewriteFiles(
  snapshot: SchemaProjectSnapshot,
  declarations: readonly SchemaDeclaration[],
): readonly VirtualSchemaFile[] {
  const fallbackPath = Object.keys(snapshot.files)[0] ?? 'schema.prisma'
  const declarationsByFile = new Map<string, SchemaDeclaration[]>()

  for (const declaration of declarations) {
    const path = declarationFilePath(declaration, fallbackPath)
    const entries = declarationsByFile.get(path) ?? []
    entries.push(declaration)
    declarationsByFile.set(path, entries)
  }

  return Object.values(snapshot.files).map((file) => ({
    ...file,
    content: formatSchemaDocument(declarationsByFile.get(file.path) ?? []),
  }))
}

function validateIdentifier(value: string, label: string): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return `${label}只能包含字母、数字和下划线，且不能以数字开头。`
  }
  return undefined
}

function createField(
  model: ModelDeclaration,
  name: string,
  type: SchemaTypeRef,
  attributes: readonly SchemaAttribute[] = [],
): SchemaField {
  return {
    kind: 'field',
    id: nextId('field'),
    name,
    type,
    attributes,
    source: { filePath: model.source.filePath },
  }
}

function stringArgument(value: string): SchemaArgument {
  return { value: { kind: 'literal', value } }
}

function namedArrayArgument(name: string, values: readonly string[]): SchemaArgument {
  return {
    name,
    value: {
      kind: 'array',
      items: values.map((value) => ({ kind: 'path' as const, value: [value] })),
    },
  }
}

function modelFieldNames(model: ModelDeclaration): Set<string> {
  return new Set(
    model.members
      .filter((member) => member.kind === 'field')
      .map((field) => field.name),
  )
}

function uniqueFieldName(model: ModelDeclaration, preferred: string): string {
  const names = modelFieldNames(model)
  if (!names.has(preferred)) return preferred
  let index = 2
  while (names.has(`${preferred}${index}`)) index += 1
  return `${preferred}${index}`
}

function lowerFirst(value: string): string {
  return value ? `${value[0]?.toLowerCase() ?? ''}${value.slice(1)}` : value
}

export function addModelToProject(
  snapshot: SchemaProjectSnapshot,
  filePath: string,
  name: string,
): SchemaMutationResult {
  const normalizedName = name.trim()
  const identifierError = validateIdentifier(normalizedName, '模型名称')
  if (identifierError) return { ok: false, message: identifierError }
  if (!snapshot.files[filePath])
    return { ok: false, message: '目标 Schema 文件不存在。' }
  if (snapshot.graph.symbols[normalizedName]) {
    return { ok: false, message: `Schema 中已经存在“${normalizedName}”。` }
  }

  const model: ModelDeclaration = {
    kind: 'model',
    id: nextId('model'),
    name: normalizedName,
    source: { filePath },
    members: [],
  }
  const idField = createField(
    model,
    'id',
    { name: 'Int', modifier: 'plain', unsupported: false },
    [
      { path: ['id'], args: [] },
      {
        path: ['default'],
        args: [
          {
            value: { kind: 'functionCall', path: ['autoincrement'], args: [] },
          },
        ],
      },
    ],
  )
  const created = { ...model, members: [idField] }
  const declarations = [...snapshot.graph.declarations, created]

  return {
    ok: true,
    files: rewriteFiles(snapshot, declarations),
    focusName: normalizedName,
  }
}

export function renameModelInProject(
  snapshot: SchemaProjectSnapshot,
  modelId: string,
  nextName: string,
): SchemaMutationResult {
  const normalizedName = nextName.trim()
  const identifierError = validateIdentifier(normalizedName, '模型名称')
  if (identifierError) return { ok: false, message: identifierError }
  const model = snapshot.graph.declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModel(declaration) && declaration.id === modelId,
  )
  if (!model) return { ok: false, message: '找不到要重命名的模型。' }
  if (model.name === normalizedName) {
    return { ok: true, files: Object.values(snapshot.files), focusName: normalizedName }
  }
  if (snapshot.graph.symbols[normalizedName]) {
    return { ok: false, message: `Schema 中已经存在“${normalizedName}”。` }
  }

  const declarations = snapshot.graph.declarations.map((declaration) => {
    if (!isModel(declaration)) return declaration
    const renamedMembers = declaration.members.map((member): ModelMember => {
      if (member.kind !== 'field' || member.type.name !== model.name) return member
      return { ...member, type: { ...member.type, name: normalizedName } }
    })
    return declaration.id === modelId
      ? { ...declaration, name: normalizedName, members: renamedMembers }
      : { ...declaration, members: renamedMembers }
  })

  return {
    ok: true,
    files: rewriteFiles(snapshot, declarations),
    focusName: normalizedName,
  }
}

export function addFieldToModel(
  snapshot: SchemaProjectSnapshot,
  modelId: string,
  name: string,
  typeName = 'String',
  modifier: SchemaTypeRef['modifier'] = 'plain',
): SchemaMutationResult {
  const normalizedName = name.trim()
  const identifierError = validateIdentifier(normalizedName, '字段名称')
  if (identifierError) return { ok: false, message: identifierError }
  const typeError = validateIdentifier(typeName.trim(), '字段类型')
  if (typeError) return { ok: false, message: typeError }

  let found = false
  const declarations = snapshot.graph.declarations.map((declaration) => {
    if (!isModel(declaration) || declaration.id !== modelId) return declaration
    found = true
    if (modelFieldNames(declaration).has(normalizedName)) return declaration
    return {
      ...declaration,
      members: [
        ...declaration.members,
        createField(declaration, normalizedName, {
          name: typeName.trim(),
          modifier,
          unsupported: false,
        }),
      ],
    }
  })
  if (!found) return { ok: false, message: '找不到目标模型。' }

  const updated = declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModel(declaration) && declaration.id === modelId,
  )
  if (!updated || !modelFieldNames(updated).has(normalizedName)) {
    return { ok: false, message: `字段“${normalizedName}”已经存在。` }
  }

  return { ok: true, files: rewriteFiles(snapshot, declarations) }
}

export interface UpdateFieldPatch {
  readonly name?: string
  readonly typeName?: string
  readonly modifier?: SchemaTypeRef['modifier']
}

function replaceValuePath(
  value: import('./types').SchemaValue,
  previous: string,
  next: string,
): import('./types').SchemaValue {
  if (value.kind === 'path') {
    return {
      ...value,
      value: value.value.map((part) => (part === previous ? next : part)),
    }
  }
  if (value.kind === 'array') {
    return {
      ...value,
      items: value.items.map((item) => replaceValuePath(item, previous, next)),
    }
  }
  if (value.kind === 'functionCall') {
    return {
      ...value,
      args: value.args.map((argument) => ({
        ...argument,
        value: replaceValuePath(argument.value, previous, next),
      })),
    }
  }
  return value
}

function replaceAttributePath(
  attribute: SchemaAttribute,
  previous: string,
  next: string,
  argumentNames?: ReadonlySet<string>,
): SchemaAttribute {
  return {
    ...attribute,
    args: attribute.args.map((argument) =>
      argumentNames && (!argument.name || !argumentNames.has(argument.name))
        ? argument
        : {
            ...argument,
            value: replaceValuePath(argument.value, previous, next),
          },
    ),
  }
}

export function updateFieldInProject(
  snapshot: SchemaProjectSnapshot,
  modelId: string,
  fieldId: string,
  patch: UpdateFieldPatch,
): SchemaMutationResult {
  const model = snapshot.graph.declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModel(declaration) && declaration.id === modelId,
  )
  const field = model?.members.find(
    (member): member is SchemaField => member.kind === 'field' && member.id === fieldId,
  )
  if (!model || !field) return { ok: false, message: '找不到要修改的字段。' }

  const nextName = patch.name?.trim() || field.name
  const nextTypeName = patch.typeName?.trim() || field.type.name
  const nameError = validateIdentifier(nextName, '字段名称')
  if (nameError) return { ok: false, message: nameError }
  const typeError = validateIdentifier(nextTypeName, '字段类型')
  if (typeError) return { ok: false, message: typeError }
  if (
    nextName !== field.name &&
    model.members.some((member) => member.kind === 'field' && member.name === nextName)
  ) {
    return { ok: false, message: `字段“${nextName}”已经存在。` }
  }

  const declarations = snapshot.graph.declarations.map((declaration) => {
    if (!isModel(declaration)) return declaration
    const pointsToRenamedModel = declaration.members.some(
      (member) => member.kind === 'field' && member.type.name === model.name,
    )
    const members = declaration.members.map((member): ModelMember => {
      if (member.kind === 'commentBlock') return member
      if (member.kind === 'blockAttribute') {
        return declaration.id === modelId
          ? {
              ...member,
              attribute: replaceAttributePath(member.attribute, field.name, nextName),
            }
          : member
      }
      if (member.id === fieldId) {
        return {
          ...member,
          name: nextName,
          type: {
            ...member.type,
            name: nextTypeName,
            modifier: patch.modifier ?? member.type.modifier,
          },
          attributes: member.attributes.map((attribute) =>
            replaceAttributePath(attribute, field.name, nextName),
          ),
        }
      }
      if (declaration.id === modelId) {
        return {
          ...member,
          attributes: member.attributes.map((attribute) =>
            replaceAttributePath(attribute, field.name, nextName, new Set(['fields'])),
          ),
        }
      }
      if (pointsToRenamedModel) {
        return {
          ...member,
          attributes: member.attributes.map((attribute) =>
            replaceAttributePath(
              attribute,
              field.name,
              nextName,
              new Set(['references']),
            ),
          ),
        }
      }
      return member
    })
    return { ...declaration, members }
  })

  return { ok: true, files: rewriteFiles(snapshot, declarations) }
}

export function deleteFieldFromProject(
  snapshot: SchemaProjectSnapshot,
  modelId: string,
  fieldId: string,
): SchemaMutationResult {
  const model = snapshot.graph.declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModel(declaration) && declaration.id === modelId,
  )
  const field = model?.members.find(
    (member): member is SchemaField => member.kind === 'field' && member.id === fieldId,
  )
  if (!model || !field) return { ok: false, message: '找不到要删除的字段。' }

  const isReferenced = snapshot.graph.relations.some(
    (relation) =>
      (relation.sourceModelId === modelId && relation.fields.includes(field.name)) ||
      (relation.targetModelId === modelId && relation.references.includes(field.name)),
  )
  if (isReferenced) {
    return {
      ok: false,
      message: `字段“${field.name}”正在被关系约束引用，请先移除对应关系。`,
    }
  }

  const declarations = snapshot.graph.declarations.map((declaration) =>
    isModel(declaration) && declaration.id === modelId
      ? {
          ...declaration,
          members: declaration.members.filter(
            (member) => member.kind !== 'field' || member.id !== fieldId,
          ),
        }
      : declaration,
  )
  return { ok: true, files: rewriteFiles(snapshot, declarations) }
}

export function deleteModelFromProject(
  snapshot: SchemaProjectSnapshot,
  modelId: string,
): SchemaMutationResult {
  const model = snapshot.graph.declarations.find(
    (declaration): declaration is ModelDeclaration =>
      isModel(declaration) && declaration.id === modelId,
  )
  if (!model) return { ok: false, message: '找不到要删除的模型。' }

  const declarations = snapshot.graph.declarations
    .filter((declaration) => !isModel(declaration) || declaration.id !== modelId)
    .map((declaration) => {
      if (!isModel(declaration)) return declaration
      return {
        ...declaration,
        members: declaration.members.filter(
          (member) => member.kind !== 'field' || member.type.name !== model.name,
        ),
      }
    })

  return { ok: true, files: rewriteFiles(snapshot, declarations) }
}

export function addOneToManyRelation(
  snapshot: SchemaProjectSnapshot,
  sourceModelId: string,
  targetModelId: string,
  sourceFieldId?: string,
): SchemaMutationResult {
  const models = snapshot.graph.declarations.filter(isModel)
  const sourceModel = models.find((model) => model.id === sourceModelId)
  const targetModel = models.find((model) => model.id === targetModelId)
  if (!sourceModel || !targetModel) {
    return { ok: false, message: '关系的源模型或目标模型不存在。' }
  }

  const targetIdField = targetModel.members.find(
    (member): member is SchemaField =>
      member.kind === 'field' && Boolean(findAttribute(member.attributes, 'id')),
  )
  if (!targetIdField) {
    return { ok: false, message: `“${targetModel.name}”没有可引用的 @id 字段。` }
  }

  const selectedForeignKey = sourceFieldId
    ? sourceModel.members.find(
        (member): member is SchemaField =>
          member.kind === 'field' && member.id === sourceFieldId,
      )
    : undefined
  if (sourceFieldId && !selectedForeignKey) {
    return { ok: false, message: '找不到拖拽的源字段。' }
  }
  if (
    selectedForeignKey &&
    (selectedForeignKey.type.unsupported ||
      selectedForeignKey.type.modifier === 'list' ||
      selectedForeignKey.type.name !== targetIdField.type.name)
  ) {
    return {
      ok: false,
      message: `字段“${selectedForeignKey.name}”的类型必须与“${targetModel.name}.${targetIdField.name}”一致。`,
    }
  }

  const relationBase = lowerFirst(targetModel.name)
  const relationFieldName = uniqueFieldName(sourceModel, relationBase)
  const foreignKeyName =
    selectedForeignKey?.name ?? uniqueFieldName(sourceModel, `${relationFieldName}Id`)
  const inverseName = uniqueFieldName(targetModel, `${lowerFirst(sourceModel.name)}s`)
  const relationName =
    sourceModel.id === targetModel.id
      ? `${sourceModel.name}${targetModel.name}Relation`
      : undefined
  const relationArgs: SchemaArgument[] = [
    ...(relationName ? [stringArgument(relationName)] : []),
    namedArrayArgument('fields', [foreignKeyName]),
    namedArrayArgument('references', [targetIdField.name]),
  ]
  const relationAttribute: SchemaAttribute = {
    path: ['relation'],
    args: relationArgs,
  }

  const foreignKeyField = selectedForeignKey
    ? undefined
    : createField(sourceModel, foreignKeyName, {
        ...targetIdField.type,
        modifier: 'optional',
      })
  const relationField = createField(
    sourceModel,
    relationFieldName,
    {
      name: targetModel.name,
      modifier:
        selectedForeignKey && selectedForeignKey.type.modifier !== 'optional'
          ? 'plain'
          : 'optional',
      unsupported: false,
    },
    [relationAttribute],
  )
  const inverseAttributes: readonly SchemaAttribute[] = relationName
    ? [
        {
          path: ['relation'],
          args: [stringArgument(relationName)],
        },
      ]
    : []
  const inverseField = createField(
    targetModel,
    inverseName,
    { name: sourceModel.name, modifier: 'list', unsupported: false },
    inverseAttributes,
  )

  const declarations = snapshot.graph.declarations.map((declaration) => {
    if (!isModel(declaration)) return declaration
    if (sourceModel.id === targetModel.id && declaration.id === sourceModel.id) {
      return {
        ...declaration,
        members: [
          ...declaration.members,
          ...(foreignKeyField ? [foreignKeyField] : []),
          relationField,
          inverseField,
        ],
      }
    }
    if (declaration.id === sourceModel.id) {
      return {
        ...declaration,
        members: [
          ...declaration.members,
          ...(foreignKeyField ? [foreignKeyField] : []),
          relationField,
        ],
      }
    }
    if (declaration.id === targetModel.id) {
      return { ...declaration, members: [...declaration.members, inverseField] }
    }
    return declaration
  })

  return { ok: true, files: rewriteFiles(snapshot, declarations) }
}
