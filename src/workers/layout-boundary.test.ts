import { readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return extname(entry.name) === '.ts' || extname(entry.name) === '.tsx'
        ? [path]
        : []
    }),
  )
  return nested.flat()
}

describe('layout engine import boundary', () => {
  it('keeps the engine private to its worker and direct tests', async () => {
    const sourceRoot = resolve(import.meta.dirname, '..')
    const importers: string[] = []

    for (const path of await sourceFiles(sourceRoot)) {
      const source = await readFile(path, 'utf8')
      if (/from\s+['"][^'"]*layout-engine['"]/.test(source)) {
        importers.push(relative(sourceRoot, path).replaceAll('\\', '/'))
      }
    }

    expect(importers.sort()).toEqual([
      'workers/layout-engine.test.ts',
      'workers/layout.worker.ts',
    ])

    const publicExports = await readFile(
      resolve(import.meta.dirname, 'index.ts'),
      'utf8',
    )
    expect(publicExports).not.toContain('layout-engine')
  })
})
