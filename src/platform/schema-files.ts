import { strToU8, zipSync } from 'fflate'

import {
  createVirtualSchemaFile,
  serializeVirtualSchemaFile,
  type SchemaProjectSnapshot,
  type VirtualSchemaFile,
} from '@/domain/schema'

export async function filesFromFileList(
  files: FileList | readonly File[],
): Promise<readonly VirtualSchemaFile[]> {
  const prismaFiles = Array.from(files).filter((file) =>
    file.name.toLowerCase().endsWith('.prisma'),
  )
  return Promise.all(
    prismaFiles.map(async (file) => {
      const relativePath =
        'webkitRelativePath' in file && file.webkitRelativePath
          ? file.webkitRelativePath
          : file.name
      return createVirtualSchemaFile(relativePath, await file.text())
    }),
  )
}

export function buildCombinedSchema(snapshot: SchemaProjectSnapshot): string {
  return Object.entries(snapshot.canonicalFiles)
    .map(([path, content]) => `// ── ${path} ──\n${content.trimEnd()}`)
    .join('\n\n')
    .concat('\n')
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replaceAll(/[^\p{L}\p{N}._-]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '') || 'schema-graph'
  )
}

function safePrismaFileName(path: string): string {
  const basename = path.trim().split(/[\\/]/).at(-1) ?? ''
  const stem = basename
    .replace(/\.prisma$/i, '')
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, '-')
    .replaceAll(/^[._-]+|[._-]+$/g, '')
  return stem ? `${stem}.prisma` : 'schema.prisma'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export function downloadSchemaProject(
  projectName: string,
  snapshot: SchemaProjectSnapshot,
): void {
  const entries = Object.entries(snapshot.canonicalFiles)
  if (entries.length === 1) {
    const [path, canonicalContent] = entries[0] ?? ['schema.prisma', '']
    const file = snapshot.files[path]
    const content = file
      ? serializeVirtualSchemaFile(file, canonicalContent)
      : canonicalContent
    downloadBlob(
      new Blob([content], { type: 'text/plain;charset=utf-8' }),
      safePrismaFileName(path),
    )
    return
  }

  const archive = Object.fromEntries(
    entries.map(([path, canonicalContent]) => {
      const file = snapshot.files[path]
      const content = file
        ? serializeVirtualSchemaFile(file, canonicalContent)
        : canonicalContent
      return [path, strToU8(content)]
    }),
  )
  downloadBlob(
    new Blob([zipSync(archive, { level: 6 })], { type: 'application/zip' }),
    `${safeFileName(projectName)}.zip`,
  )
}
