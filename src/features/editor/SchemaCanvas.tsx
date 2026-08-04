import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import {
  Braces,
  Database,
  Focus,
  LayoutGrid,
  Plus,
  RefreshCcw,
  Table2,
} from 'lucide-react'
import { ContextMenu } from 'radix-ui'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  deriveForeignKeySemantics,
  type ConfigDeclaration,
  type EnumDeclaration,
  type ModelDeclaration,
  type SchemaComment,
  type SchemaField,
  type TypeAliasDeclaration,
} from '@/domain/schema'
import { type LayoutDirection, type NodeDensity, useEditorStore } from '@/state'
import { LayoutWorkerClient } from '@/workers/layout-client'
import { createLayoutRequest, type LayoutNodeKind } from '@/workers/layout-protocol'

import {
  calculateLayout,
  declarationDimensions,
  type VisualDeclaration,
} from './canvas-layout'
import { LogicalRelationEdge, type LogicalFlowEdge } from './LogicalRelationEdge'

interface SchemaNodeData extends Record<string, unknown> {
  readonly declaration: VisualDeclaration
  readonly density: NodeDensity
  readonly layoutDirection: LayoutDirection
  readonly selectedFieldIds: readonly string[]
  readonly highlightRequiredFields: boolean
  readonly relationState?: 'fk-child'
  readonly commentContext?: 'root' | 'related'
  readonly contextualComments: readonly ContextualFieldComment[]
  readonly onSelect: (id: string) => void
  readonly onSelectField: (modelId: string, fieldId: string) => void
  readonly onAddField: (modelId: string) => void
  readonly onDelete: (modelId: string) => void
}

type SchemaFlowNode = Node<SchemaNodeData, 'schema'>

const NODE_SOURCE_HANDLE_ID = 'schema-node-source'
const NODE_TARGET_HANDLE_ID = 'schema-node-target'

type InitialFitStatus = 'idle' | 'scheduled' | 'running' | 'complete'

function layoutNodeKind(declaration: VisualDeclaration): LayoutNodeKind {
  if (
    declaration.kind === 'model' ||
    declaration.kind === 'view' ||
    declaration.kind === 'type'
  ) {
    return 'model'
  }
  if (declaration.kind === 'enum') return 'enum'
  if (declaration.kind === 'typeAlias') return 'type-alias'
  return 'config'
}

function positiveDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function modelFields(declaration: ModelDeclaration) {
  return declaration.members.filter((member) => member.kind === 'field')
}

function joinedCommentText(
  comments: readonly SchemaComment[] | undefined,
  trailingComment?: SchemaComment,
): string {
  return [...(comments ?? []), ...(trailingComment ? [trailingComment] : [])]
    .map((comment) => comment.text.trim())
    .filter(Boolean)
    .join(' · ')
}

function fieldCommentText(field: SchemaField): string {
  return joinedCommentText(field.leadingComments, field.trailingComment)
}

interface ContextualFieldComment {
  readonly field: SchemaField
  readonly comment: string
  readonly hiddenByDensity: boolean
}

interface ContextualModelComments {
  readonly comments: readonly ContextualFieldComment[]
  readonly context: 'root' | 'related'
}

function commentedModelFields(
  declaration: ModelDeclaration,
  density: NodeDensity,
): readonly ContextualFieldComment[] {
  return modelFields(declaration).flatMap((field, index) => {
    const comment = fieldCommentText(field)
    const hiddenByDensity =
      density === 'overview' || (density === 'standard' && index >= 7)
    return comment ? [{ field, comment, hiddenByDensity }] : []
  })
}

function contextualCommentText(
  modelName: string,
  { field, comment, hiddenByDensity }: ContextualFieldComment,
): string {
  return `${modelName}.${field.name}：${comment}${hiddenByDensity ? '；当前密度下字段未显示在卡片中' : ''}`
}

function FieldCommentTag({
  modelName,
  entry,
}: {
  readonly modelName: string
  readonly entry: ContextualFieldComment
}) {
  const fullText = contextualCommentText(modelName, entry)
  return (
    <span
      className="schema-field-comment-tag nodrag nopan"
      data-field-name={entry.field.name}
      role="note"
      title={fullText}
    >
      <span className="schema-field-comment-tag-text" aria-hidden="true">
        {entry.comment}
      </span>
      <span className="visually-hidden">{fullText}</span>
    </span>
  )
}

function HiddenFieldCommentRail({
  modelName,
  comments,
}: {
  readonly modelName: string
  readonly comments: readonly ContextualFieldComment[]
}) {
  if (!comments.length) return null

  return (
    <div
      className="schema-hidden-comment-rail nodrag nopan nowheel"
      data-comment-count={comments.length}
      role="list"
      aria-label={`${modelName} 当前密度下隐藏的字段说明`}
      tabIndex={0}
    >
      {comments.map((entry) => {
        const fullText = contextualCommentText(modelName, entry)
        return (
          <span
            className="schema-hidden-comment-item"
            data-field-name={entry.field.name}
            role="listitem"
            title={fullText}
            key={entry.field.id}
          >
            <strong aria-hidden="true">{entry.field.name}</strong>
            <span aria-hidden="true">{entry.comment}</span>
            <span className="visually-hidden">{fullText}</span>
          </span>
        )
      })}
    </div>
  )
}

function handlePositions(direction: LayoutDirection): {
  readonly source: Position
  readonly target: Position
} {
  return direction === 'DOWN'
    ? { source: Position.Bottom, target: Position.Top }
    : { source: Position.Right, target: Position.Left }
}

function NodeGlyph({ declaration }: { readonly declaration: VisualDeclaration }) {
  if (declaration.kind === 'enum') return <Braces size={14} />
  if (declaration.kind === 'datasource' || declaration.kind === 'generator') {
    return <Database size={14} />
  }
  return <Table2 size={14} />
}

function ModelNodeBody({
  declaration,
  density,
  layoutDirection,
  selectedFieldIds,
  highlightRequiredFields,
  contextualComments,
  onSelectField,
}: {
  readonly declaration: ModelDeclaration
  readonly density: NodeDensity
  readonly layoutDirection: LayoutDirection
  readonly selectedFieldIds: readonly string[]
  readonly highlightRequiredFields: boolean
  readonly contextualComments: readonly ContextualFieldComment[]
  readonly onSelectField: (modelId: string, fieldId: string) => void
}) {
  const fields = modelFields(declaration)
  const { source: sourcePosition } = handlePositions(layoutDirection)
  const visibleCommentsByFieldId = new Map(
    contextualComments
      .filter((entry) => !entry.hiddenByDensity)
      .map((entry) => [entry.field.id, entry]),
  )
  const hiddenComments = contextualComments.filter((entry) => entry.hiddenByDensity)
  if (density === 'overview') {
    return (
      <div className="schema-node-overview">
        <div className="schema-node-summary">{fields.length} 个字段</div>
        <HiddenFieldCommentRail
          modelName={declaration.name}
          comments={hiddenComments}
        />
      </div>
    )
  }
  const visibleFields = density === 'standard' ? fields.slice(0, 7) : fields

  return (
    <div className="schema-node-fields">
      {visibleFields.map((field) => {
        const selected = selectedFieldIds.includes(field.id)
        const contextualComment = visibleCommentsByFieldId.get(field.id)
        const modifierLabel =
          field.type.modifier === 'list'
            ? '，列表'
            : field.type.modifier === 'optional'
              ? '，可选'
              : ''
        const required =
          highlightRequiredFields &&
          field.type.modifier !== 'optional' &&
          field.type.modifier !== 'list'
        return (
          <div className="schema-field-entry" key={field.id}>
            {contextualComment && (
              <FieldCommentTag modelName={declaration.name} entry={contextualComment} />
            )}
            <button
              type="button"
              className={`schema-field-row nodrag ${selected ? 'is-selected' : ''} ${required ? 'is-required' : ''}`}
              aria-label={`${field.name}，类型 ${field.type.name}${modifierLabel}`}
              aria-current={selected ? 'true' : undefined}
              onClick={(event) => {
                event.stopPropagation()
                onSelectField(declaration.id, field.id)
              }}
            >
              <span>{field.name}</span>
              <code>
                {field.type.name}
                {field.type.modifier === 'list'
                  ? '[]'
                  : field.type.modifier === 'optional'
                    ? '?'
                    : ''}
              </code>
            </button>
            <Handle
              id={field.id}
              type="source"
              position={sourcePosition}
              className="field-handle"
              role="button"
              tabIndex={0}
              aria-label={`从字段 ${declaration.name}.${field.name} 创建关系`}
              aria-keyshortcuts="Enter Space"
              title={`从字段 ${declaration.name}.${field.name} 创建关系`}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.click()
              }}
            />
          </div>
        )
      })}
      {visibleFields.length < fields.length && (
        <div className="schema-node-more">
          +{fields.length - visibleFields.length} 个字段
        </div>
      )}
      <HiddenFieldCommentRail modelName={declaration.name} comments={hiddenComments} />
    </div>
  )
}

function EnumNodeBody({ declaration }: { readonly declaration: EnumDeclaration }) {
  const values = declaration.members.filter((member) => member.kind === 'enumValue')
  return (
    <div className="schema-node-fields compact">
      {values.slice(0, 6).map((value) => (
        <div className="enum-value" key={value.id}>
          {value.name}
        </div>
      ))}
      {values.length > 6 && (
        <div className="schema-node-more">+{values.length - 6} 个值</div>
      )}
    </div>
  )
}

function ConfigNodeBody({ declaration }: { readonly declaration: ConfigDeclaration }) {
  const entries = declaration.members.filter((member) => member.kind === 'config')
  return (
    <div className="schema-node-fields compact">
      {entries.slice(0, 4).map((entry) => (
        <div className="schema-field-row" key={entry.id}>
          <span>{entry.name}</span>
          <code>config</code>
        </div>
      ))}
    </div>
  )
}

function SchemaNode({ data, selected }: NodeProps<SchemaFlowNode>) {
  const {
    declaration,
    density,
    layoutDirection,
    selectedFieldIds,
    highlightRequiredFields,
    relationState,
    commentContext,
    contextualComments,
    onSelect,
    onSelectField,
    onAddField,
    onDelete,
  } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const canConnect = declaration.kind === 'model' || declaration.kind === 'view'
  const isModelLike =
    declaration.kind === 'model' ||
    declaration.kind === 'view' ||
    declaration.kind === 'type'
  const isSpecial =
    declaration.kind === 'enum' ||
    declaration.kind === 'datasource' ||
    declaration.kind === 'generator'
  const modelComment = isModelLike ? joinedCommentText(declaration.leadingComments) : ''
  const { source: sourcePosition, target: targetPosition } =
    handlePositions(layoutDirection)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateNodeInternals(declaration.id)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [declaration, density, layoutDirection, updateNodeInternals])

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <article
          className={`schema-node ${selected ? 'is-selected' : ''} ${isSpecial ? 'is-special' : ''} ${relationState ? 'is-related' : ''} ${relationState === 'fk-child' ? 'is-fk-child' : ''}`}
          data-layout-direction={layoutDirection.toLowerCase()}
          data-relation-state={relationState}
          data-comment-context={commentContext}
          onDoubleClick={() => onSelect(declaration.id)}
        >
          {canConnect && (
            <Handle
              id={NODE_TARGET_HANDLE_ID}
              type="target"
              position={targetPosition}
              className="node-handle"
              role="button"
              tabIndex={0}
              aria-label={`连接到 ${declaration.name}`}
              aria-keyshortcuts="Enter Space"
              title={`连接到 ${declaration.name}`}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.click()
              }}
            />
          )}
          <header>
            <span className={`node-kind kind-${declaration.kind}`}>
              <NodeGlyph declaration={declaration} />
            </span>
            <div className="schema-node-title">
              <strong>{declaration.name}</strong>
              <small>{declaration.kind}</small>
            </div>
            {(relationState === 'fk-child' || modelComment) && (
              <div className="schema-node-header-meta">
                {relationState === 'fk-child' && (
                  <span className="schema-relation-state" aria-label="外键侧模型">
                    外键侧
                  </span>
                )}
                {modelComment && (
                  <p className="schema-model-comment" role="note" title={modelComment}>
                    <span aria-hidden="true">{modelComment}</span>
                    <span className="visually-hidden">
                      {declaration.name}：{modelComment}
                    </span>
                  </p>
                )}
              </div>
            )}
          </header>

          {isModelLike && (
            <ModelNodeBody
              declaration={declaration}
              density={density}
              layoutDirection={layoutDirection}
              selectedFieldIds={selectedFieldIds}
              highlightRequiredFields={highlightRequiredFields}
              contextualComments={contextualComments}
              onSelectField={onSelectField}
            />
          )}
          {declaration.kind === 'enum' && <EnumNodeBody declaration={declaration} />}
          {(declaration.kind === 'datasource' || declaration.kind === 'generator') && (
            <ConfigNodeBody declaration={declaration} />
          )}
          {declaration.kind === 'typeAlias' && (
            <div className="schema-node-summary">
              {(declaration as TypeAliasDeclaration).type.name}
            </div>
          )}
          {canConnect && (
            <Handle
              id={NODE_SOURCE_HANDLE_ID}
              type="source"
              position={sourcePosition}
              className="node-handle"
              role="button"
              tabIndex={0}
              aria-label={`从 ${declaration.name} 创建关系`}
              aria-keyshortcuts="Enter Space"
              title={`从 ${declaration.name} 创建关系`}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.click()
              }}
            />
          )}
        </article>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu-content">
          <ContextMenu.Item
            className="menu-item"
            onSelect={() => onSelect(declaration.id)}
          >
            在属性面板中打开
          </ContextMenu.Item>
          {(declaration.kind === 'model' || declaration.kind === 'view') && (
            <ContextMenu.Item
              className="menu-item"
              onSelect={() => onAddField(declaration.id)}
            >
              添加字段
            </ContextMenu.Item>
          )}
          {(declaration.kind === 'model' || declaration.kind === 'view') && (
            <>
              <ContextMenu.Separator className="menu-separator" />
              <ContextMenu.Item
                className="menu-item danger"
                onSelect={() => onDelete(declaration.id)}
              >
                删除模型
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

const nodeTypes = { schema: SchemaNode }
const edgeTypes = { 'logical-relation': LogicalRelationEdge }

function CanvasInner({
  onRequestAddModel,
}: {
  readonly onRequestAddModel: () => void
}) {
  const snapshot = useEditorStore((state) => state.parseState.lastValidSnapshot)
  const parseStatus = useEditorStore((state) => state.parseState.status)
  const diagnostics = useEditorStore((state) => state.parseState.diagnostics)
  const editorSessionId = useEditorStore((state) => state.editorSessionId)
  const projectId = useEditorStore((state) => state.projectId)
  const layoutRequest = useEditorStore((state) => state.layoutRequest)
  const savedPositions = useEditorStore((state) => state.history.present.positions)
  const density = useEditorStore((state) => state.density)
  const edgeStyle = useEditorStore((state) => state.edgeStyle)
  const relationLabelMode = useEditorStore((state) => state.relationLabelMode)
  const relationNotation = useEditorStore((state) => state.relationNotation)
  const highlightRequiredFields = useEditorStore(
    (state) => state.highlightRequiredFields,
  )
  const layoutDirection = useEditorStore((state) => state.layoutDirection)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedFieldId = useEditorStore((state) => state.selectedFieldId)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const canvasFocusRequest = useEditorStore((state) => state.canvasFocusRequest)
  const setSelectedNode = useEditorStore((state) => state.setSelectedNode)
  const selectFieldFromCanvas = useEditorStore((state) => state.selectFieldFromCanvas)
  const setSelectedEdge = useEditorStore((state) => state.setSelectedEdge)
  const setNodePositions = useEditorStore((state) => state.setNodePositions)
  const requestAutoLayout = useEditorStore((state) => state.requestAutoLayout)
  const applyLayoutOutcome = useEditorStore((state) => state.applyLayoutOutcome)
  const addField = useEditorStore((state) => state.addField)
  const deleteModel = useEditorStore((state) => state.deleteModel)
  const connectModels = useEditorStore((state) => state.connectModels)
  const { fitView, getNode, getNodes, getZoom, setCenter } = useReactFlow<
    SchemaFlowNode,
    LogicalFlowEdge
  >()
  const nodesInitialized = useNodesInitialized({ includeHiddenNodes: true })
  const declarations = useMemo(
    () =>
      snapshot?.graph.declarations.filter(
        (declaration): declaration is VisualDeclaration =>
          declaration.kind !== 'commentBlock',
      ) ?? [],
    [snapshot],
  )
  const fallbackPositions = useMemo(
    () => calculateLayout(declarations, layoutDirection, density),
    [declarations, density, layoutDirection],
  )
  const selectedRelation = snapshot?.graph.logicalRelations.find(
    (relation) => relation.id === selectedEdgeId,
  )
  const selectedFieldOwnerId = useMemo(() => {
    if (!selectedFieldId) return undefined
    return declarations.find(
      (declaration) =>
        (declaration.kind === 'model' ||
          declaration.kind === 'view' ||
          declaration.kind === 'type') &&
        declaration.members.some(
          (member) => member.kind === 'field' && member.id === selectedFieldId,
        ),
    )?.id
  }, [declarations, selectedFieldId])
  const commentContextRootIds = useMemo(() => {
    const rootIds = new Set<string>()
    if (selectedNodeId) rootIds.add(selectedNodeId)
    if (selectedFieldOwnerId) rootIds.add(selectedFieldOwnerId)
    if (selectedRelation) {
      rootIds.add(selectedRelation.source.modelId)
      rootIds.add(selectedRelation.target.modelId)
    }
    return rootIds
  }, [selectedFieldOwnerId, selectedNodeId, selectedRelation])
  const commentContextModelIds = useMemo(() => {
    if (!commentContextRootIds.size) return new Set<string>()

    const contextualIds = new Set(commentContextRootIds)
    for (const relation of snapshot?.graph.logicalRelations ?? []) {
      if (commentContextRootIds.has(relation.source.modelId)) {
        contextualIds.add(relation.target.modelId)
      }
      if (commentContextRootIds.has(relation.target.modelId)) {
        contextualIds.add(relation.source.modelId)
      }
    }
    return contextualIds
  }, [commentContextRootIds, snapshot])
  const contextualCommentsByModelId = useMemo(() => {
    const entries = new Map<string, ContextualModelComments>()
    for (const declaration of declarations) {
      if (
        !commentContextModelIds.has(declaration.id) ||
        (declaration.kind !== 'model' &&
          declaration.kind !== 'view' &&
          declaration.kind !== 'type')
      ) {
        continue
      }

      const comments = commentedModelFields(declaration, density)
      if (!comments.length) continue
      entries.set(declaration.id, {
        comments,
        context: commentContextRootIds.has(declaration.id) ? 'root' : 'related',
      })
    }
    return entries
  }, [commentContextModelIds, commentContextRootIds, declarations, density])
  const selectedRelationNodeStates = useMemo(() => {
    const states = new Map<string, 'fk-child'>()
    if (!selectedRelation) return states

    const semantics = deriveForeignKeySemantics(selectedRelation)
    if (semantics) states.set(semantics.childModelId, 'fk-child')
    return states
  }, [selectedRelation])
  const highlightedFieldIds = useMemo(
    () =>
      selectedRelation
        ? [...selectedRelation.source.fieldIds, ...selectedRelation.target.fieldIds]
        : selectedFieldId
          ? [selectedFieldId]
          : [],
    [selectedFieldId, selectedRelation],
  )
  const [nodes, setNodes] = useState<SchemaFlowNode[]>([])
  const [initialFitStatus, setInitialFitStatus] = useState<InitialFitStatus>('idle')
  const initialFitRequested = useRef(false)
  const initialFitStarted = useRef(false)
  const initialFitFrame = useRef<number | undefined>(undefined)
  const nodesSessionId = useRef(editorSessionId)
  const previousSavedPositions = useRef(savedPositions)
  const layoutClient = useRef<
    | {
        readonly editorSessionId: number
        readonly client: LayoutWorkerClient
      }
    | undefined
  >(undefined)
  const submittedLayoutRequestIds = useRef(new Set<number>())

  useEffect(() => {
    const client = new LayoutWorkerClient()
    layoutClient.current = { editorSessionId, client }
    submittedLayoutRequestIds.current.clear()
    initialFitRequested.current = false
    initialFitStarted.current = false
    if (initialFitFrame.current !== undefined) {
      window.cancelAnimationFrame(initialFitFrame.current)
      initialFitFrame.current = undefined
    }
    return () => {
      if (layoutClient.current?.client === client) {
        layoutClient.current = undefined
      }
      if (initialFitFrame.current !== undefined) {
        window.cancelAnimationFrame(initialFitFrame.current)
        initialFitFrame.current = undefined
      }
      client?.dispose()
    }
  }, [editorSessionId])

  useEffect(() => {
    // Semantic updates intentionally retain live positions; React Flow stays mounted so
    // the current viewport and zoom never jump after source or relation changes.
    const retainLivePositions = nodesSessionId.current === editorSessionId
    const savedPositionsChanged = previousSavedPositions.current !== savedPositions
    nodesSessionId.current = editorSessionId
    previousSavedPositions.current = savedPositions
    setNodes((current) => {
      const contextualCommentsFor = (declarationId: string) =>
        contextualCommentsByModelId.get(declarationId)
      const livePositions = new Map(
        retainLivePositions ? current.map((node) => [node.id, node.position]) : [],
      )
      const preserveLiveSelection =
        retainLivePositions &&
        selectedNodeId !== undefined &&
        current.some((node) => node.id === selectedNodeId && node.selected)
      const liveSelectedNodeIds = new Set(
        preserveLiveSelection
          ? current.filter((node) => node.selected).map((node) => node.id)
          : [],
      )
      return declarations.map((declaration) => ({
        id: declaration.id,
        type: 'schema',
        position: (savedPositionsChanged
          ? savedPositions[declaration.id]
          : livePositions.get(declaration.id)) ??
          savedPositions[declaration.id] ??
          fallbackPositions[declaration.id] ?? { x: 0, y: 0 },
        data: {
          declaration,
          density,
          layoutDirection,
          selectedFieldIds: highlightedFieldIds,
          highlightRequiredFields,
          relationState: selectedRelationNodeStates.get(declaration.id),
          commentContext: contextualCommentsFor(declaration.id)?.context,
          contextualComments: contextualCommentsFor(declaration.id)?.comments ?? [],
          onSelect: setSelectedNode,
          onSelectField: selectFieldFromCanvas,
          onAddField: (modelId) => {
            const fieldName = window.prompt('新字段名称', 'newField')
            if (fieldName) addField(modelId, fieldName)
          },
          onDelete: (modelId) => {
            if (window.confirm('删除模型会同时移除指向它的关系字段。确定继续吗？')) {
              deleteModel(modelId)
            }
          },
        },
        selected: preserveLiveSelection
          ? liveSelectedNodeIds.has(declaration.id)
          : declaration.id === selectedNodeId,
      }))
    })
  }, [
    addField,
    declarations,
    deleteModel,
    density,
    editorSessionId,
    fallbackPositions,
    highlightRequiredFields,
    highlightedFieldIds,
    contextualCommentsByModelId,
    layoutDirection,
    savedPositions,
    selectFieldFromCanvas,
    selectedNodeId,
    selectedRelationNodeStates,
    setSelectedNode,
  ])

  useLayoutEffect(() => {
    // The initial confirmation owns one viewport fit. Wait until the committed
    // positions and measured card dimensions are stable across animation frames.
    if (
      initialFitStatus !== 'scheduled' ||
      initialFitStarted.current ||
      !nodesInitialized ||
      declarations.length === 0
    ) {
      return
    }

    let cancelled = false
    let previousSignature = ''
    let stableFrames = 0
    const declarationIds = new Set(declarations.map((declaration) => declaration.id))

    const waitForStableNodeGeometry = () => {
      initialFitFrame.current = window.requestAnimationFrame(() => {
        initialFitFrame.current = undefined
        if (cancelled || initialFitStarted.current) return

        const currentNodes = getNodes()
        const currentNodeIds = new Set(currentNodes.map((node) => node.id))
        const geometryReady =
          currentNodes.length === declarations.length &&
          declarations.every((declaration) => currentNodeIds.has(declaration.id)) &&
          currentNodes.every(
            (node) =>
              declarationIds.has(node.id) &&
              positiveDimension(node.measured?.width ?? node.width, 0) > 0 &&
              positiveDimension(node.measured?.height ?? node.height, 0) > 0,
          )
        const signature = currentNodes
          .map(
            (node) =>
              `${node.id}:${node.position.x}:${node.position.y}:${node.measured?.width ?? node.width ?? 0}:${node.measured?.height ?? node.height ?? 0}`,
          )
          .sort()
          .join('|')

        stableFrames =
          geometryReady && signature === previousSignature ? stableFrames + 1 : 0
        previousSignature = signature
        if (!geometryReady || stableFrames < 1) {
          waitForStableNodeGeometry()
          return
        }

        initialFitStarted.current = true
        setInitialFitStatus('running')
        const fitSessionId = editorSessionId
        void fitView({ duration: 260, padding: 0.18, maxZoom: 0.9 }).finally(() => {
          if (layoutClient.current?.editorSessionId === fitSessionId) {
            setInitialFitStatus('complete')
          }
        })
      })
    }

    waitForStableNodeGeometry()
    return () => {
      cancelled = true
      if (initialFitFrame.current !== undefined) {
        window.cancelAnimationFrame(initialFitFrame.current)
        initialFitFrame.current = undefined
      }
    }
  }, [
    declarations,
    editorSessionId,
    fitView,
    getNodes,
    initialFitStatus,
    nodesInitialized,
  ])

  useEffect(() => {
    if (
      !layoutRequest ||
      !snapshot ||
      !projectId ||
      (!nodesInitialized && declarations.length > 0) ||
      layoutRequest.editorSessionId !== editorSessionId ||
      layoutRequest.projectId !== projectId ||
      layoutRequest.graphRevision !== snapshot.revision ||
      submittedLayoutRequestIds.current.has(layoutRequest.id)
    ) {
      return
    }

    const submitTimeout = window.setTimeout(() => {
      const activeClient = layoutClient.current
      if (!activeClient || activeClient.editorSessionId !== editorSessionId) return

      const currentNodes = getNodes()
      const currentNodeById = new Map(currentNodes.map((node) => [node.id, node]))
      if (
        currentNodes.length !== declarations.length ||
        declarations.some((declaration) => !currentNodeById.has(declaration.id))
      ) {
        return
      }

      const hierarchyNodeIds = new Set(
        declarations
          .filter(
            (declaration) =>
              declaration.kind === 'model' ||
              declaration.kind === 'view' ||
              declaration.kind === 'type',
          )
          .map((declaration) => declaration.id),
      )
      const hierarchyEdges = snapshot.graph.logicalRelations.flatMap((relation) => {
        const semantics = deriveForeignKeySemantics(relation)
        if (
          !semantics ||
          !hierarchyNodeIds.has(semantics.childModelId) ||
          !hierarchyNodeIds.has(semantics.parentModelId)
        ) {
          return []
        }
        return [
          {
            id: relation.id,
            childId: semantics.childModelId,
            parentId: semantics.parentModelId,
          },
        ]
      })
      const protocolRequest = createLayoutRequest({
        editorSessionId: String(layoutRequest.editorSessionId),
        requestId: layoutRequest.id,
        projectId: layoutRequest.projectId,
        graphRevision: layoutRequest.graphRevision,
        direction: layoutRequest.direction,
        nodes: declarations.map((declaration, order) => {
          const node = currentNodeById.get(declaration.id)
          const fallback = declarationDimensions(declaration, density)
          return {
            id: declaration.id,
            width: positiveDimension(
              node?.measured?.width ?? node?.width,
              fallback.width,
            ),
            height: positiveDimension(
              node?.measured?.height ?? node?.height,
              fallback.height,
            ),
            kind: layoutNodeKind(declaration),
            order,
          }
        }),
        hierarchyEdges,
      })

      submittedLayoutRequestIds.current.add(layoutRequest.id)
      void activeClient.client
        .layout(protocolRequest)
        .then((result) => {
          if (!result.ok) {
            const accepted = applyLayoutOutcome({
              ok: false,
              editorSessionId: layoutRequest.editorSessionId,
              projectId: layoutRequest.projectId,
              requestId: layoutRequest.id,
              graphRevision: layoutRequest.graphRevision,
              direction: layoutRequest.direction,
              error: result.error,
            })
            if (accepted) {
              toast.error('自动布局失败', { description: result.error.message })
            }
            return
          }

          const accepted = applyLayoutOutcome({
            ok: true,
            editorSessionId: layoutRequest.editorSessionId,
            projectId: layoutRequest.projectId,
            requestId: layoutRequest.id,
            graphRevision: layoutRequest.graphRevision,
            direction: layoutRequest.direction,
            positions: result.positions,
          })
          if (!accepted) return

          const positionById = new Map(
            result.positions.map(({ id, x, y }) => [id, { x, y }]),
          )
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              position: positionById.get(node.id) ?? node.position,
            })),
          )
          if (
            layoutRequest.reason === 'initial-confirmation' &&
            !initialFitRequested.current
          ) {
            initialFitRequested.current = true
            setInitialFitStatus('scheduled')
          }
        })
        .catch((error: unknown) => {
          const accepted = applyLayoutOutcome({
            ok: false,
            editorSessionId: layoutRequest.editorSessionId,
            projectId: layoutRequest.projectId,
            requestId: layoutRequest.id,
            graphRevision: layoutRequest.graphRevision,
            direction: layoutRequest.direction,
            error,
          })
          if (accepted) {
            toast.error('自动布局失败', {
              description:
                error instanceof Error ? error.message : '布局 Worker 无响应',
            })
          }
        })
    }, 0)

    return () => window.clearTimeout(submitTimeout)
  }, [
    applyLayoutOutcome,
    declarations,
    density,
    editorSessionId,
    getNodes,
    layoutRequest,
    nodes,
    nodesInitialized,
    projectId,
    snapshot,
  ])

  useEffect(() => {
    if (!canvasFocusRequest) return
    const node = getNode(canvasFocusRequest.nodeId)
    if (!node) return
    const width = node.measured?.width ?? 220
    const height = node.measured?.height ?? 120
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: getZoom(),
      duration: 300,
    })
  }, [canvasFocusRequest, getNode, getZoom, setCenter])

  const edges = useMemo<LogicalFlowEdge[]>(
    () =>
      snapshot?.graph.logicalRelations.map((relation) => ({
        id: relation.id,
        source: relation.source.modelId,
        target: relation.target.modelId,
        sourceHandle: NODE_SOURCE_HANDLE_ID,
        targetHandle: NODE_TARGET_HANDLE_ID,
        type: 'logical-relation',
        selected: relation.id === selectedEdgeId,
        markerEnd: relation.foreignKey
          ? {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: '#8f9bff',
            }
          : undefined,
        animated: false,
        selectable: true,
        style: { strokeWidth: 1.25 },
        data: {
          relation,
          notation: relationNotation,
          lineStyle: edgeStyle,
          label:
            relationLabelMode === 'none'
              ? undefined
              : relationLabelMode === 'name'
                ? relation.name ||
                  `${relation.source.modelName} ↔ ${relation.target.modelName}`
                : `${relation.source.fieldNames.join(', ') || relation.source.modelName} ↔ ${relation.target.fieldNames.join(', ') || relation.target.modelName}`,
        },
      })) ?? [],
    [edgeStyle, relationLabelMode, relationNotation, selectedEdgeId, snapshot],
  )

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <section
          className="canvas-panel"
          aria-label="Schema 关系画布"
          data-layout-request-id={layoutRequest?.id}
          data-nodes-initialized={nodesInitialized}
          data-initial-fit-status={initialFitStatus}
        >
          <ReactFlow<SchemaFlowNode, LogicalFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={(changes: NodeChange<SchemaFlowNode>[]) =>
              setNodes((current) => applyNodeChanges(changes, current))
            }
            onNodeClick={(_, node) => setSelectedNode(node.id)}
            onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
            onPaneClick={() => {
              setSelectedNode(undefined)
              setSelectedEdge(undefined)
            }}
            onNodeDragStop={(_, node, draggedNodes) => {
              const movedNodes = draggedNodes?.length ? draggedNodes : [node]
              const mergedPositions = { ...savedPositions }
              for (const movedNode of movedNodes) {
                mergedPositions[movedNode.id] = movedNode.position
              }
              setNodePositions(mergedPositions, { reason: 'manual-drag' })
            }}
            onConnect={(connection: Connection) => {
              if (connection.source && connection.target) {
                connectModels(
                  connection.source,
                  connection.target,
                  connection.sourceHandle === NODE_SOURCE_HANDLE_ID
                    ? undefined
                    : (connection.sourceHandle ?? undefined),
                )
              }
            }}
            minZoom={0.15}
            maxZoom={2.2}
            connectOnClick
            selectionOnDrag
            multiSelectionKeyCode={['Meta', 'Control']}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Panel className="canvas-toolbox" position="top-left">
              <button
                type="button"
                onClick={onRequestAddModel}
                aria-label="新增模型"
                title="新增模型"
              >
                <Plus size={15} />
              </button>
              <button
                type="button"
                onClick={requestAutoLayout}
                aria-label="自动布局"
                title="自动布局"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                onClick={() => void fitView({ duration: 260, padding: 0.16 })}
                aria-label="适应视图"
                title="适应视图"
              >
                <Focus size={15} />
              </button>
            </Panel>
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor={(node) =>
                (node.data as SchemaNodeData).declaration.kind === 'enum'
                  ? '#8894d8'
                  : '#666c76'
              }
            />
          </ReactFlow>

          {!snapshot && (
            <div className="canvas-empty">
              <RefreshCcw
                size={18}
                className={parseStatus === 'parsing' ? 'spin' : ''}
              />
              <strong>
                {parseStatus === 'parsing' ? '正在构建关系图' : '等待有效 Schema'}
              </strong>
              <span>代码有效后，模型和关系会在这里出现。</span>
            </div>
          )}

          {parseStatus === 'invalid' && snapshot && (
            <div className="invalid-banner">
              <span>画布已锁定在最后一次有效结构</span>
              <small>{diagnostics[0]?.message}</small>
            </div>
          )}
        </section>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu-content">
          <ContextMenu.Item className="menu-item" onSelect={onRequestAddModel}>
            <Plus size={14} /> 新增模型
          </ContextMenu.Item>
          <ContextMenu.Item className="menu-item" onSelect={requestAutoLayout}>
            <LayoutGrid size={14} /> 自动布局
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function SchemaCanvas(props: { readonly onRequestAddModel: () => void }) {
  const editorSessionId = useEditorStore((state) => state.editorSessionId)

  return (
    <ReactFlowProvider key={editorSessionId}>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
