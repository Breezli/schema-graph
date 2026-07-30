import type { SchemaParserPort } from './ports'
import type {
  ParseProjectResult,
  ParsedSchemaFile,
  SchemaDiagnostic,
  VirtualSchemaFile,
} from './types'
import { analyzeSchemaDeclarations } from './analyzer'
import { createSchemaVfs } from './vfs'

export interface ParseSchemaProjectInput {
  readonly revision: number
  readonly files: readonly VirtualSchemaFile[]
}

export function parseSchemaProject(
  input: ParseSchemaProjectInput,
  parser: SchemaParserPort,
): ParseProjectResult {
  let files: Readonly<Record<string, VirtualSchemaFile>>
  try {
    files = createSchemaVfs(input.files)
  } catch (error) {
    return {
      valid: false,
      revision: input.revision,
      diagnostics: [
        {
          severity: 'error',
          code: 'invalid-vfs',
          message: error instanceof Error ? error.message : 'Schema 虚拟文件系统无效。',
        },
      ],
    }
  }

  if (Object.keys(files).length === 0) {
    return {
      valid: false,
      revision: input.revision,
      diagnostics: [
        {
          severity: 'error',
          code: 'empty-project',
          message: '项目中至少需要一个 Prisma Schema 文件。',
        },
      ],
    }
  }

  const parsedFiles: ParsedSchemaFile[] = []
  const diagnostics: SchemaDiagnostic[] = []

  for (const file of Object.values(files).sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const result = parser.parseFile(file)
    if (result.ok) parsedFiles.push(result.value)
    else diagnostics.push(...result.diagnostics)
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { valid: false, revision: input.revision, diagnostics }
  }

  const declarations = parsedFiles.flatMap((file) => file.declarations)
  const analysis = analyzeSchemaDeclarations(input.revision, declarations)
  diagnostics.push(...analysis.diagnostics)

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { valid: false, revision: input.revision, diagnostics }
  }

  const canonicalFiles = Object.fromEntries(
    parsedFiles.map((file) => [file.file.path, file.canonicalContent]),
  )

  return {
    valid: true,
    diagnostics,
    snapshot: {
      revision: input.revision,
      files,
      canonicalFiles,
      graph: analysis.graph,
      diagnostics,
    },
  }
}
