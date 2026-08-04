export type LineEnding = '\n' | '\r\n'

export interface SourceLocation {
  readonly offset: number
  readonly line: number
  readonly column: number
}

export interface SourceRange {
  readonly start: SourceLocation
  readonly end: SourceLocation
}

export interface SourceReference {
  readonly filePath: string
  readonly range?: SourceRange
}

export interface VirtualSchemaFile {
  readonly path: string
  readonly content: string
  readonly lineEnding: LineEnding
  readonly hasBom: boolean
}

export interface SchemaDiagnostic {
  readonly severity: 'error' | 'warning' | 'info'
  readonly code: string
  readonly message: string
  readonly filePath?: string
  readonly range?: SourceRange
}

export interface SchemaComment {
  readonly kind: 'comment' | 'docComment'
  readonly text: string
  readonly source?: SourceReference
}

export interface CommentMember {
  readonly kind: 'commentBlock'
  readonly comments: readonly SchemaComment[]
}

export type SchemaValue =
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'path'; readonly value: readonly string[] }
  | { readonly kind: 'array'; readonly items: readonly SchemaValue[] }
  | {
      readonly kind: 'functionCall'
      readonly path: readonly string[]
      readonly args: readonly SchemaArgument[]
    }

export interface SchemaArgument {
  readonly name?: string
  readonly value: SchemaValue
}

export interface SchemaAttribute {
  readonly path: readonly string[]
  readonly args: readonly SchemaArgument[]
  readonly source?: SourceReference
}

export interface SchemaTypeRef {
  readonly name: string
  readonly modifier: 'plain' | 'optional' | 'list' | 'required'
  readonly unsupported: boolean
}

export interface SchemaField {
  readonly kind: 'field'
  readonly id: string
  readonly name: string
  readonly type: SchemaTypeRef
  readonly attributes: readonly SchemaAttribute[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export interface BlockAttributeMember {
  readonly kind: 'blockAttribute'
  readonly attribute: SchemaAttribute
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export type ModelMember = SchemaField | BlockAttributeMember | CommentMember

export interface ModelDeclaration {
  readonly kind: 'model' | 'view' | 'type'
  readonly id: string
  readonly name: string
  readonly members: readonly ModelMember[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export interface EnumValueMember {
  readonly kind: 'enumValue'
  readonly id: string
  readonly name: string
  readonly attributes: readonly SchemaAttribute[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export type EnumMember = EnumValueMember | BlockAttributeMember | CommentMember

export interface EnumDeclaration {
  readonly kind: 'enum'
  readonly id: string
  readonly name: string
  readonly members: readonly EnumMember[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export interface ConfigEntryMember {
  readonly kind: 'config'
  readonly id: string
  readonly name: string
  readonly value: SchemaValue
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export type ConfigMember = ConfigEntryMember | CommentMember

export interface ConfigDeclaration {
  readonly kind: 'datasource' | 'generator'
  readonly id: string
  readonly name: string
  readonly members: readonly ConfigMember[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export interface TypeAliasDeclaration {
  readonly kind: 'typeAlias'
  readonly id: string
  readonly name: string
  readonly type: SchemaTypeRef
  readonly attributes: readonly SchemaAttribute[]
  readonly leadingComments?: readonly SchemaComment[]
  readonly trailingComment?: SchemaComment
  readonly source: SourceReference
}

export type SchemaDeclaration =
  | ModelDeclaration
  | EnumDeclaration
  | ConfigDeclaration
  | TypeAliasDeclaration
  | CommentMember

export interface ParsedSchemaFile {
  readonly file: VirtualSchemaFile
  readonly declarations: readonly SchemaDeclaration[]
  readonly canonicalContent: string
}

export type ParseFileResult =
  | { readonly ok: true; readonly value: ParsedSchemaFile }
  | { readonly ok: false; readonly diagnostics: readonly SchemaDiagnostic[] }

export interface SchemaSymbol {
  readonly name: string
  readonly kind: SchemaDeclaration['kind']
  readonly declarationId: string
  readonly filePath: string
}

export interface SchemaRelation {
  readonly id: string
  readonly name?: string
  readonly sourceModelId: string
  readonly sourceModelName: string
  readonly sourceFieldId: string
  readonly sourceFieldName: string
  readonly targetModelId: string
  readonly targetModelName: string
  readonly sourceCardinality: 'one' | 'optional' | 'many'
  readonly fields: readonly string[]
  readonly references: readonly string[]
  readonly onDelete?: string
  readonly onUpdate?: string
  readonly map?: string
  readonly source: SourceReference
}

export type RelationCardinality = 'zero-one' | 'one' | 'many'

export interface SchemaRelationEndpoint {
  readonly modelId: string
  readonly modelName: string
  readonly fieldIds: readonly string[]
  readonly fieldNames: readonly string[]
  readonly cardinality: RelationCardinality
  readonly sources: readonly SourceReference[]
}

export interface SchemaLogicalRelation {
  readonly id: string
  readonly name?: string
  readonly source: SchemaRelationEndpoint
  readonly target: SchemaRelationEndpoint
  readonly memberRelationIds: readonly string[]
  readonly foreignKey?: {
    readonly sourceModelId: string
    readonly targetModelId: string
    readonly relationFieldId: string
    readonly fieldNames: readonly string[]
    readonly referenceNames: readonly string[]
  }
}

export interface SchemaForeignKeySemantics {
  readonly childModelId: string
  readonly parentModelId: string
  readonly childRelationFieldId: string
  readonly childFieldNames: readonly string[]
  readonly parentReferenceNames: readonly string[]
}

export interface SchemaGraphSnapshot {
  readonly revision: number
  readonly declarations: readonly SchemaDeclaration[]
  readonly symbols: Readonly<Record<string, readonly SchemaSymbol[]>>
  readonly relations: readonly SchemaRelation[]
  readonly logicalRelations: readonly SchemaLogicalRelation[]
}

export interface SchemaProjectSnapshot {
  readonly revision: number
  readonly files: Readonly<Record<string, VirtualSchemaFile>>
  readonly canonicalFiles: Readonly<Record<string, string>>
  readonly graph: SchemaGraphSnapshot
  readonly diagnostics: readonly SchemaDiagnostic[]
}

export type ParseProjectResult =
  | {
      readonly valid: true
      readonly snapshot: SchemaProjectSnapshot
      readonly diagnostics: readonly SchemaDiagnostic[]
    }
  | {
      readonly valid: false
      readonly revision: number
      readonly diagnostics: readonly SchemaDiagnostic[]
    }
