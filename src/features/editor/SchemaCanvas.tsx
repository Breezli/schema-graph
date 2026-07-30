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
  useReactFlow,
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
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  ConfigDeclaration,
  EnumDeclaration,
  ModelDeclaration,
  TypeAliasDeclaration,
} from '@/domain/schema'
import { type NodeDensity, useEditorStore } from '@/state'

import { calculateLayout, type VisualDeclaration } from './canvas-layout'
import { LogicalRelationEdge, type LogicalFlowEdge } from './LogicalRelationEdge'

interface SchemaNodeData extends Record<string, unknown> {
  readonly declaration: VisualDeclaration
  readonly density: NodeDensity
  readonly selectedFieldIds: readonly string[]
  readonly highlightRequiredFields: boolean
  readonly onSelect: (id: string) => void
  readonly onSelectField: (modelId: string, fieldId: string) => void
  readonly onAddField: (modelId: string) => void
  readonly onDelete: (modelId: string) => void
}

type SchemaFlowNode = Node<SchemaNodeData, 'schema'>

function modelFields(declaration: ModelDeclaration) {
  return declaration.members.filter((member) => member.kind === 'field')
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
  selectedFieldIds,
  highlightRequiredFields,
  onSelectField,
}: {
  readonly declaration: ModelDeclaration
  readonly density: NodeDensity
  readonly selectedFieldIds: readonly string[]
  readonly highlightRequiredFields: boolean
  readonly onSelectField: (modelId: string, fieldId: string) => void
}) {
  const fields = modelFields(declaration)
  if (density === 'overview') {
    return <div className="schema-node-summary">{fields.length} 个字段</div>
  }
  const visibleFields = density === 'standard' ? fields.slice(0, 7) : fields

  return (
    <div className="schema-node-fields">
      {visibleFields.map((field) => {
        const selected = selectedFieldIds.includes(field.id)
        const required =
          highlightRequiredFields &&
          field.type.modifier !== 'optional' &&
          field.type.modifier !== 'list'
        return (
          <div
            className={`schema-field-row nodrag ${selected ? 'is-selected' : ''} ${required ? 'is-required' : ''}`}
            key={field.id}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation()
              onSelectField(declaration.id, field.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectField(declaration.id, field.id)
              }
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
            <Handle
              id={field.id}
              type="source"
              position={Position.Right}
              className="field-handle"
            />
          </div>
        )
      })}
      {visibleFields.length < fields.length && (
        <div className="schema-node-more">
          +{fields.length - visibleFields.length} fields
        </div>
      )}
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
        <div className="schema-node-more">+{values.length - 6}</div>
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
    selectedFieldIds,
    highlightRequiredFields,
    onSelect,
    onSelectField,
    onAddField,
    onDelete,
  } = data
  const canConnect = declaration.kind === 'model' || declaration.kind === 'view'
  const isSpecial =
    declaration.kind === 'enum' ||
    declaration.kind === 'datasource' ||
    declaration.kind === 'generator'

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <article
          className={`schema-node ${selected ? 'is-selected' : ''} ${isSpecial ? 'is-special' : ''}`}
          onDoubleClick={() => onSelect(declaration.id)}
        >
          {canConnect && (
            <Handle type="target" position={Position.Left} className="node-handle" />
          )}
          <header>
            <span className={`node-kind kind-${declaration.kind}`}>
              <NodeGlyph declaration={declaration} />
            </span>
            <div>
              <strong>{declaration.name}</strong>
              <small>{declaration.kind}</small>
            </div>
          </header>

          {(declaration.kind === 'model' ||
            declaration.kind === 'view' ||
            declaration.kind === 'type') && (
            <ModelNodeBody
              declaration={declaration}
              density={density}
              selectedFieldIds={selectedFieldIds}
              highlightRequiredFields={highlightRequiredFields}
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
            <Handle type="source" position={Position.Right} className="node-handle" />
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
  const savedPositions = useEditorStore((state) => state.history.present.positions)
  const density = useEditorStore((state) => state.density)
  const edgeStyle = useEditorStore((state) => state.edgeStyle)
  const relationLabelMode = useEditorStore((state) => state.relationLabelMode)
  const relationNotation = useEditorStore((state) => state.relationNotation)
  const highlightRequiredFields = useEditorStore(
    (state) => state.highlightRequiredFields,
  )
  const layoutDirection = useEditorStore((state) => state.layoutDirection)
  const selectedFieldId = useEditorStore((state) => state.selectedFieldId)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const canvasFocusRequest = useEditorStore((state) => state.canvasFocusRequest)
  const setSelectedNode = useEditorStore((state) => state.setSelectedNode)
  const setSelectedField = useEditorStore((state) => state.setSelectedField)
  const setSelectedEdge = useEditorStore((state) => state.setSelectedEdge)
  const setNodePosition = useEditorStore((state) => state.setNodePosition)
  const setNodePositions = useEditorStore((state) => state.setNodePositions)
  const addField = useEditorStore((state) => state.addField)
  const deleteModel = useEditorStore((state) => state.deleteModel)
  const connectModels = useEditorStore((state) => state.connectModels)
  const { fitView, getNode, getZoom, setCenter } = useReactFlow<
    SchemaFlowNode,
    LogicalFlowEdge
  >()
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
  const initialFitCompleted = useRef(false)
  const previousLayoutDirection = useRef(layoutDirection)

  useEffect(() => {
    // Semantic updates intentionally retain live positions; React Flow stays mounted so
    // the current viewport and zoom never jump after source or relation changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodes((current) => {
      const livePositions = new Map(current.map((node) => [node.id, node.position]))
      return declarations.map((declaration) => ({
        id: declaration.id,
        type: 'schema',
        position: livePositions.get(declaration.id) ??
          savedPositions[declaration.id] ??
          fallbackPositions[declaration.id] ?? { x: 0, y: 0 },
        data: {
          declaration,
          density,
          selectedFieldIds: highlightedFieldIds,
          highlightRequiredFields,
          onSelect: setSelectedNode,
          onSelectField: setSelectedField,
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
      }))
    })
  }, [
    addField,
    declarations,
    deleteModel,
    density,
    fallbackPositions,
    highlightRequiredFields,
    highlightedFieldIds,
    savedPositions,
    setSelectedField,
    setSelectedNode,
  ])

  useEffect(() => {
    if (!nodes.length || initialFitCompleted.current) return
    initialFitCompleted.current = true
    window.setTimeout(() => void fitView({ duration: 260, padding: 0.18 }), 20)
  }, [fitView, nodes.length])

  useEffect(() => {
    if (previousLayoutDirection.current === layoutDirection || !nodes.length) return
    previousLayoutDirection.current = layoutDirection
    const positions = calculateLayout(declarations, layoutDirection, density)
    setNodePositions(positions)
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })),
    )
    window.setTimeout(() => void fitView({ duration: 280, padding: 0.18 }), 20)
  }, [declarations, density, fitView, layoutDirection, nodes.length, setNodePositions])

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

  function applyAutoLayout(): void {
    const positions = calculateLayout(declarations, layoutDirection, density)
    setNodePositions(positions)
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })),
    )
    window.setTimeout(() => void fitView({ duration: 320, padding: 0.18 }), 20)
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <section className="canvas-panel" aria-label="Schema 关系画布">
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
            onNodeDragStop={(_, node) => setNodePosition(node.id, node.position)}
            onConnect={(connection: Connection) => {
              if (connection.source && connection.target) {
                connectModels(
                  connection.source,
                  connection.target,
                  connection.sourceHandle ?? undefined,
                )
              }
            }}
            minZoom={0.15}
            maxZoom={2.2}
            selectionOnDrag
            multiSelectionKeyCode={['Meta', 'Control']}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Panel className="canvas-toolbox" position="top-left">
              <button type="button" onClick={onRequestAddModel} title="新增模型">
                <Plus size={15} />
              </button>
              <button type="button" onClick={applyAutoLayout} title="自动布局">
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                onClick={() => void fitView({ duration: 260, padding: 0.16 })}
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
          <ContextMenu.Item className="menu-item" onSelect={applyAutoLayout}>
            <LayoutGrid size={14} /> 自动布局
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function SchemaCanvas(props: { readonly onRequestAddModel: () => void }) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
