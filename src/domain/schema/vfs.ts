import type { LineEnding, VirtualSchemaFile } from './types'

const WINDOWS_DRIVE = /^[a-zA-Z]:/

export function normalizeSchemaPath(input: string): string {
  const normalizedSlashes = input
    .trim()
    .replaceAll('\\', '/')
    .replace(WINDOWS_DRIVE, '')
  const parts: string[] = []

  for (const part of normalizedSlashes.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) {
        throw new Error(`Schema 文件路径不能越过项目根目录：${input}`)
      }
      parts.pop()
      continue
    }
    parts.push(part)
  }

  if (parts.length === 0) {
    throw new Error('Schema 文件路径不能为空。')
  }

  return parts.join('/')
}

export function detectLineEnding(content: string): LineEnding {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function createVirtualSchemaFile(
  path: string,
  rawContent: string,
): VirtualSchemaFile {
  const hasBom = rawContent.charCodeAt(0) === 0xfeff
  const content = hasBom ? rawContent.slice(1) : rawContent

  return {
    path: normalizeSchemaPath(path),
    content,
    lineEnding: detectLineEnding(content),
    hasBom,
  }
}

export function createSchemaVfs(
  files: readonly VirtualSchemaFile[],
): Readonly<Record<string, VirtualSchemaFile>> {
  const vfs: Record<string, VirtualSchemaFile> = {}

  for (const file of files) {
    const path = normalizeSchemaPath(file.path)
    if (vfs[path]) {
      throw new Error(`Schema 文件路径重复：${path}`)
    }
    vfs[path] = { ...file, path }
  }

  return vfs
}

export function serializeVirtualSchemaFile(
  file: VirtualSchemaFile,
  canonicalContent = file.content,
): string {
  const normalized = canonicalContent.replaceAll('\r\n', '\n')
  const withOriginalLineEndings = normalized.replaceAll('\n', file.lineEnding)
  return `${file.hasBom ? '\uFEFF' : ''}${withOriginalLineEndings}`
}
