import Dexie, { type Table } from 'dexie'

import type {
  EdgeStyle,
  EditorDocument,
  LayoutDirection,
  NodeDensity,
  RelationNotation,
  RelationLabelMode,
} from '@/state/editor-store'

export interface ProjectRecord {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastOpenedAt: number
  readonly activeFilePath?: string
}

export interface FileRecord {
  readonly id: string
  readonly projectId: string
  readonly path: string
  readonly content: string
  readonly lineEnding: '\n' | '\r\n'
  readonly hasBom: boolean
  readonly updatedAt: number
}

export interface LayoutRecord {
  readonly projectId: string
  readonly positions: EditorDocument['positions']
  readonly density: NodeDensity
  readonly edgeStyle: EdgeStyle
  readonly relationLabelMode: RelationLabelMode
  readonly layoutDirection: LayoutDirection
  readonly relationNotation?: RelationNotation
  readonly highlightRequiredFields?: boolean
}

export interface SettingRecord {
  readonly key: string
  readonly value: string
}

class SchemaGraphDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>
  files!: Table<FileRecord, string>
  layouts!: Table<LayoutRecord, string>
  settings!: Table<SettingRecord, string>

  constructor() {
    super('schema-graph')
    this.version(1).stores({
      projects: 'id, updatedAt, lastOpenedAt',
      files: 'id, projectId, [projectId+path]',
      layouts: 'projectId',
      settings: 'key',
    })
  }
}

let database: SchemaGraphDatabase | undefined

function getDatabase(): SchemaGraphDatabase | undefined {
  if (typeof indexedDB === 'undefined') return undefined
  database ??= new SchemaGraphDatabase()
  return database
}

export interface PersistedProjectInput {
  readonly id: string
  readonly name: string
  readonly document: EditorDocument
  readonly activeFilePath?: string
  readonly density: NodeDensity
  readonly edgeStyle: EdgeStyle
  readonly relationLabelMode: RelationLabelMode
  readonly layoutDirection: LayoutDirection
  readonly relationNotation: RelationNotation
  readonly highlightRequiredFields: boolean
}

export async function savePersistedProject(
  input: PersistedProjectInput,
): Promise<void> {
  const db = getDatabase()
  if (!db) return
  const now = Date.now()
  const existing = await db.projects.get(input.id)
  const fileRecords: FileRecord[] = input.document.files.map((file) => ({
    id: `${input.id}:${file.path}`,
    projectId: input.id,
    path: file.path,
    content: file.content,
    lineEnding: file.lineEnding,
    hasBom: file.hasBom,
    updatedAt: now,
  }))
  const nextIds = new Set(fileRecords.map((file) => file.id))

  await db.transaction('rw', db.projects, db.files, db.layouts, async () => {
    await db.projects.put({
      id: input.id,
      name: input.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastOpenedAt: now,
      activeFilePath: input.activeFilePath,
    })
    const previousFiles = await db.files.where('projectId').equals(input.id).toArray()
    await db.files.bulkDelete(
      previousFiles.filter((file) => !nextIds.has(file.id)).map((file) => file.id),
    )
    await db.files.bulkPut(fileRecords)
    await db.layouts.put({
      projectId: input.id,
      positions: input.document.positions,
      density: input.density,
      edgeStyle: input.edgeStyle,
      relationLabelMode: input.relationLabelMode,
      layoutDirection: input.layoutDirection,
      relationNotation: input.relationNotation,
      highlightRequiredFields: input.highlightRequiredFields,
    })
  })
}

export interface LoadedProject {
  readonly project: ProjectRecord
  readonly document: EditorDocument
  readonly layout?: LayoutRecord
}

export async function loadPersistedProject(
  id: string,
): Promise<LoadedProject | undefined> {
  const db = getDatabase()
  if (!db) return undefined
  const [project, files, layout] = await Promise.all([
    db.projects.get(id),
    db.files.where('projectId').equals(id).sortBy('path'),
    db.layouts.get(id),
  ])
  if (!project) return undefined
  await db.projects.update(id, { lastOpenedAt: Date.now() })
  return {
    project,
    document: {
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        lineEnding: file.lineEnding,
        hasBom: file.hasBom,
      })),
      positions: layout?.positions ?? {},
    },
    layout,
  }
}

export async function listPersistedProjects(): Promise<readonly ProjectRecord[]> {
  const db = getDatabase()
  if (!db) return []
  return db.projects.orderBy('lastOpenedAt').reverse().toArray()
}

export async function deletePersistedProject(id: string): Promise<void> {
  const db = getDatabase()
  if (!db) return
  await db.transaction('rw', db.projects, db.files, db.layouts, async () => {
    await db.projects.delete(id)
    await db.files.where('projectId').equals(id).delete()
    await db.layouts.delete(id)
  })
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const db = getDatabase()
  if (!db) return
  await db.settings.put({ key, value })
}

export async function loadSetting(key: string): Promise<string | undefined> {
  const db = getDatabase()
  return (await db?.settings.get(key))?.value
}
