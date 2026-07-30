import { toast } from 'sonner'
import { create } from 'zustand'

import {
  deletePersistedProject,
  listPersistedProjects,
  loadPersistedProject,
  loadSetting,
  savePersistedProject,
  saveSetting,
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
  type ModelDeclaration,
  type SchemaField,
  type SchemaMutationResult,
  type SchemaProjectSnapshot,
  type VirtualSchemaFile,
  updateFieldInProject,
} from '@/domain/schema'
import { getProjectTemplate } from '@/features/projects'
import { SchemaParserWorkerClient } from '@/workers'

import {
  commitHistory,
  createHistory,
  redoHistory,
  type HistoryState,
  undoHistory,
} from './history'
import {
  applySchemaWorkerResponse,
  beginSchemaParse,
  createSchemaSessionParseState,
  type SchemaSessionParseState,
} from './schema-session'

export interface CanvasPosition {
  readonly x: number
  readonly y: number
}

export interface EditorDocument {
  readonly files: readonly VirtualSchemaFile[]
  readonly positions: Readonly<Record<string, CanvasPosition>>
}

export type NodeDensity = 'overview' | 'standard' | 'full'
export type EdgeStyle = 'smoothstep' | 'bezier'
export type RelationLabelMode = 'none' | 'name' | 'full'
export type RelationNotation = 'crowfoot' | 'numeric'
export type LayoutDirection = 'RIGHT' | 'DOWN'
export type MobileWorkspaceTab = 'code' | 'canvas' | 'properties'

export interface CanvasFocusRequest {
  readonly nodeId: string
  readonly requestId: number
}

interface EditorStore {
  readonly view: 'home' | 'workspace'
  readonly projectId?: string
  readonly projectName: string
  readonly history: HistoryState<EditorDocument>
  readonly parseState: SchemaSessionParseState
  readonly activeFilePath?: string
  readonly selectedNodeId?: string
  readonly selectedFieldId?: string
  readonly selectedEdgeId?: string
  readonly canvasFocusRequest?: CanvasFocusRequest
  readonly density: NodeDensity
  readonly edgeStyle: EdgeStyle
  readonly relationLabelMode: RelationLabelMode
  readonly relationNotation: RelationNotation
  readonly highlightRequiredFields: boolean
  readonly layoutDirection: LayoutDirection
  readonly layoutPromptOpen: boolean
  readonly theme: 'light' | 'dark'
  readonly mobileTab: MobileWorkspaceTab
  readonly localProjects: readonly ProjectRecord[]
  readonly projectsHydrated: boolean
  readonly tourOpen: boolean
  readonly tourStep: number
  readonly tourEligible: boolean
  loadLocalProjects: () => Promise<void>
  openStoredProject: (projectId: string) => Promise<void>
  deleteLocalProject: (projectId: string) => Promise<void>
  openTemplate: (templateId: string) => void
  createBlankProject: (name?: string) => void
  openLocalFiles: (projectName: string, files: readonly VirtualSchemaFile[]) => void
  leaveWorkspace: () => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  setSelectedNode: (id?: string) => void
  focusNodeFromNavigation: (id: string) => void
  setSelectedField: (modelId: string, fieldId: string) => void
  setSelectedEdge: (id?: string) => void
  setDensity: (density: NodeDensity) => void
  setEdgeStyle: (style: EdgeStyle) => void
  setRelationLabelMode: (mode: RelationLabelMode) => void
  setRelationNotation: (notation: RelationNotation) => void
  setHighlightRequiredFields: (enabled: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setMobileTab: (tab: MobileWorkspaceTab) => void
  confirmLayoutDirection: (direction: LayoutDirection) => void
  loadOnboardingState: () => Promise<void>
  openTour: () => void
  closeTour: () => void
  nextTourStep: () => void
  previousTourStep: () => void
  setNodePosition: (id: string, position: CanvasPosition) => void
  setNodePositions: (positions: Readonly<Record<string, CanvasPosition>>) => void
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

  function schedulePersistence(delay = 420): void {
    if (persistenceTimer) clearTimeout(persistenceTimer)
    persistenceTimer = setTimeout(() => {
      const state = get()
      if (!state.projectId || !state.history.present.files.length) return
      void savePersistedProject({
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
      })
        .then(refreshLocalProjects)
        .catch((error: unknown) => {
          toast.error('本地项目保存失败', {
            description: error instanceof Error ? error.message : String(error),
          })
        })
    }, delay)
  }

  function scheduleParse(files: readonly VirtualSchemaFile[], immediate = false): void {
    const currentState = get().parseState
    const nextState = beginSchemaParse(currentState, files)
    set({ parseState: nextState })

    if (parseTimer) clearTimeout(parseTimer)
    const execute = (): void => {
      const client = getParserClient()
      if (!client) return
      void client
        .parse(nextState.sourceRevision, files)
        .then((response) => {
          set((state) => ({
            parseState: applySchemaWorkerResponse(state.parseState, response),
          }))
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          if (!message.includes('已被更新版本取代')) {
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
    } = {},
  ): void {
    const document: EditorDocument = { files, positions: options.positions ?? {} }
    set({
      view: 'workspace',
      projectId,
      projectName,
      history: createHistory(document),
      parseState: createSchemaSessionParseState(files),
      activeFilePath: options.activeFilePath ?? files[0]?.path,
      selectedNodeId: undefined,
      selectedFieldId: undefined,
      selectedEdgeId: undefined,
      canvasFocusRequest: undefined,
      density: options.density ?? 'standard',
      edgeStyle: options.edgeStyle ?? 'smoothstep',
      relationLabelMode: options.relationLabelMode ?? 'name',
      relationNotation: options.relationNotation ?? 'crowfoot',
      highlightRequiredFields: options.highlightRequiredFields ?? false,
      layoutDirection: options.layoutDirection ?? 'RIGHT',
      layoutPromptOpen: options.askLayoutDirection ?? true,
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
  ): void {
    const state = get()
    const nextDocument: EditorDocument = {
      ...state.history.present,
      files,
    }
    set({
      history: commitHistory(state.history, nextDocument, { coalesceKey }),
    })
    scheduleParse(files)
    schedulePersistence()
  }

  function applyMutation(result: SchemaMutationResult): void {
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    commitFiles(result.files)
    toast.success('Schema 已更新')
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
    projectName: '未命名项目',
    history: createHistory(emptyDocument),
    parseState: createSchemaSessionParseState(),
    density: 'standard',
    edgeStyle: 'smoothstep',
    relationLabelMode: 'name',
    relationNotation: 'crowfoot',
    highlightRequiredFields: false,
    layoutDirection: 'RIGHT',
    layoutPromptOpen: false,
    theme: 'dark',
    mobileTab: 'canvas',
    localProjects: [],
    projectsHydrated: false,
    tourOpen: false,
    tourStep: 0,
    tourEligible: false,

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
      const loaded = await loadPersistedProject(projectId)
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
      })
    },

    async deleteLocalProject(projectId) {
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
      set({
        view: 'home',
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        selectedEdgeId: undefined,
        tourOpen: false,
      })
      void refreshLocalProjects()
    },

    setActiveFile(path) {
      set({ activeFilePath: path })
      schedulePersistence()
    },

    updateFileContent(path, content) {
      const files = get().history.present.files.map((file) =>
        file.path === path ? { ...file, content } : file,
      )
      commitFiles(files, `code:${path}`)
    },

    setSelectedNode(id) {
      const declaration = get().parseState.lastValidSnapshot?.graph.declarations.find(
        (entry) => entry.kind !== 'commentBlock' && entry.id === id,
      )
      set({
        selectedNodeId: id,
        selectedFieldId: undefined,
        selectedEdgeId: undefined,
        activeFilePath:
          declaration && declaration.kind !== 'commentBlock'
            ? declaration.source.filePath
            : get().activeFilePath,
      })
    },

    focusNodeFromNavigation(id) {
      const state = get()
      state.setSelectedNode(id)
      set({
        canvasFocusRequest: {
          nodeId: id,
          requestId: (state.canvasFocusRequest?.requestId ?? 0) + 1,
        },
      })
    },

    setSelectedField(modelId, fieldId) {
      const declaration = get().parseState.lastValidSnapshot?.graph.declarations.find(
        (entry): entry is ModelDeclaration =>
          (entry.kind === 'model' || entry.kind === 'view' || entry.kind === 'type') &&
          entry.id === modelId,
      )
      const field = declaration?.members.find(
        (member): member is SchemaField =>
          member.kind === 'field' && member.id === fieldId,
      )
      set({
        selectedNodeId: modelId,
        selectedFieldId: fieldId,
        selectedEdgeId: undefined,
        activeFilePath: field?.source.filePath ?? get().activeFilePath,
      })
    },

    setSelectedEdge(id) {
      const relation = get().parseState.lastValidSnapshot?.graph.logicalRelations.find(
        (entry) => entry.id === id,
      )
      set({
        selectedEdgeId: id,
        selectedNodeId: undefined,
        selectedFieldId: undefined,
        activeFilePath: relation?.source.sources[0]?.filePath ?? get().activeFilePath,
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
        tourOpen: state.tourEligible,
        tourStep: state.tourEligible ? 0 : state.tourStep,
      }))
      schedulePersistence()
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

    setNodePosition(id, position) {
      const state = get()
      const nextDocument: EditorDocument = {
        ...state.history.present,
        positions: { ...state.history.present.positions, [id]: position },
      }
      set({
        history: commitHistory(state.history, nextDocument, { coalesceKey: 'layout' }),
      })
      schedulePersistence()
    },

    setNodePositions(positions) {
      const state = get()
      const nextDocument: EditorDocument = { ...state.history.present, positions }
      set({ history: commitHistory(state.history, nextDocument) })
      schedulePersistence()
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
