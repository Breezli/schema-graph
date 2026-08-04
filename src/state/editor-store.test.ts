import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoadedProject, PersistedProjectInput } from '@/db'
import { LoancrateSchemaParser } from '@/adapters/schema'
import {
  createVirtualSchemaFile,
  parseSchemaProject,
  type ModelDeclaration,
  type SchemaField,
} from '@/domain/schema'

import {
  applySchemaParseResult,
  beginSchemaParse,
  createSchemaSessionParseState,
} from './schema-session'
import { resetEditorStoreRuntime, useEditorStore } from './editor-store'
import {
  SCHEMA_PARSER_PROTOCOL_VERSION,
  type SchemaParserWorkerRequest,
  type SchemaParserWorkerResponse,
} from '@/workers'

const dbMocks = vi.hoisted(() => ({
  listPersistedProjects: vi.fn(),
  loadPersistedProject: vi.fn(),
  prepareLocalProjectsExportDownload: vi.fn(),
  deletePersistedProject: vi.fn(),
  savePersistedProject: vi.fn(),
}))

vi.mock('@/db', () => ({
  deletePersistedProject: dbMocks.deletePersistedProject,
  listPersistedProjects: dbMocks.listPersistedProjects,
  loadPersistedProject: dbMocks.loadPersistedProject,
  loadSetting: vi.fn(),
  prepareLocalProjectsExportDownload: dbMocks.prepareLocalProjectsExportDownload,
  savePersistedProject: dbMocks.savePersistedProject,
  saveSetting: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

describe('editor persistence coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    dbMocks.listPersistedProjects.mockReset().mockResolvedValue([])
    dbMocks.prepareLocalProjectsExportDownload.mockReset().mockResolvedValue({
      bundle: {},
      blob: new Blob(),
      filename: 'projects.json',
    })
    dbMocks.savePersistedProject.mockReset().mockResolvedValue(undefined)
    dbMocks.deletePersistedProject.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetEditorStoreRuntime()
    vi.unstubAllGlobals()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('flushes the latest edit and position immediately before leaving', async () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Immediate', [
      {
        path: 'schema.prisma',
        content: 'model Before {}\n',
        lineEnding: '\n',
        hasBom: false,
      },
    ])
    store.updateFileContent('schema.prisma', 'model Latest {}\n')
    store.setNodePosition('Latest', { x: 120, y: 240 })
    store.setActiveFile('schema.prisma')
    store.setDensity('full')

    store.leaveWorkspace()
    await useEditorStore.getState().flushPersistence()

    const saved = dbMocks.savePersistedProject.mock.calls.at(-1)?.[0] as
      PersistedProjectInput | undefined
    expect(saved?.document.files[0]?.content).toBe('model Latest {}\n')
    expect(saved?.document.positions).toEqual({ Latest: { x: 120, y: 240 } })
    expect(saved?.activeFilePath).toBe('schema.prisma')
    expect(saved?.density).toBe('full')
  })

  it('recovers from a failed persistence operation on a later flush', async () => {
    dbMocks.savePersistedProject
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const store = useEditorStore.getState()
    store.openLocalFiles('Recovery', [
      {
        path: 'schema.prisma',
        content: 'model Recovery {}\n',
        lineEnding: '\n',
        hasBom: false,
      },
    ])

    await expect(store.flushPersistence()).rejects.toThrow('storage unavailable')
    await expect(store.flushPersistence()).resolves.toBeUndefined()
    expect(dbMocks.savePersistedProject).toHaveBeenCalledTimes(2)
  })

  it('prepares export only after in-flight persistence settles', async () => {
    let finishSave = (): void => {}
    const savePending = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    dbMocks.savePersistedProject.mockReturnValueOnce(savePending)
    const store = useEditorStore.getState()
    store.openLocalFiles('Prepared export', [
      {
        path: 'schema.prisma',
        content: 'model Prepared {}\n',
        lineEnding: '\n',
        hasBom: false,
      },
    ])

    const preparation = store.prepareLocalProjectsExportDownload(
      new Date('2026-07-31T12:34:56.789Z'),
    )
    await Promise.resolve()
    expect(dbMocks.prepareLocalProjectsExportDownload).not.toHaveBeenCalled()

    finishSave()
    await preparation

    expect(dbMocks.prepareLocalProjectsExportDownload).toHaveBeenCalledWith(
      new Date('2026-07-31T12:34:56.789Z'),
    )
  })

  it('keeps failed A after B succeeds and retries A on a later flush', async () => {
    vi.setSystemTime(1_000)
    dbMocks.savePersistedProject
      .mockRejectedValueOnce(new Error('A unavailable'))
      .mockResolvedValue(undefined)
    const store = useEditorStore.getState()
    store.openLocalFiles('Project A', [
      createVirtualSchemaFile('schema.prisma', 'model A {}\n'),
    ])
    const projectA = useEditorStore.getState().projectId
    await expect(store.flushPersistence()).rejects.toThrow('A unavailable')

    vi.setSystemTime(2_000)
    store.openLocalFiles('Project B', [
      createVirtualSchemaFile('schema.prisma', 'model B {}\n'),
    ])
    const projectB = useEditorStore.getState().projectId
    await vi.advanceTimersByTimeAsync(80)

    expect(
      dbMocks.savePersistedProject.mock.calls.map(
        ([input]) => (input as PersistedProjectInput).id,
      ),
    ).toEqual([projectA, projectB])

    await store.flushPersistence()
    expect(
      dbMocks.savePersistedProject.mock.calls.map(
        ([input]) => (input as PersistedProjectInput).id,
      ),
    ).toEqual([projectA, projectB, projectA])
  })

  it('tombstones failed persistence before deleting a project', async () => {
    dbMocks.savePersistedProject
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined)
    const store = useEditorStore.getState()
    store.openLocalFiles('Delete failed project', [
      createVirtualSchemaFile('schema.prisma', 'model Deleted {}\n'),
    ])
    const projectId = useEditorStore.getState().projectId
    if (!projectId) throw new Error('Missing project ID')
    await expect(store.flushPersistence()).rejects.toThrow('storage unavailable')

    await store.deleteLocalProject(projectId)
    await store.flushPersistence()

    expect(dbMocks.deletePersistedProject).toHaveBeenCalledWith(projectId)
    expect(dbMocks.savePersistedProject).toHaveBeenCalledTimes(1)
  })
})

const parser = new LoancrateSchemaParser()

function validParseState(files: ReturnType<typeof createVirtualSchemaFile>[]) {
  let parseState = beginSchemaParse(createSchemaSessionParseState(), files)
  parseState = applySchemaParseResult(
    parseState,
    parseSchemaProject({ revision: parseState.sourceRevision, files }, parser),
  )
  return parseState
}

function model(name: string): ModelDeclaration {
  const declaration = useEditorStore
    .getState()
    .parseState.lastValidSnapshot?.graph.declarations.find(
      (entry): entry is ModelDeclaration =>
        (entry.kind === 'model' || entry.kind === 'view' || entry.kind === 'type') &&
        entry.name === name,
    )
  if (!declaration) throw new Error(`Missing model ${name}`)
  return declaration
}

function field(declaration: ModelDeclaration, name: string): SchemaField {
  const member = declaration.members.find(
    (entry): entry is SchemaField => entry.kind === 'field' && entry.name === name,
  )
  if (!member) throw new Error(`Missing field ${declaration.name}.${name}`)
  return member
}

describe('Phase C editor state foundations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    dbMocks.listPersistedProjects.mockReset().mockResolvedValue([])
    dbMocks.savePersistedProject.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetEditorStoreRuntime()
    vi.unstubAllGlobals()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('anchors only qualifying parent-list field selections to a logical edge', () => {
    const files = [
      createVirtualSchemaFile(
        'models/user.prisma',
        `model User {
  id Int @id
  posts Post[]
}
`,
      ),
      createVirtualSchemaFile(
        'models/post.prisma',
        `model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`,
      ),
    ]
    useEditorStore.setState({
      parseState: validParseState(files),
      activeFilePath: 'models/post.prisma',
      selectedNodeId: undefined,
      selectedFieldId: undefined,
      selectedEdgeId: undefined,
      selectedEdgeAnchorFieldId: undefined,
    })
    const user = model('User')
    const post = model('Post')
    const posts = field(user, 'posts')
    const authorId = field(post, 'authorId')

    useEditorStore.setState((state) => ({
      parseState: { ...state.parseState, status: 'parsing' },
    }))
    useEditorStore.getState().selectFieldFromCanvas(user.id, posts.id)
    const anchored = useEditorStore.getState()
    expect(anchored.selectedEdgeId).toBeDefined()
    expect(anchored.selectedEdgeAnchorFieldId).toBe(posts.id)
    expect(anchored.selectedNodeId).toBeUndefined()
    expect(anchored.selectedFieldId).toBeUndefined()
    expect(anchored.activeFilePath).toBe('models/user.prisma')

    useEditorStore.getState().selectFieldFromCanvas(post.id, authorId.id)
    const ordinary = useEditorStore.getState()
    expect(ordinary.selectedNodeId).toBe(post.id)
    expect(ordinary.selectedFieldId).toBe(authorId.id)
    expect(ordinary.selectedEdgeId).toBeUndefined()
    expect(ordinary.selectedEdgeAnchorFieldId).toBeUndefined()
    expect(ordinary.activeFilePath).toBe('models/post.prisma')
  })

  it('uses field source for anchored edges and source-first convention for direct edges', () => {
    const files = [
      createVirtualSchemaFile(
        'parent.prisma',
        'model User {\n  id Int @id\n  posts Post[]\n}\n',
      ),
      createVirtualSchemaFile(
        'child.prisma',
        'model Post {\n  id Int @id\n  authorId Int\n  author User @relation(fields: [authorId], references: [id])\n}\n',
      ),
    ]
    useEditorStore.setState({ parseState: validParseState(files) })
    const user = model('User')
    const posts = field(user, 'posts')
    const relation =
      useEditorStore.getState().parseState.lastValidSnapshot?.graph.logicalRelations[0]
    if (!relation) throw new Error('Missing logical relation')

    useEditorStore.getState().setSelectedEdge(relation.id)
    expect(useEditorStore.getState().selectedEdgeAnchorFieldId).toBeUndefined()
    expect(useEditorStore.getState().activeFilePath).toBe(
      relation.source.sources[0]?.filePath,
    )

    useEditorStore.getState().setSelectedEdge(relation.id, posts.id)
    expect(useEditorStore.getState().selectedEdgeAnchorFieldId).toBe(posts.id)
    expect(useEditorStore.getState().activeFilePath).toBe('parent.prisma')

    useEditorStore.getState().setSelectedEdge(relation.id, 'field:unrelated')
    expect(useEditorStore.getState().selectedEdgeAnchorFieldId).toBeUndefined()

    useEditorStore.getState().setSelectedNode(user.id)
    expect(useEditorStore.getState().selectedEdgeAnchorFieldId).toBeUndefined()
  })

  it('clears graph selection and creates a file-scoped diagnostic navigation request', () => {
    const files = [
      createVirtualSchemaFile('schema.prisma', 'model User {\n  id Int @id\n}\n'),
      createVirtualSchemaFile('models/post.prisma', 'model Post {}\n'),
    ]
    const store = useEditorStore.getState()
    store.openLocalFiles('Diagnostic navigation', files)
    useEditorStore.setState({ parseState: validParseState(files) })
    const user = model('User')

    store.focusNodeFromNavigation(user.id)
    const selectionRequest = useEditorStore.getState().sourceNavigationRequest
    expect(selectionRequest).toMatchObject({ id: 1, kind: 'selection' })
    useEditorStore.setState({
      selectedFieldId: 'field:stale',
      selectedEdgeId: 'relation:stale',
      selectedEdgeAnchorFieldId: 'field:anchor',
    })
    const range = {
      start: { offset: 12, line: 2, column: 3 },
      end: { offset: 14, line: 2, column: 5 },
    }

    store.navigateToDiagnostic('models/post.prisma', range)

    expect(useEditorStore.getState()).toMatchObject({
      activeFilePath: 'models/post.prisma',
      selectedNodeId: undefined,
      selectedFieldId: undefined,
      selectedEdgeId: undefined,
      selectedEdgeAnchorFieldId: undefined,
      canvasFocusRequest: undefined,
      sourceNavigationRequestId: 2,
      sourceNavigationRequest: {
        id: 2,
        kind: 'diagnostic',
        filePath: 'models/post.prisma',
        range,
      },
    })
  })

  it('acknowledges source navigation idempotently per file', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Navigation acknowledgement', [
      createVirtualSchemaFile('schema.prisma', 'model User {}\n'),
    ])
    store.navigateToDiagnostic('schema.prisma')
    const request = useEditorStore.getState().sourceNavigationRequest
    if (!request) throw new Error('Missing source navigation request')

    store.acknowledgeSourceNavigation(request.id, 'other.prisma')
    store.acknowledgeSourceNavigation(request.id, 'schema.prisma')
    store.acknowledgeSourceNavigation(request.id, 'schema.prisma')

    expect(
      useEditorStore.getState().sourceNavigationRequest?.consumedFilePaths,
    ).toEqual(['schema.prisma'])
  })

  it('retains acknowledgements from both files in a split relation request', () => {
    const files = [
      createVirtualSchemaFile(
        'parent.prisma',
        'model User {\n  id Int @id\n  posts Post[]\n}\n',
      ),
      createVirtualSchemaFile(
        'child.prisma',
        'model Post {\n  id Int @id\n  authorId Int\n  author User @relation(fields: [authorId], references: [id])\n}\n',
      ),
    ]
    useEditorStore.setState({ parseState: validParseState(files) })
    const relation =
      useEditorStore.getState().parseState.lastValidSnapshot?.graph.logicalRelations[0]
    if (!relation) throw new Error('Missing logical relation')
    const store = useEditorStore.getState()
    store.setSelectedEdge(relation.id)
    const request = useEditorStore.getState().sourceNavigationRequest
    if (!request) throw new Error('Missing source navigation request')

    store.acknowledgeSourceNavigation(request.id, 'parent.prisma')
    store.acknowledgeSourceNavigation(request.id, 'child.prisma')

    expect(
      useEditorStore.getState().sourceNavigationRequest?.consumedFilePaths,
    ).toEqual(['parent.prisma', 'child.prisma'])
  })

  it('ignores stale source navigation acknowledgement IDs', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Stale navigation acknowledgement', [
      createVirtualSchemaFile('schema.prisma', 'model User {}\n'),
    ])
    store.navigateToDiagnostic('schema.prisma')
    const staleRequest = useEditorStore.getState().sourceNavigationRequest
    if (!staleRequest) throw new Error('Missing stale source navigation request')
    store.navigateToDiagnostic('schema.prisma')
    const currentRequest = useEditorStore.getState().sourceNavigationRequest
    if (!currentRequest) throw new Error('Missing current source navigation request')

    store.acknowledgeSourceNavigation(staleRequest.id, 'schema.prisma')

    expect(useEditorStore.getState().sourceNavigationRequest).toBe(currentRequest)
    expect(currentRequest.consumedFilePaths).toEqual([])
  })

  it('starts each new source navigation request without consumed files', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('New navigation request', [
      createVirtualSchemaFile('schema.prisma', 'model User {}\n'),
    ])
    store.navigateToDiagnostic('schema.prisma')
    const firstRequest = useEditorStore.getState().sourceNavigationRequest
    if (!firstRequest) throw new Error('Missing first source navigation request')
    store.acknowledgeSourceNavigation(firstRequest.id, 'schema.prisma')

    store.navigateToDiagnostic('schema.prisma')

    expect(useEditorStore.getState().sourceNavigationRequest).toMatchObject({
      id: firstRequest.id + 1,
      consumedFilePaths: [],
    })
  })

  it('clears consumed source navigation state on session reset', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Reset navigation acknowledgement', [
      createVirtualSchemaFile('schema.prisma', 'model User {}\n'),
    ])
    store.navigateToDiagnostic('schema.prisma')
    const request = useEditorStore.getState().sourceNavigationRequest
    if (!request) throw new Error('Missing source navigation request')
    store.acknowledgeSourceNavigation(request.id, 'schema.prisma')
    const previousSessionId = useEditorStore.getState().editorSessionId

    resetEditorStoreRuntime()

    expect(useEditorStore.getState()).toMatchObject({
      editorSessionId: previousSessionId + 1,
      sourceNavigationRequestId: 0,
      sourceNavigationRequest: undefined,
    })
  })

  it('tracks initial, direction-change and explicit auto-layout requests only', () => {
    const store = useEditorStore.getState()
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}\n')]
    store.openLocalFiles('Layout lifecycle', files)
    useEditorStore.setState({ parseState: validParseState(files) })
    expect(useEditorStore.getState().initialLayoutCompleted).toBe(false)
    expect(useEditorStore.getState().layoutRequest).toBeUndefined()

    store.confirmLayoutDirection('RIGHT')
    const initial = useEditorStore.getState().layoutRequest
    expect(initial).toMatchObject({
      reason: 'initial-confirmation',
      direction: 'RIGHT',
    })
    if (!initial) throw new Error('Missing initial layout request')
    expect(
      store.applyLayoutOutcome({
        ok: true,
        editorSessionId: initial.editorSessionId,
        projectId: 'wrong-project',
        requestId: initial.id,
        graphRevision: initial.graphRevision,
        direction: initial.direction,
        positions: {},
      }),
    ).toBe(false)
    expect(useEditorStore.getState().layoutRequest).toBe(initial)
    store.applyLayoutOutcome({
      ok: true,
      editorSessionId: initial.editorSessionId,
      projectId: initial.projectId,
      requestId: initial.id,
      graphRevision: initial.graphRevision,
      direction: initial.direction,
      positions: { 'model:schema.prisma:User': { x: 0, y: 0 } },
    })
    expect(useEditorStore.getState().initialLayoutCompleted).toBe(true)
    expect(useEditorStore.getState().layoutRequest).toBeUndefined()

    store.setDensity('full')
    store.setSelectedNode(undefined)
    store.updateFileContent('schema.prisma', 'model User {\n  id Int @id\n}\n')
    expect(useEditorStore.getState().layoutRequest).toBeUndefined()

    store.setLayoutDirection('DOWN')
    const direction = useEditorStore.getState().layoutRequest
    expect(direction).toMatchObject({ reason: 'direction-change', direction: 'DOWN' })
    if (!direction) throw new Error('Missing direction layout request')
    store.applyLayoutOutcome({
      ok: true,
      editorSessionId: direction.editorSessionId,
      projectId: direction.projectId,
      requestId: direction.id,
      graphRevision: direction.graphRevision,
      direction: direction.direction,
      positions: { 'model:schema.prisma:User': { x: 0, y: 0 } },
    })

    store.requestAutoLayout()
    expect(useEditorStore.getState().layoutRequest).toMatchObject({
      reason: 'explicit-auto-layout',
      direction: 'DOWN',
    })
  })

  it('supersedes an incomplete initial layout on direction change and handles failure atomically', () => {
    const store = useEditorStore.getState()
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}\n')]
    store.openLocalFiles('Failed initial layout', files)
    useEditorStore.setState({ parseState: validParseState(files) })
    store.confirmLayoutDirection('RIGHT')
    const initial = useEditorStore.getState().layoutRequest
    if (!initial) throw new Error('Missing initial request')

    store.setLayoutDirection('DOWN')
    const superseding = useEditorStore.getState().layoutRequest
    expect(superseding).toMatchObject({ reason: 'direction-change', direction: 'DOWN' })
    expect(superseding?.id).not.toBe(initial.id)
    if (!superseding) throw new Error('Missing superseding request')

    expect(
      store.applyLayoutOutcome({
        ok: false,
        editorSessionId: superseding.editorSessionId,
        projectId: superseding.projectId,
        requestId: superseding.id,
        graphRevision: superseding.graphRevision,
        direction: superseding.direction,
        error: new Error('layout failed'),
      }),
    ).toBe(true)
    expect(useEditorStore.getState().layoutRequest).toBeUndefined()
    expect(useEditorStore.getState().initialLayoutCompleted).toBe(false)
    expect(useEditorStore.getState().history.present.positions).toEqual({})
  })

  it('separates typing groups around an atomic code edit', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Atomic history', [
      createVirtualSchemaFile('schema.prisma', 'a'),
    ])

    store.updateFileContent('schema.prisma', 'ab')
    store.updateFileContent('schema.prisma', 'abc')
    expect(useEditorStore.getState().history.past).toHaveLength(1)

    store.updateFileContent('schema.prisma', 'abc\n', { atomic: true })
    expect(useEditorStore.getState().history.past).toHaveLength(2)

    store.updateFileContent('schema.prisma', 'abc\nd')
    store.updateFileContent('schema.prisma', 'abc\nde')
    expect(useEditorStore.getState().history.past).toHaveLength(3)

    store.undo()
    expect(useEditorStore.getState().history.present.files[0]?.content).toBe('abc\n')
    store.undo()
    expect(useEditorStore.getState().history.present.files[0]?.content).toBe('abc')
    store.redo()
    expect(useEditorStore.getState().history.present.files[0]?.content).toBe('abc\n')
    store.redo()
    expect(useEditorStore.getState().history.present.files[0]?.content).toBe('abc\nde')
  })

  it('bounds typing coalescence by timestamp and file switches', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Bounded history', [
      createVirtualSchemaFile('a.prisma', 'a'),
      createVirtualSchemaFile('b.prisma', 'b'),
    ])

    store.updateFileContent('a.prisma', 'a1', { timestamp: 100 })
    store.updateFileContent('a.prisma', 'a2', { timestamp: 700 })
    expect(useEditorStore.getState().history.past).toHaveLength(1)

    store.updateFileContent('a.prisma', 'a3', { timestamp: 851 })
    expect(useEditorStore.getState().history.past).toHaveLength(2)

    store.setActiveFile('b.prisma')
    store.setActiveFile('a.prisma')
    store.updateFileContent('a.prisma', 'a4', { timestamp: 900 })
    expect(useEditorStore.getState().history.past).toHaveLength(3)

    store.updateFileContent('b.prisma', 'b1', { timestamp: 950 })
    store.updateFileContent('a.prisma', 'a5', { timestamp: 1_000 })
    expect(useEditorStore.getState().history.past).toHaveLength(5)

    store.undo()
    expect(useEditorStore.getState().history.present.files[0]?.content).toBe('a4')
    store.undo()
    expect(useEditorStore.getState().history.present.files[1]?.content).toBe('b')
  })

  it('records each manual drag stop as an independent history entry', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Drag history', [
      createVirtualSchemaFile('schema.prisma', 'model A {}\nmodel B {}\n'),
    ])
    store.setNodePosition('model:schema.prisma:A', { x: 10, y: 20 })
    store.setNodePosition('model:schema.prisma:B', { x: 30, y: 40 })

    store.undo()
    expect(useEditorStore.getState().history.present.positions).toEqual({
      'model:schema.prisma:A': { x: 10, y: 20 },
    })
  })

  it('records each multi-node drag gesture as one history entry', () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('Batch drag history', [
      createVirtualSchemaFile('schema.prisma', 'model A {}\nmodel B {}\n'),
    ])
    const firstGesture = {
      'model:schema.prisma:A': { x: 10, y: 20 },
      'model:schema.prisma:B': { x: 30, y: 40 },
    }
    const secondGesture = {
      'model:schema.prisma:A': { x: 110, y: 120 },
      'model:schema.prisma:B': { x: 130, y: 140 },
    }

    store.setNodePositions(firstGesture, { reason: 'manual-drag' })
    store.setNodePositions(secondGesture, { reason: 'manual-drag' })

    expect(useEditorStore.getState().history.past).toHaveLength(2)
    store.undo()
    expect(useEditorStore.getState().history.present.positions).toEqual(firstGesture)
  })

  it('ignores missing and unchanged file updates', async () => {
    const store = useEditorStore.getState()
    store.openLocalFiles('No-op edits', [
      createVirtualSchemaFile('schema.prisma', 'model User {}\n'),
    ])
    const history = useEditorStore.getState().history

    await store.updateFileContent('missing.prisma', 'model Missing {}\n')
    await store.updateFileContent('schema.prisma', 'model User {}\n')

    expect(useEditorStore.getState().history).toBe(history)
  })
})

class StoreParserWorker {
  readonly requests: SchemaParserWorkerRequest[] = []
  readonly listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  removeEventListener(): void {}
  terminate(): void {}

  postMessage(request: SchemaParserWorkerRequest): void {
    this.requests.push(request)
  }

  respond(request: SchemaParserWorkerRequest): void {
    const response: SchemaParserWorkerResponse = {
      protocolVersion: SCHEMA_PARSER_PROTOCOL_VERSION,
      kind: 'parse-schema-project-result',
      editorSessionId: request.editorSessionId,
      projectId: request.projectId,
      revision: request.revision,
      result: parseSchemaProject(
        { revision: request.revision, files: request.files },
        parser,
      ),
    }
    this.listeners.get('message')?.({ data: response } as unknown as Event)
  }

  fail(message: string): void {
    this.listeners.get('error')?.({ message } as unknown as Event)
  }
}

const storeParserWorker = new StoreParserWorker()

function MockStoreWorker(): StoreParserWorker {
  return storeParserWorker
}

function loadedProject(
  id: string,
  source: string,
  positions: PersistedProjectInput['document']['positions'] = {},
): LoadedProject {
  return {
    project: {
      id,
      name: id,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      activeFilePath: 'schema.prisma',
    },
    document: {
      files: [createVirtualSchemaFile('schema.prisma', source)],
      positions,
    },
    layout: {
      projectId: id,
      positions,
      density: 'standard' as const,
      edgeStyle: 'smoothstep' as const,
      relationLabelMode: 'name' as const,
      layoutDirection: 'RIGHT' as const,
      relationNotation: 'crowfoot' as const,
      highlightRequiredFields: false,
    },
  }
}

async function settleParserResponse(request: SchemaParserWorkerRequest): Promise<void> {
  storeParserWorker.respond(request)
  await Promise.resolve()
  await Promise.resolve()
}

describe('editor session and visual rename integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    storeParserWorker.requests.length = 0
    vi.stubGlobal('Worker', MockStoreWorker)
    dbMocks.listPersistedProjects.mockReset().mockResolvedValue([])
    dbMocks.loadPersistedProject.mockReset()
    dbMocks.savePersistedProject.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetEditorStoreRuntime()
    vi.unstubAllGlobals()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('ignores pending A and old B responses across home and same-project reopen', async () => {
    dbMocks.loadPersistedProject.mockImplementation((id: string) =>
      Promise.resolve(
        loadedProject(id, id === 'project-a' ? 'model A {}\n' : 'model B {}\n'),
      ),
    )

    await useEditorStore.getState().openStoredProject('project-a')
    const requestA = storeParserWorker.requests.at(-1)
    if (!requestA) throw new Error('Missing project A parse')
    const sessionA = requestA.editorSessionId

    useEditorStore.getState().leaveWorkspace()
    await useEditorStore.getState().openStoredProject('project-b')
    const oldRequestB = storeParserWorker.requests.at(-1)
    if (!oldRequestB) throw new Error('Missing project B parse')
    await useEditorStore.getState().openStoredProject('project-b')
    const currentRequestB = storeParserWorker.requests.at(-1)
    if (!currentRequestB) throw new Error('Missing reopened project B parse')

    expect(sessionA).toBeLessThan(oldRequestB.editorSessionId)
    expect(oldRequestB.editorSessionId).toBeLessThan(currentRequestB.editorSessionId)
    await settleParserResponse(requestA)
    await settleParserResponse(oldRequestB)
    expect(useEditorStore.getState().parseState.status).toBe('parsing')

    await settleParserResponse(currentRequestB)
    expect(useEditorStore.getState().projectId).toBe('project-b')
    expect(
      useEditorStore.getState().parseState.lastValidSnapshot?.graph.declarations[0],
    ).toMatchObject({ name: 'B' })
    expect(useEditorStore.getState().initialLayoutCompleted).toBe(false)
    expect(useEditorStore.getState().layoutRequest).toMatchObject({
      reason: 'initial-confirmation',
      projectId: 'project-b',
      editorSessionId: currentRequestB.editorSessionId,
    })
  })

  it('exposes retryable parser failure without discarding the last valid snapshot', async () => {
    const store = useEditorStore.getState()
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}\n')]
    store.openLocalFiles('Parser recovery', files)
    const initialRequest = storeParserWorker.requests.at(-1)
    if (!initialRequest) throw new Error('Missing initial parser request')
    await settleParserResponse(initialRequest)
    const lastValidSnapshot = useEditorStore.getState().parseState.lastValidSnapshot

    void store.updateFileContent('schema.prisma', 'model Account {}\n')
    await vi.advanceTimersByTimeAsync(220)
    storeParserWorker.fail('parser crashed')
    await Promise.resolve()
    await Promise.resolve()

    expect(useEditorStore.getState().parseState).toMatchObject({
      status: 'error',
      failure: { message: 'parser crashed', retryable: true },
    })
    expect(useEditorStore.getState().parseState.lastValidSnapshot).toBe(
      lastValidSnapshot,
    )

    store.retryParse()
    const retryRequest = storeParserWorker.requests.at(-1)
    if (!retryRequest || retryRequest === initialRequest) {
      throw new Error('Missing retry parser request')
    }
    await settleParserResponse(retryRequest)
    expect(useEditorStore.getState().parseState.status).toBe('valid')
  })

  it('issues source navigation only for explicit selections across parse remapping', async () => {
    const store = useEditorStore.getState()
    const files = [
      createVirtualSchemaFile('schema.prisma', 'model User {\n  id Int @id\n}\n'),
      createVirtualSchemaFile('other.prisma', 'model Other {}\n'),
    ]
    store.openLocalFiles('Source navigation lifecycle', files)
    const initialParse = storeParserWorker.requests.at(-1)
    if (!initialParse) throw new Error('Missing initial parse')
    await settleParserResponse(initialParse)
    const user = model('User')
    const id = field(user, 'id')

    store.setSelectedField(user.id, id.id)
    const explicitSelection = useEditorStore.getState().sourceNavigationRequest
    expect(explicitSelection).toMatchObject({ id: 1, kind: 'selection' })

    store.setActiveFile('other.prisma')
    expect(useEditorStore.getState().sourceNavigationRequest).toBe(explicitSelection)
    void store.updateFileContent('schema.prisma', 'model Account {\n  id Int @id\n}\n')
    expect(useEditorStore.getState().sourceNavigationRequest).toBe(explicitSelection)

    await vi.advanceTimersByTimeAsync(220)
    const remapParse = storeParserWorker.requests.at(-1)
    if (!remapParse || remapParse === initialParse) {
      throw new Error('Missing remapping parse')
    }
    await settleParserResponse(remapParse)
    expect(useEditorStore.getState()).toMatchObject({
      selectedNodeId: 'model:schema.prisma:Account',
      selectedFieldId: 'field:model:schema.prisma:Account:id',
    })
    expect(useEditorStore.getState().sourceNavigationRequest).toBe(explicitSelection)

    store.setSelectedNode('model:schema.prisma:Account')
    expect(useEditorStore.getState().sourceNavigationRequest).toMatchObject({
      id: 2,
      kind: 'selection',
    })

    store.openLocalFiles('Next editor session', [
      createVirtualSchemaFile('schema.prisma', 'model Fresh {}\n'),
    ])
    expect(useEditorStore.getState()).toMatchObject({
      sourceNavigationRequestId: 0,
      sourceNavigationRequest: undefined,
    })
  })

  it('persists an atomic visual rename ID remap through parse, undo/redo and reopen', async () => {
    const projectId = 'project-rename'
    const userId = 'model:schema.prisma:User'
    const accountId = 'model:schema.prisma:Account'
    const userFieldId = `field:${userId}:id`
    const accountFieldId = `field:${accountId}:id`
    let persisted = loadedProject(projectId, 'model User {\n  id Int @id\n}\n', {
      [userId]: { x: 80, y: 120 },
    })
    dbMocks.loadPersistedProject.mockImplementation(() => Promise.resolve(persisted))
    dbMocks.savePersistedProject.mockImplementation((input: PersistedProjectInput) => {
      persisted = {
        ...persisted,
        document: input.document,
        layout: persisted.layout
          ? { ...persisted.layout, positions: input.document.positions }
          : undefined,
      }
      return Promise.resolve()
    })

    await useEditorStore.getState().openStoredProject(projectId)
    const initialParse = storeParserWorker.requests.at(-1)
    if (!initialParse) throw new Error('Missing initial parse')
    await settleParserResponse(initialParse)

    useEditorStore.getState().setSelectedField(userId, userFieldId)
    useEditorStore.getState().renameModel(userId, 'Account')
    expect(useEditorStore.getState().history.present.positions).toEqual({
      [accountId]: { x: 80, y: 120 },
    })
    await vi.advanceTimersByTimeAsync(220)
    const renameParse = storeParserWorker.requests.at(-1)
    if (!renameParse) throw new Error('Missing rename parse')
    await settleParserResponse(renameParse)
    expect(useEditorStore.getState()).toMatchObject({
      selectedNodeId: accountId,
      selectedFieldId: accountFieldId,
    })
    await useEditorStore.getState().flushPersistence()
    expect(persisted.document.positions).toEqual({
      [accountId]: { x: 80, y: 120 },
    })

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().history.present.positions).toEqual({
      [userId]: { x: 80, y: 120 },
    })
    const undoParse = storeParserWorker.requests.at(-1)
    if (!undoParse) throw new Error('Missing undo parse')
    await settleParserResponse(undoParse)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().history.present.positions).toEqual({
      [accountId]: { x: 80, y: 120 },
    })
    const redoParse = storeParserWorker.requests.at(-1)
    if (!redoParse) throw new Error('Missing redo parse')
    await settleParserResponse(redoParse)
    await useEditorStore.getState().flushPersistence()

    useEditorStore.getState().leaveWorkspace()
    await useEditorStore.getState().flushPersistence()
    await useEditorStore.getState().openStoredProject(projectId)
    const reopenParse = storeParserWorker.requests.at(-1)
    if (!reopenParse) throw new Error('Missing reopen parse')
    await settleParserResponse(reopenParse)
    expect(useEditorStore.getState().history.present.positions).toEqual({
      [accountId]: { x: 80, y: 120 },
    })
  })

  it('persists a conservative code-driven rename after async reconciliation', async () => {
    const projectId = 'project-code-rename'
    const userId = 'model:schema.prisma:User'
    const accountId = 'model:schema.prisma:Account'
    let persisted = loadedProject(projectId, 'model User {\n  id Int @id\n}\n', {
      [userId]: { x: 15, y: 25 },
    })
    dbMocks.loadPersistedProject.mockImplementation(() => Promise.resolve(persisted))
    dbMocks.savePersistedProject.mockImplementation((input: PersistedProjectInput) => {
      persisted = {
        ...persisted,
        document: input.document,
        layout: persisted.layout
          ? { ...persisted.layout, positions: input.document.positions }
          : undefined,
      }
      return Promise.resolve()
    })

    await useEditorStore.getState().openStoredProject(projectId)
    const initialParse = storeParserWorker.requests.at(-1)
    if (!initialParse) throw new Error('Missing initial parse')
    await settleParserResponse(initialParse)

    void useEditorStore
      .getState()
      .updateFileContent('schema.prisma', 'model Account {\n  id Int @id\n}\n')
    await vi.advanceTimersByTimeAsync(220)
    const renameParse = storeParserWorker.requests.at(-1)
    if (!renameParse) throw new Error('Missing code rename parse')
    await settleParserResponse(renameParse)
    await useEditorStore.getState().flushPersistence()

    expect(useEditorStore.getState().history.present.positions).toEqual({
      [accountId]: { x: 15, y: 25 },
    })
    expect(persisted.document.positions).toEqual({
      [accountId]: { x: 15, y: 25 },
    })
  })
})
