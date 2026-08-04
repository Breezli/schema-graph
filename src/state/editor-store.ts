import { toast } from 'sonner'
import { create } from 'zustand'

import {
  deletePersistedProject,
  listPersistedProjects,
  loadPersistedProject,
  loadSetting,
  prepareLocalProjectsExportDownload as preparePersistedProjectsExportDownload,
  savePersistedProject,
  saveSetting,
  type PersistedProjectInput,
  type PreparedLocalProjectsExportDownload,
  type ProjectRecord,
} from '@/db'
import {
  addFieldToModel,
  addModelToProject,
  addOneToManyRelation,
  createVirtualSchemaFile,
  deleteFieldFromProject,
  deleteModelFromProject,
  renameModelInProject,
  resolveParentListLogicalRelation,
  type ModelDeclaration,
  type SchemaField,
  type SchemaDeclaration,
  type SchemaMutationResult,
  type SchemaProjectSnapshot,
  type SourceRange,
  type VirtualSchemaFile,
  updateFieldInProject,
} from '@/domain/schema'
import { getProjectTemplate } from '@/features/projects'
import { SchemaParserWorkerClient } from '@/workers'

import {
  breakHistoryCoalescence,
  commitHistory,
  createHistory,
  redoHistory,
  type HistoryState,
  undoHistory,
} from './history'
import {
  applySchemaParseFailure,
  applySchemaWorkerResponse,
  beginSchemaParse,
  createSchemaSessionParseState,
  type SchemaSessionParseState,
} from './schema-session'
import { ProjectPersistenceCoordinator } from './persistence-coordinator'
import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_RELATION_NOTATION,
  resolveEdgeStyle,
  resolveRelationNotation,
  type EdgeStyle,
  type RelationNotation,
} from './editor-appearance'
import {
  placeNewDeclarationPositions,
  reconcileDeclarationPositionsDetailed,
} from './position-reconciliation'

export {
  DEFAULT_EDGE_STYLE,
  DEFAULT_RELATION_NOTATION,
  resolveEdgeStyle,
  resolveRelationNotation,
  type EdgeStyle,
  type RelationNotation,
} from './editor-appearance'

export interface CanvasPosition {
  readonly x: number
  readonly y: number
}

export interface EditorDocument {
  readonly files: readonly VirtualSchemaFile[]
  readonly positions: Readonly<Record<string, CanvasPosition>>
}

export type NodeDensity = 'overview' | 'standard' | 'full'
export type RelationLabelMode = 'none' | 'name' | 'full'
export type LayoutDirection = 'RIGHT' | 'DOWN'
export type MobileWorkspaceTab = 'code' | 'canvas' | 'properties'

export type LayoutRequestReason =
  'initial-confirmation' | 'direction-change' | 'explicit-auto-layout'

export interface LayoutRequest {
  readonly id: number
  readonly editorSessionId: number
  readonly projectId: string
  readonly graphRevision: number
  readonly reason: LayoutRequestReason
  readonly direction: LayoutDirection
}

export type PositionUpdateReason =
  | 'manual-drag'
  | 'derived-initial'
  | 'derived-direction'
  | 'derived-new'
  | 'reconcile'
  | 'explicit-auto-layout'

export interface PositionUpdateOptions {
  readonly reason: PositionUpdateReason
}

export type LayoutOutcome =
  | {
      readonly ok: true
      readonly editorSessionId: number
      readonly projectId: string
      readonly requestId: number
      readonly graphRevision: number
      readonly direction: LayoutDirection
      readonly positions:
        | Readonly<Record<string, CanvasPosition>>
        | readonly (CanvasPosition & { readonly id: string })[]
    }
  | {
      readonly ok: false
      readonly editorSessionId: number
      readonly projectId: string
      readonly requestId: number
      readonly graphRevision: number
      readonly direction: LayoutDirection
      readonly error?: unknown
    }

export interface UpdateFileContentOptions {
  readonly atomic?: boolean
  /** Deterministic event time used by bounded typing coalescence and tests. */
  readonly timestamp?: number
}

export interface CanvasFocusRequest {
  readonly nodeId: string
  readonly requestId: number
}

interface SourceNavigationRequestIdentity {
  readonly id: number
  readonly editorSessionId: number
  readonly consumedFilePaths: readonly string[]
}

export type SourceNavigationRequest = SourceNavigationRequestIdentity &
  (
    | {
        readonly kind: 'selection'
        readonly filePath?: string
        readonly range?: SourceRange
      }
    | {
        readonly kind: 'diagnostic'
        readonly filePath: string
        readonly range?: SourceRange
      }
  )

type SourceNavigationRequestInput =
  | {
      readonly kind: 'selection'
      readonly filePath?: string
      readonly range?: SourceRange
    }
  | {
      readonly kind: 'diagnostic'
      readonly filePath: string
      readonly range?: SourceRange
    }

export interface EditorStore {
  readonly view: 'home' | 'workspace'
  readonly editorSessionId: number
  readonly projectId?: string
  readonly projectName: string
  readonly history: HistoryState<EditorDocument>
  readonly parseState: SchemaSessionParseState
  readonly activeFilePath?: string
  readonly selectedNodeId?: string
  readonly selectedFieldId?: string
  readonly selectedEdgeId?: string
  readonly selectedEdgeAnchorFieldId?: string
  readonly canvasFocusRequest?: CanvasFocusRequest
  readonly sourceNavigationRequestId: number
  readonly sourceNavigationRequest?: SourceNavigationRequest
  readonly density: NodeDensity
  readonly edgeStyle: EdgeStyle
  readonly relationLabelMode: RelationLabelMode
  readonly relationNotation: RelationNotation
  readonly highlightRequiredFields: boolean
  readonly layoutDirection: LayoutDirection
  readonly layoutPromptOpen: boolean
  readonly layoutRequest?: LayoutRequest
  readonly initialLayoutCompleted: boolean
  readonly theme: 'light' | 'dark'
  readonly mobileTab: MobileWorkspaceTab
  readonly localProjects: readonly ProjectRecord[]
  readonly projectsHydrated: boolean
  readonly tourOpen: boolean
  readonly tourStep: number
  readonly tourEligible: boolean
  flushPersistence: () => Promise<void>
  /**
   * UI handoff: await this while preparing the export, then call
   * downloadPreparedLocalProjectsExport synchronously from the final user action.
   */
  prepareLocalProjectsExportDownload: (
    exportedAt?: Date,
  ) => Promise<PreparedLocalProjectsExportDownload>
  loadLocalProjects: () => Promise<void>
  openStoredProject: (projectId: string) => Promise<void>
  deleteLocalProject: (projectId: string) => Promise<void>
  openTemplate: (templateId: string) => void
  createBlankProject: (name?: string) => void
  openLocalFiles: (projectName: string, files: readonly VirtualSchemaFile[]) => void
  leaveWorkspace: () => void
  setActiveFile: (path: string) => void
  updateFileContent: (
    path: string,
    content: string,
    options?: UpdateFileContentOptions,
  ) => Promise<void>
  /** Re-runs the current source after a retryable parser worker failure. */
  retryParse: () => void
  setSelectedNode: (id?: string) => void
  focusNodeFromNavigation: (id: string) => void
  setSelectedField: (modelId: string, fieldId: string) => void
  selectFieldFromCanvas: (modelId: string, fieldId: string) => void
  setSelectedEdge: (id?: string, anchorFieldId?: string) => void
  navigateToDiagnostic: (filePath: string, range?: SourceRange) => void
  acknowledgeSourceNavigation: (requestId: number, filePath: string) => void
  setDensity: (density: NodeDensity) => void
  setEdgeStyle: (style: EdgeStyle) => void
  setRelationLabelMode: (mode: RelationLabelMode) => void
  setRelationNotation: (notation: RelationNotation) => void
  setHighlightRequiredFields: (enabled: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setMobileTab: (tab: MobileWorkspaceTab) => void
  confirmLayoutDirection: (direction: LayoutDirection) => void
  setLayoutDirection: (direction: LayoutDirection) => void
  requestAutoLayout: () => void
  applyLayoutOutcome: (outcome: LayoutOutcome) => boolean
  loadOnboardingState: () => Promise<void>
  openTour: () => void
  closeTour: () => void
  nextTourStep: () => void
  previousTourStep: () => void
  setNodePosition: (
    id: string,
    position: CanvasPosition,
    options?: PositionUpdateOptions,
  ) => void
  setNodePositions: (
    positions: Readonly<Record<string, CanvasPosition>>,
    options?: PositionUpdateOptions,
  ) => void
  addModel: (name: string, filePath?: string) => void
  renameModel: (modelId: string, name: string) => void
  addField: (modelId: string, name: string, typeName?: string) => void
  updateField: (
    modelId: string,
    fieldId: string,
    patch: { readonly name?: string; readonly typeName?: string },
  ) => void
  deleteField: (modelId: string, fieldId: string) => void
  deleteModel: (modelId: string) => void
  connectModels: (
    sourceModelId: string,
    targetModelId: string,
    sourceFieldId?: string,
  ) => void
  undo: () => void
  redo: () => void
}

let parserClient: SchemaParserWorkerClient | undefined
let parseTimer: ReturnType<typeof setTimeout> | undefined
let persistenceTimer: ReturnType<typeof setTimeout> | undefined
let layoutRequestId = 0
let editorSessionId = 0

const persistenceCoordinator = new ProjectPersistenceCoordinator<PersistedProjectInput>(
  {
    save: savePersistedProject,
    onFailure: (_projectId, error) => {
      toast.error('本地项目保存失败', { description: error.message })
    },
  },
)

/** Test/session cleanup seam for module-owned workers, timers and persistence queues. */
export function resetEditorStoreRuntime(): void {
  if (parseTimer) clearTimeout(parseTimer)
  if (persistenceTimer) clearTimeout(persistenceTimer)
  parseTimer = undefined
  persistenceTimer = undefined
  const resetSessionId = ++editorSessionId
  useEditorStore.setState({
    view: 'home',
    editorSessionId: resetSessionId,
    projectId: undefined,
    projectName: '未命名项目',
    history: createHistory<EditorDocument>({ files: [], positions: {} }),
    parseState: createSchemaSessionParseState([], {
      editorSessionId: resetSessionId,
    }),
    activeFilePath: undefined,
    selectedNodeId: undefined,
    selectedFieldId: undefined,
    selectedEdgeId: undefined,
    selectedEdgeAnchorFieldId: undefined,
    canvasFocusRequest: undefined,
    sourceNavigationRequestId: 0,
    sourceNavigationRequest: undefined,
    layoutPromptOpen: false,
    layoutRequest: undefined,
    initialLayoutCompleted: false,
    tourOpen: false,
    tourStep: 0,
    tourEligible: false,
  })
  parserClient?.dispose()
  parserClient = undefined
  persistenceCoordinator.reset()
  layoutRequestId = 0
}

function getParserClient(): SchemaParserWorkerClient | undefined {
  if (typeof Worker === 'undefined') return undefined
  parserClient ??= new SchemaParserWorkerClient()
  return parserClient
}

const emptyDocument: EditorDocument = { files: [], positions: {} }

function projectFilesFromTemplate(templateId: string): readonly VirtualSchemaFile[] {
  const template = getProjectTemplate(templateId)
  if (!template) return []
  return template.files.map((file) => createVirtualSchemaFile(file.path, file.content))
}

export const useEditorStore = create<EditorStore>((set, get) => {
  async function refreshLocalProjects(): Promise<void> {
    const localProjects = await listPersistedProjects()
    set({ localProjects, projectsHydrated: true })
  }

  function capturePersistence(): Promise<void> | undefined {
    const state = get()
    if (!state.projectId || !state.history.present.files.length) return undefined
    return persistenceCoordinator.enqueue({
      projectId: state.projectId,
      value: {
        id: state.projectId,
        name: state.projectName,
        document: state.history.present,
        activeFilePath: state.activeFilePath,
        density: state.density,
        edgeStyle: state.edgeStyle,
        relationLabelMode: state.relationLabelMode,
        layoutDirection: state.layoutDirection,
        relationNotation: state.relationNotation,
        highlightRequiredFields: state.highlightRequiredFields,
      },
    })
  }

  function schedulePersistence(delay = 420): Promise<void> {
    const captured = capturePersistence()
    if (!captured) return Promise.resolve()
    if (persistenceTimer) clearTimeout(persistenceTimer)
    persistenceTimer = setTimeout(() => {
      persistenceTimer = undefined
      void persistenceCoordinator.drainQueued().then(() => {
        void refreshLocalProjects().catch(() => undefined)
      })
    }, delay)
    return captured
  }

  async function flushPersistence(): Promise<void> {
    if (persistenceTimer) {
      clearTimeout(persistenceTimer)
      persistenceTimer = undefined
    }
    await persistenceCoordinator.flush()
    await refreshLocalProjects().catch(() => undefined)
  }

  function startEditorSession(): number {
    const previousSessionId = get().editorSessionId
    if (parseTimer) {
      clearTimeout(parseTimer)
      parseTimer = undefined
    }
    parserClient?.cancelSession(previousSessionId)
    const nextSessionId = ++editorSessionId
    parserClient?.startSession(nextSessionId)
    set({
      editorSessionId: nextSessionId,
      sourceNavigationRequestId: 0,
      sourceNavigationRequest: undefined,
    })
    return nextSessionId
  }

  function createSourceNavigationRequest(
    state: EditorStore,
    request: SourceNavigationRequestInput,
  ): Pick<EditorStore, 'sourceNavigationRequestId' | 'sourceNavigationRequest'> {
    const id = state.sourceNavigationRequestId + 1
    return {
      sourceNavigationRequestId: id,
      sourceNavigationRequest: {
        id,
        editorSessionId: state.editorSessionId,
        consumedFilePaths: [],
        ...request,
      },
    }
  }

  function createLayoutRequest(
    state: EditorStore,
    reason: LayoutRequestReason,
    direction = state.layoutDirection,
  ): LayoutRequest | undefined {
    const graphRevision = state.parseState.lastValidSnapshot?.revision
    if (!state.projectId || graphRevision === undefined) return undefined
    return {
      id: ++layoutRequestId,
      editorSessionId: state.editorSessionId,
      projectId: state.projectId,
      graphRevision,
      reason,
      direction,
    }
  }

  function remapPositions(
    positions: EditorDocument['positions'],
    remap: Readonly<Record<string, string>>,
  ): EditorDocument['positions'] {
    let next: Record<string, CanvasPosition> | undefined
    for (const [oldId, newId] of Object.entries(remap)) {
      const position = positions[oldId]
      if (!position || oldId === newId) continue
      next ??= { ...positions }
      if (!(newId in next)) next[newId] = position
      delete next[oldId]
    }
    return next ?? positions
  }

  function remapValidSelections(
    state: EditorStore,
    previousSnapshot: SchemaProjectSnapshot | undefined,
    nextSnapshot: SchemaProjectSnapshot,
    declarationIdRemap: Readonly<Record<string, string>>,
  ): Partial<EditorStore> {
    const declarations = nextSnapshot.graph.declarations.filter(
      (entry): entry is Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }> =>
        entry.kind !== 'commentBlock',
    )
    const declarationIds = new Set(declarations.map((entry) => entry.id))
    const nextNodeId = state.selectedNodeId
      ? declarationIds.has(state.selectedNodeId)
        ? state.selectedNodeId
        : declarationIdRemap[state.selectedNodeId]
      : undefined

    let nextFieldId = state.selectedFieldId
    if (nextFieldId) {
      const fieldExists = declarations.some(
        (entry) =>
          'members' in entry &&
          entry.members.some(
            (member) => member.kind === 'field' && member.id === nextFieldId,
          ),
      )
      if (!fieldExists && previousSnapshot) {
        const previousOwner = previousSnapshot.graph.declarations.find(
          (entry): entry is ModelDeclaration =>
            (entry.kind === 'model' ||
              entry.kind === 'view' ||
              entry.kind === 'type') &&
            entry.members.some(
              (member) => member.kind === 'field' && member.id === nextFieldId,
            ),
        )
        const previousField = previousOwner?.members.find(
          (member): member is SchemaField =>
            member.kind === 'field' && member.id === nextFieldId,
        )
        const nextOwnerId = previousOwner
          ? (declarationIdRemap[previousOwner.id] ?? previousOwner.id)
          : undefined
        const nextOwner = declarations.find(
          (entry): entry is ModelDeclaration =>
            (entry.kind === 'model' ||
              entry.kind === 'view' ||
              entry.kind === 'type') &&
            entry.id === nextOwnerId,
        )
        nextFieldId = nextOwner?.members.find(
          (member): member is SchemaField =>
            member.kind === 'field' && member.name === previousField?.name,
        )?.id
      } else if (!fieldExists) {
        nextFieldId = undefined
      }
    }

    let nextEdgeId = state.selectedEdgeId
    if (
      nextEdgeId &&
      !nextSnapshot.graph.logicalRelations.some(
        (relation) => relation.id === nextEdgeId,
      )
    ) {
      const previousRelation = previousSnapshot?.graph.logicalRelations.find(
        (relation) => relation.id === nextEdgeId,
      )
      nextEdgeId = previousRelation
        ? nextSnapshot.graph.logicalRelations.find((relation) => {
            const previousEndpoints = [
              declarationIdRemap[previousRelation.source.modelId] ??
                previousRelation.source.modelId,
              declarationIdRemap[previousRelation.target.modelId] ??
                previousRelation.target.modelId,
            ].sort()
            return (
              [relation.source.modelId, relation.target.modelId].sort().join('\0') ===
                previousEndpoints.join('\0') && relation.name === previousRelation.name
            )
          })?.id
        : undefined
    }

    const selectedRelation = nextEdgeId
      ? nextSnapshot.graph.logicalRelations.find(
          (relation) => relation.id === nextEdgeId,
        )
      : undefined
    let nextAnchorId = state.selectedEdgeAnchorFieldId
    if (
      nextAnchorId &&
      (!selectedRelation ||
        ![
          ...selectedRelation.source.fieldIds,
          ...selectedRelation.target.fieldIds,
        ].includes(nextAnchorId))
    ) {
      nextAnchorId = undefined
    }

    const focusNodeId = state.canvasFocusRequest?.nodeId
    const nextFocusNodeId = focusNodeId
      ? declarationIds.has(focusNodeId)
        ? focusNodeId
        : declarationIdRemap[focusNodeId]
      : undefined

    return {
      selectedNodeId:
        nextNodeId && declarationIds.has(nextNodeId) ? nextNodeId : undefined,
      selectedFieldId: nextFieldId,
      selectedEdgeId: nextEdgeId,
      selectedEdgeAnchorFieldId: nextAnchorId,
      canvasFocusRequest:
        state.canvasFocusRequest &&
        nextFocusNodeId &&
        declarationIds.has(nextFocusNodeId)
          ? { ...state.canvasFocusRequest, nodeId: nextFocusNodeId }
          : undefined,
    }
  }

  function scheduleParse(files: readonly VirtualSchemaFile[], immediate = false): void {
    const editorState = get()
    if (!editorState.projectId || editorState.view !== 'workspace') return
    const currentState = editorState.parseState
    const nextState = beginSchemaParse(currentState, files)
    const identity = {
      editorSessionId: nextState.editorSessionId,
      projectId: nextState.projectId ?? '',
      revision: nextState.sourceRevision,
    }
    set({ parseState: nextState })

    if (parseTimer) clearTimeout(parseTimer)
    const execute = (): void => {
      const client = getParserClient()
      if (!client) {
        set((state) => ({
          parseState: applySchemaParseFailure(
            state.parseState,
            identity,
            new Error('当前环境不支持 Schema Parser Worker。'),
          ),
        }))
        return
      }
      void client
        .parse(identity, files)
        .then((response) => {
          let positionsChanged = false
          set((state) => {
            const parseState = applySchemaWorkerResponse(state.parseState, response)
            const previousSnapshot = state.parseState.lastValidSnapshot
            const nextSnapshot = parseState.lastValidSnapshot
            if (
              parseState === state.parseState ||
              parseState.status !== 'valid' ||
              !nextSnapshot ||
              nextSnapshot === previousSnapshot
            ) {
              return { parseState }
            }

            const reconciliation = reconcileDeclarationPositionsDetailed(
              previousSnapshot,
              nextSnapshot,
              state.history.present.positions,
            )
            const positions =
              Object.keys(reconciliation.positions).length > 0 ||
              state.initialLayoutCompleted
                ? placeNewDeclarationPositions(
                    nextSnapshot,
                    reconciliation.positions,
                    reconciliation.newDeclarationIds,
                    state.layoutDirection,
                  )
                : reconciliation.positions
            positionsChanged = positions !== state.history.present.positions
            const selection = remapValidSelections(
              state,
              previousSnapshot,
              nextSnapshot,
              reconciliation.declarationIdRemap,
            )
            const shouldRequestInitialLayout =
              !state.initialLayoutCompleted &&
              !state.layoutPromptOpen &&
              Object.keys(state.history.present.positions).length === 0
            const pendingReason = state.layoutRequest?.reason
            const shouldSupersedeLayout =
              state.layoutRequest !== undefined &&
              state.layoutRequest.graphRevision !== nextSnapshot.revision
            const layoutRequest = shouldRequestInitialLayout
              ? createLayoutRequest(
                  { ...state, parseState } as EditorStore,
                  'initial-confirmation',
                )
              : shouldSupersedeLayout && pendingReason
                ? createLayoutRequest(
                    { ...state, parseState } as EditorStore,
                    pendingReason,
                    state.layoutRequest?.direction,
                  )
                : state.layoutRequest
            return {
              parseState,
              ...selection,
              layoutRequest,
              ...(positionsChanged
                ? {
                    history: {
                      ...state.history,
                      present: { ...state.history.present, positions },
                    },
                  }
                : {}),
            }
          })
          if (positionsChanged) void schedulePersistence()
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          set((state) => ({
            parseState: applySchemaParseFailure(state.parseState, identity, error),
          }))
          if (!message.includes('取代') && !message.includes('已取消')) {
            toast.error('Schema 解析失败', { description: message })
          }
        })
    }

    if (immediate) execute()
    else parseTimer = setTimeout(execute, 220)
  }

  function openProject(
    projectId: string,
    projectName: string,
    files: readonly VirtualSchemaFile[],
    options: {
      readonly positions?: EditorDocument['positions']
      readonly activeFilePath?: string
      readonly density?: NodeDensity
      readonly edgeStyle?: EdgeStyle
      readonly relationLabelMode?: RelationLabelMode
      readonly relationNotation?: RelationNotation
      readonly highlightRequiredFields?: boolean
      readonly layoutDirection?: LayoutDirection
      readonly askLayoutDirection?: boolean
      readonly editorSessionId?: number
    } = {},
  ): void {
    const sessionId = options.editorSessionId ?? startEditorSession()
    if (options.editorSessionId !== undefined) parserClient?.startSession(sessionId)
    const document: EditorDocument = { files, positions: options.positions ?? {} }
    const hasStoredPositions = Object.keys(document.positions).length > 0
    set({
      view: 'workspace',
      editorSessionId: sessionId,
      projectId,
      projectName,
      history: createHistory(document),
      parseState: createSchemaSessionParseState(files, {
        editorSessionId: sessionId,
        projectId,
      }),
      activeFilePath: options.activeFilePath ?? files[0]?.path,
      selectedNodeId: undefined,
      selectedFieldId: undefined,
      selectedEdgeId: undefined,
      selectedEdgeAnchorFieldId: undefined,
      canvasFocusRequest: undefined,
      sourceNavigationRequestId: 0,
      sourceNavigationRequest: undefined,
      density: options.density ?? 'standard',
      edgeStyle: resolveEdgeStyle(options.edgeStyle),
      relationLabelMode: options.relationLabelMode ?? 'name',
      relationNotation: resolveRelationNotation(options.relationNotation),
      highlightRequiredFields: options.highlightRequiredFields ?? false,
      layoutDirection: options.layoutDirection ?? 'RIGHT',
      layoutPromptOpen: options.askLayoutDirection ?? true,
      layoutRequest: undefined,
      initialLayoutCompleted: hasStoredPositions,
      mobileTab: 'canvas',
      tourOpen: false,
      tourStep: 0,
      tourEligible: false,
    })
    scheduleParse(files, true)
    schedulePersistence(80)
  }

  function commitFiles(
    files: readonly VirtualSchemaFile[],
    coalesceKey?: string,
    timestamp?: number,
  ): Promise<void> {
    const state = get()
    const nextDocument: EditorDocument = {
      ...state.history.present,
      files,
    }
    set({
      history: commitHistory(state.history, nextDocument, {
        coalesceKey,
        timestamp,
      }),
    })
    scheduleParse(files)
    return schedulePersistence()
  }

  function applyMutation(result: SchemaMutationResult): void {
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    const state = get()
    const positions = result.declarationIdRemap
      ? remapPositions(state.history.present.positions, result.declarationIdRemap)
      : state.history.present.positions
    const nextDocument: EditorDocument = { files: result.files, positions }
    const selectedNodeId = state.selectedNodeId
      ? (result.declarationIdRemap?.[state.selectedNodeId] ?? state.selectedNodeId)
      : undefined
    set({
      history: commitHistory(state.history, nextDocument),
      selectedNodeId,
      canvasFocusRequest:
        state.canvasFocusRequest && result.declarationIdRemap
          ? {
              ...state.canvasFocusRequest,
              nodeId:
                result.declarationIdRemap[state.canvasFocusRequest.nodeId] ??
                state.canvasFocusRequest.nodeId,
            }
          : state.canvasFocusRequest,
    })
    scheduleParse(result.files)
    void schedulePersistence()
    toast.success('Schema 已更新')
  }

  function historyAfterFileSwitch(
    state: EditorStore,
    nextPath: string | undefined,
  ): HistoryState<EditorDocument> {
    return nextPath === state.activeFilePath
      ? state.history
      : breakHistoryCoalescence(state.history)
  }

  function validSnapshot(): SchemaProjectSnapshot | undefined {
    const parseState = get().parseState
    if (parseState.status !== 'valid') {
      toast.warning('请先修复代码错误', {
        description: '当前画布保留最后一次有效结构，结构编辑已暂停。',
      })
      return undefined
    }
    return parseState.lastValidSnapshot
  }

  return {
    view: 'home',
    editorSessionId: 0,
    projectName: '未命名项目',
    history: createHistory(emptyDocument),
    parseState: createSchemaSessionParseState(),
    sourceNavigationRequestId: 0,
    density: 'standard',
    edgeStyle: DEFAULT_EDGE_STYLE,
    relationLabelMode: 'name',
    relationNotation: DEFAULT_RELATION_NOTATION,
    highlightRequiredFields: false,
    layoutDirection: 'RIGHT',
    layoutPromptOpen: false,
    initialLayoutCompleted: false,
    theme: 'dark',
    mobileTab: 'canvas',
    localProjects: [],
    projectsHydrated: false,
    tourOpen: false,
    tourStep: 0,
    tourEligible: false,

    flushPersistence,

    async prepareLocalProjectsExportDownload(exportedAt) {
      await flushPersistence()
      return preparePersistedProjectsExportDownload(exportedAt)
    },

    async loadLocalProjects() {
      const [savedTheme] = await Promise.all([
        loadSetting('theme'),
        refreshLocalProjects(),
      ])
      if (savedTheme === 'light' || savedTheme === 'dark') {
        document.documentElement.dataset.theme = savedTheme
        set({ theme: savedTheme })
      }
    },

    async openStoredProject(projectId) {
      const sessionId = startEditorSession()
      const loaded = await loadPersistedProject(projectId)
      if (get().editorSessionId !== sessionId) return
      if (!loaded) {
        toast.error('找不到这个本地项目')
        await refreshLocalProjects()
        return
      }
      openProject(loaded.project.id, loaded.project.name, loaded.document.files, {
        positions: loaded.document.positions,
        activeFilePath: loaded.project.activeFilePath,
        density: loaded.layout?.density,
        edgeStyle: loaded.layout?.edgeStyle,
        relationLabelMode: loaded.layout?.relationLabelMode,
        relationNotation: loaded.layout?.relationNotation,
        highlightRequiredFields: loaded.layout?.highlightRequiredFields,
        layoutDirection: loaded.layout?.layoutDirection,
        askLayoutDirection: false,
        editorSessionId: sessionId,
      })
    },

    async deleteLocalProject(projectId) {
      persistenceCoordinator.tombstone(projectId)
      await persistenceCoordinator.settleProject(projectId)
      await deletePersistedProject(projectId)
      await refreshLocalProjects()
      toast.success('本地项目已删除')
    },

    openTemplate(templateId) {
      const template = getProjectTemplate(templateId)
      if (!template) return
      openProject(
        `local-${template.id}-${Date.now()}`,
        template.name,
        projectFilesFromTemplate(template.id),
      )
    },

    createBlankProject(name = '未命名 Schema') {
      openProject(`local-${Date.now()}`, name, [
        createVirtualSchemaFile(
          'schema.prisma',
          `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`,
        ),
      ])
    },

    openLocalFiles(projectName, files) {
      openProject(`local-${Date.now()}`, projectName, files)
    },

    leaveWorkspace() {
      schedulePersistence(0)
      void flushPersistence().catch(() => undefined)
      const sessionId = startEditorSession()
      set({
        view: 'home',
        editorSessionId: sessionId,
        projectId: undefined,
        layoutRequest: undefined,
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        selectedEdgeId: undefined,
        selectedEdgeAnchorFieldId: undefined,
        tourOpen: false,
      })
      void refreshLocalProjects()
    },

    setActiveFile(path) {
      set((state) => ({
        activeFilePath: path,
        history:
          path === state.activeFilePath
            ? state.history
            : breakHistoryCoalescence(state.history),
      }))
      schedulePersistence()
    },

    updateFileContent(path, content, options) {
      const currentFiles = get().history.present.files
      const currentFile = currentFiles.find((file) => file.path === path)
      if (!currentFile || currentFile.content === content) return Promise.resolve()
      const files = currentFiles.map((file) =>
        file.path === path ? { ...file, content } : file,
      )
      return commitFiles(
        files,
        options?.atomic ? undefined : `code:${path}`,
        options?.timestamp,
      )
    },

    retryParse() {
      const state = get()
      if (state.view !== 'workspace' || !state.projectId) return
      scheduleParse(state.history.present.files, true)
    },

    setSelectedNode(id) {
      const state = get()
      const declaration = state.parseState.lastValidSnapshot?.graph.declarations.find(
        (entry) => entry.kind !== 'commentBlock' && entry.id === id,
      )
      const activeFilePath =
        declaration && declaration.kind !== 'commentBlock'
          ? declaration.source.filePath
          : state.activeFilePath
      set({
        selectedNodeId: id,
        selectedFieldId: undefined,
        selectedEdgeId: undefined,
        selectedEdgeAnchorFieldId: undefined,
        activeFilePath,
        history: historyAfterFileSwitch(state, activeFilePath),
        ...(declaration
          ? createSourceNavigationRequest(state, { kind: 'selection' })
          : {}),
      })
      schedulePersistence()
    },

    focusNodeFromNavigation(id) {
      get().setSelectedNode(id)
      set((state) => ({
        canvasFocusRequest: {
          nodeId: id,
          requestId: (state.canvasFocusRequest?.requestId ?? 0) + 1,
        },
      }))
    },

    setSelectedField(modelId, fieldId) {
      const state = get()
      const declaration = state.parseState.lastValidSnapshot?.graph.declarations.find(
        (entry): entry is ModelDeclaration =>
          (entry.kind === 'model' || entry.kind === 'view' || entry.kind === 'type') &&
          entry.id === modelId,
      )
      const field = declaration?.members.find(
        (member): member is SchemaField =>
          member.kind === 'field' && member.id === fieldId,
      )
      const activeFilePath = field?.source.filePath ?? state.activeFilePath
      set({
        selectedNodeId: modelId,
        selectedFieldId: fieldId,
        selectedEdgeId: undefined,
        selectedEdgeAnchorFieldId: undefined,
        activeFilePath,
        history: historyAfterFileSwitch(state, activeFilePath),
        ...(field ? createSourceNavigationRequest(state, { kind: 'selection' }) : {}),
      })
      schedulePersistence()
    },

    selectFieldFromCanvas(modelId, fieldId) {
      const state = get()
      const snapshot = state.parseState.lastValidSnapshot
      const relation = snapshot
        ? resolveParentListLogicalRelation(snapshot.graph, modelId, fieldId)
        : undefined
      if (!relation) {
        state.setSelectedField(modelId, fieldId)
        return
      }

      const declaration = snapshot?.graph.declarations.find(
        (entry): entry is ModelDeclaration =>
          (entry.kind === 'model' || entry.kind === 'view' || entry.kind === 'type') &&
          entry.id === modelId,
      )
      const field = declaration?.members.find(
        (member): member is SchemaField =>
          member.kind === 'field' && member.id === fieldId,
      )
      const activeFilePath = field?.source.filePath ?? state.activeFilePath
      set({
        selectedEdgeId: relation.id,
        selectedEdgeAnchorFieldId: fieldId,
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        activeFilePath,
        history: historyAfterFileSwitch(state, activeFilePath),
        ...createSourceNavigationRequest(state, { kind: 'selection' }),
      })
      schedulePersistence()
    },

    setSelectedEdge(id, anchorFieldId) {
      const state = get()
      const relation = state.parseState.lastValidSnapshot?.graph.logicalRelations.find(
        (entry) => entry.id === id,
      )
      const validAnchorFieldId =
        relation &&
        anchorFieldId &&
        [...relation.source.fieldIds, ...relation.target.fieldIds].includes(
          anchorFieldId,
        )
          ? anchorFieldId
          : undefined
      const anchorField = validAnchorFieldId
        ? state.parseState.lastValidSnapshot?.graph.declarations
            .filter(
              (entry): entry is ModelDeclaration =>
                entry.kind === 'model' ||
                entry.kind === 'view' ||
                entry.kind === 'type',
            )
            .flatMap((entry) => entry.members)
            .find(
              (member): member is SchemaField =>
                member.kind === 'field' && member.id === validAnchorFieldId,
            )
        : undefined
      const activeFilePath =
        anchorField?.source.filePath ??
        relation?.source.sources[0]?.filePath ??
        state.activeFilePath
      set({
        selectedEdgeId: id,
        selectedEdgeAnchorFieldId: id ? validAnchorFieldId : undefined,
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        activeFilePath,
        history: historyAfterFileSwitch(state, activeFilePath),
        ...(relation
          ? createSourceNavigationRequest(state, { kind: 'selection' })
          : {}),
      })
      schedulePersistence()
    },

    navigateToDiagnostic(filePath, range) {
      const state = get()
      set({
        activeFilePath: filePath,
        history: historyAfterFileSwitch(state, filePath),
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        selectedEdgeId: undefined,
        selectedEdgeAnchorFieldId: undefined,
        canvasFocusRequest: undefined,
        ...createSourceNavigationRequest(state, {
          kind: 'diagnostic',
          filePath,
          range,
        }),
      })
      schedulePersistence()
    },

    acknowledgeSourceNavigation(requestId, filePath) {
      set((state) => {
        const request = state.sourceNavigationRequest
        if (
          !request ||
          request.id !== requestId ||
          request.editorSessionId !== state.editorSessionId ||
          (request.kind === 'diagnostic' && request.filePath !== filePath) ||
          request.consumedFilePaths.includes(filePath)
        ) {
          return state
        }
        return {
          sourceNavigationRequest: {
            ...request,
            consumedFilePaths: [...request.consumedFilePaths, filePath],
          },
        }
      })
    },

    setDensity(density) {
      set({ density })
      schedulePersistence()
    },

    setEdgeStyle(edgeStyle) {
      set({ edgeStyle })
      schedulePersistence()
    },

    setRelationLabelMode(relationLabelMode) {
      set({ relationLabelMode })
      schedulePersistence()
    },

    setRelationNotation(relationNotation) {
      set({ relationNotation })
      schedulePersistence()
    },

    setHighlightRequiredFields(highlightRequiredFields) {
      set({ highlightRequiredFields })
      schedulePersistence()
    },

    setTheme(theme) {
      document.documentElement.dataset.theme = theme
      set({ theme })
      void saveSetting('theme', theme)
    },

    setMobileTab(mobileTab) {
      set({ mobileTab })
    },

    confirmLayoutDirection(layoutDirection) {
      set((state) => ({
        layoutDirection,
        layoutPromptOpen: false,
        layoutRequest: createLayoutRequest(
          state,
          state.initialLayoutCompleted ? 'direction-change' : 'initial-confirmation',
          layoutDirection,
        ),
        tourOpen: state.tourEligible,
        tourStep: state.tourEligible ? 0 : state.tourStep,
      }))
      schedulePersistence()
    },

    setLayoutDirection(layoutDirection) {
      const state = get()
      if (state.layoutDirection === layoutDirection) return
      set({
        layoutDirection,
        layoutRequest: createLayoutRequest(state, 'direction-change', layoutDirection),
      })
      schedulePersistence()
    },

    requestAutoLayout() {
      const state = get()
      set({
        layoutRequest: createLayoutRequest(state, 'explicit-auto-layout'),
      })
    },

    applyLayoutOutcome(outcome) {
      let applied = false
      let positionsChanged = false
      set((state) => {
        const request = state.layoutRequest
        if (
          !request ||
          request.id !== outcome.requestId ||
          request.editorSessionId !== outcome.editorSessionId ||
          request.projectId !== outcome.projectId ||
          request.graphRevision !== outcome.graphRevision ||
          request.direction !== outcome.direction ||
          state.editorSessionId !== outcome.editorSessionId ||
          state.projectId !== outcome.projectId ||
          state.parseState.lastValidSnapshot?.revision !== outcome.graphRevision ||
          state.layoutDirection !== outcome.direction
        ) {
          return state
        }
        applied = true
        if (!outcome.ok) return { layoutRequest: undefined }

        const positions = Array.isArray(outcome.positions)
          ? Object.fromEntries(
              outcome.positions.map(({ id, x, y }) => [id, { x, y }] as const),
            )
          : outcome.positions
        positionsChanged = positions !== state.history.present.positions
        const nextDocument: EditorDocument = { ...state.history.present, positions }
        const history =
          request.reason === 'explicit-auto-layout'
            ? commitHistory(state.history, nextDocument)
            : { ...state.history, present: nextDocument }
        return {
          history,
          layoutRequest: undefined,
          initialLayoutCompleted: true,
        }
      })
      if (applied && positionsChanged) void schedulePersistence()
      return applied
    },

    async loadOnboardingState() {
      const completed = (await loadSetting('onboardingCompleted')) === 'true'
      const state = get()
      set({
        tourEligible: !completed,
        tourOpen: !completed && state.view === 'workspace' && !state.layoutPromptOpen,
        tourStep: 0,
      })
    },

    openTour() {
      set({ tourOpen: true, tourStep: 0 })
    },

    closeTour() {
      set({ tourOpen: false, tourEligible: false })
      void saveSetting('onboardingCompleted', 'true')
    },

    nextTourStep() {
      const state = get()
      if (state.tourStep >= 6) {
        state.closeTour()
        return
      }
      set({ tourStep: state.tourStep + 1 })
    },

    previousTourStep() {
      set((state) => ({ tourStep: Math.max(0, state.tourStep - 1) }))
    },

    setNodePosition(id, position, options = { reason: 'manual-drag' }) {
      const state = get()
      const current = state.history.present.positions[id]
      if (current?.x === position.x && current.y === position.y) return
      const nextDocument: EditorDocument = {
        ...state.history.present,
        positions: { ...state.history.present.positions, [id]: position },
      }
      const recordsHistory =
        options.reason === 'manual-drag' || options.reason === 'explicit-auto-layout'
      set({
        history: recordsHistory
          ? commitHistory(state.history, nextDocument)
          : { ...state.history, present: nextDocument },
      })
      void schedulePersistence()
    },

    setNodePositions(positions, options = { reason: 'explicit-auto-layout' }) {
      const state = get()
      if (positions === state.history.present.positions) return
      const nextDocument: EditorDocument = { ...state.history.present, positions }
      const recordsHistory =
        options.reason === 'manual-drag' || options.reason === 'explicit-auto-layout'
      set({
        history: recordsHistory
          ? commitHistory(state.history, nextDocument)
          : { ...state.history, present: nextDocument },
      })
      void schedulePersistence()
    },

    addModel(name, filePath) {
      const snapshot = validSnapshot()
      if (!snapshot) return
      applyMutation(
        addModelToProject(
          snapshot,
          filePath ?? get().activeFilePath ?? Object.keys(snapshot.files)[0] ?? '',
          name,
        ),
      )
    },

    renameModel(modelId, name) {
      const snapshot = validSnapshot()
      if (snapshot) applyMutation(renameModelInProject(snapshot, modelId, name))
    },

    addField(modelId, name, typeName = 'String') {
      const snapshot = validSnapshot()
      if (snapshot) applyMutation(addFieldToModel(snapshot, modelId, name, typeName))
    },

    updateField(modelId, fieldId, patch) {
      const snapshot = validSnapshot()
      if (snapshot)
        applyMutation(updateFieldInProject(snapshot, modelId, fieldId, patch))
    },

    deleteField(modelId, fieldId) {
      const snapshot = validSnapshot()
      if (snapshot) applyMutation(deleteFieldFromProject(snapshot, modelId, fieldId))
    },

    deleteModel(modelId) {
      const snapshot = validSnapshot()
      if (snapshot) applyMutation(deleteModelFromProject(snapshot, modelId))
    },

    connectModels(sourceModelId, targetModelId, sourceFieldId) {
      const snapshot = validSnapshot()
      if (snapshot)
        applyMutation(
          addOneToManyRelation(snapshot, sourceModelId, targetModelId, sourceFieldId),
        )
    },

    undo() {
      const history = undoHistory(get().history)
      if (history === get().history) return
      set({ history })
      scheduleParse(history.present.files, true)
      schedulePersistence()
    },

    redo() {
      const history = redoHistory(get().history)
      if (history === get().history) return
      set({ history })
      scheduleParse(history.present.files, true)
      schedulePersistence()
    },
  }
})
