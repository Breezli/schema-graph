import type { ParseFileResult, VirtualSchemaFile } from './types'

export interface SchemaParserPort {
  parseFile(file: VirtualSchemaFile): ParseFileResult
}

export interface SchemaFormatterPort {
  formatFile(file: VirtualSchemaFile): ParseFileResult
}

export interface SchemaValidatorPort {
  validate(
    files: readonly VirtualSchemaFile[],
  ): Promise<readonly import('./types').SchemaDiagnostic[]>
}
