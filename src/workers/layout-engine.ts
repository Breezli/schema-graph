import type { ElkNode } from 'elkjs/lib/elk-api.js'

import {
  getLayoutRequestIdentity,
  LAYOUT_PROTOCOL_VERSION,
  LAYOUT_RESULT_KIND,
  validateLayoutRequest,
  type LayoutDirection,
  type LayoutErrorResult,
  type LayoutHierarchyEdge,
  type LayoutNodeInput,
  type LayoutNodePosition,
  type LayoutRequest,
  type LayoutResult,
} from './layout-protocol'

const NODE_SPACING = 80
const LAYER_SPACING = 180
const COMPONENT_SPACING = 140
const AUXILIARY_REGION_GAP = 220
const AUXILIARY_BUCKET_GAP = 140

const AUXILIARY_KIND_ORDER = ['model', 'enum', 'config', 'type-alias'] as const

interface PreparedGraph {
  readonly hierarchyNodes: readonly LayoutNodeInput[]
  readonly auxiliaryNodes: readonly LayoutNodeInput[]
  readonly hierarchyEdges: readonly LayoutHierarchyEdge[]
}

interface PositionedNode extends LayoutNodePosition {
  readonly width: number
  readonly height: number
}

export interface ElkLayoutExecutor {
  layout(graph: ElkNode): Promise<ElkNode>
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNodes(left: LayoutNodeInput, right: LayoutNodeInput): number {
  return left.order - right.order || compareIds(left.id, right.id)
}

function compareEdges(left: LayoutHierarchyEdge, right: LayoutHierarchyEdge): number {
  return (
    compareIds(left.childId, right.childId) ||
    compareIds(left.parentId, right.parentId) ||
    compareIds(left.id, right.id)
  )
}

function invalidRequest(request: unknown, message: string): LayoutErrorResult {
  const candidate =
    typeof request === 'object' && request !== null
      ? (request as Record<string, unknown>)
      : undefined
  return {
    protocolVersion: LAYOUT_PROTOCOL_VERSION,
    kind: LAYOUT_RESULT_KIND,
    editorSessionId:
      typeof candidate?.editorSessionId === 'string' && candidate.editorSessionId
        ? candidate.editorSessionId
        : 'invalid-editor-session',
    requestId:
      Number.isSafeInteger(candidate?.requestId) &&
      (candidate?.requestId as number) >= 0
        ? (candidate?.requestId as number)
        : 0,
    projectId:
      typeof candidate?.projectId === 'string' && candidate.projectId
        ? candidate.projectId
        : 'invalid-project',
    graphRevision:
      Number.isSafeInteger(candidate?.graphRevision) &&
      (candidate?.graphRevision as number) >= 0
        ? (candidate?.graphRevision as number)
        : 0,
    direction: candidate?.direction === 'DOWN' ? 'DOWN' : 'RIGHT',
    ok: false,
    error: { code: 'INVALID_REQUEST', message },
  }
}

function prepareGraph(request: LayoutRequest): PreparedGraph {
  const nodes = [...request.nodes].sort(compareNodes)
  const modelIds = new Set(
    nodes.filter((node) => node.kind === 'model').map((node) => node.id),
  )

  // The request boundary is the FK hierarchy allow-list. Non-model edges are
  // intentionally ignored rather than inferred from parser/domain data.
  const hierarchyEdges = request.hierarchyEdges
    .filter((edge) => modelIds.has(edge.childId) && modelIds.has(edge.parentId))
    .sort(compareEdges)
  const connectedModelIds = new Set<string>()
  for (const edge of hierarchyEdges) {
    connectedModelIds.add(edge.childId)
    connectedModelIds.add(edge.parentId)
  }

  return {
    hierarchyNodes: nodes.filter((node) => connectedModelIds.has(node.id)),
    // A model without a caller-supplied FK hierarchy edge is deliberately
    // treated as disconnected and packed with declarations in the auxiliary
    // region. It therefore cannot alter the hierarchy's semantic ranks.
    auxiliaryNodes: nodes.filter((node) => !connectedModelIds.has(node.id)),
    hierarchyEdges,
  }
}

function createElkGraph(direction: LayoutDirection, graph: PreparedGraph): ElkNode {
  return {
    id: 'schema-layout-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.layering.strategy': 'LONGEST_PATH',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': String(NODE_SPACING),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING),
      'elk.spacing.edgeNode': '60',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '40',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(COMPONENT_SPACING),
    },
    children: graph.hierarchyNodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: graph.hierarchyEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.childId],
      targets: [edge.parentId],
    })),
  }
}

function normalizeHierarchy(
  laidOutGraph: ElkNode,
  nodeById: ReadonlyMap<string, LayoutNodeInput>,
): PositionedNode[] {
  const children = laidOutGraph.children ?? []
  const minimumX = Math.min(...children.map((node) => node.x ?? 0), 0)
  const minimumY = Math.min(...children.map((node) => node.y ?? 0), 0)

  return children.map((node) => {
    const input = nodeById.get(node.id)
    if (!input) throw new Error(`ELK returned unknown node ${node.id}.`)
    return {
      id: node.id,
      x: (node.x ?? 0) - minimumX,
      y: (node.y ?? 0) - minimumY,
      width: input.width,
      height: input.height,
    }
  })
}

function getBounds(nodes: readonly PositionedNode[]): {
  readonly width: number
  readonly height: number
} {
  return {
    width: Math.max(...nodes.map((node) => node.x + node.width), 0),
    height: Math.max(...nodes.map((node) => node.y + node.height), 0),
  }
}

interface PackedRegion {
  readonly nodes: readonly PositionedNode[]
  readonly width: number
  readonly height: number
}

function packBucket(
  direction: LayoutDirection,
  nodes: readonly LayoutNodeInput[],
): PackedRegion {
  if (!nodes.length) return { nodes: [], width: 0, height: 0 }

  const paddedArea = nodes.reduce(
    (area, node) => area + (node.width + NODE_SPACING) * (node.height + NODE_SPACING),
    0,
  )
  const targetPrimary = Math.sqrt(paddedArea)
  const positions: PositionedNode[] = []
  let primaryCursor = 0
  let secondaryCursor = 0
  let secondaryExtent = 0

  for (const node of nodes) {
    const primarySize = direction === 'RIGHT' ? node.width : node.height
    const secondarySize = direction === 'RIGHT' ? node.height : node.width
    if (primaryCursor > 0 && primaryCursor + primarySize > targetPrimary) {
      primaryCursor = 0
      secondaryCursor += secondaryExtent + NODE_SPACING
      secondaryExtent = 0
    }

    positions.push({
      id: node.id,
      x: direction === 'RIGHT' ? primaryCursor : secondaryCursor,
      y: direction === 'RIGHT' ? secondaryCursor : primaryCursor,
      width: node.width,
      height: node.height,
    })
    primaryCursor += primarySize + NODE_SPACING
    secondaryExtent = Math.max(secondaryExtent, secondarySize)
  }

  const bounds = getBounds(positions)
  return { nodes: positions, ...bounds }
}

function placeBucketRegions(
  direction: LayoutDirection,
  regions: readonly PackedRegion[],
): PositionedNode[] {
  const columnWidths = [0, 0]
  const rowHeights = [0, 0]

  for (const [index, region] of regions.entries()) {
    const column = direction === 'RIGHT' ? index % 2 : Math.floor(index / 2)
    const row = direction === 'RIGHT' ? Math.floor(index / 2) : index % 2
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, region.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, region.height)
  }

  const secondColumnX = (columnWidths[0] ?? 0) + AUXILIARY_BUCKET_GAP
  const secondRowY = (rowHeights[0] ?? 0) + AUXILIARY_BUCKET_GAP
  return regions.flatMap((region, index) => {
    const column = direction === 'RIGHT' ? index % 2 : Math.floor(index / 2)
    const row = direction === 'RIGHT' ? Math.floor(index / 2) : index % 2
    const offsetX = column === 0 ? 0 : secondColumnX
    const offsetY = row === 0 ? 0 : secondRowY
    return region.nodes.map((node) => ({
      ...node,
      x: node.x + offsetX,
      y: node.y + offsetY,
    }))
  })
}

function packAuxiliaryNodes(
  direction: LayoutDirection,
  nodes: readonly LayoutNodeInput[],
  hierarchy: readonly PositionedNode[],
): PositionedNode[] {
  const bounds = getBounds(hierarchy)
  const buckets = new Map(
    AUXILIARY_KIND_ORDER.map((kind) => [kind, [] as LayoutNodeInput[]]),
  )
  for (const node of nodes) buckets.get(node.kind)?.push(node)

  const regions = AUXILIARY_KIND_ORDER.map((kind) =>
    packBucket(direction, buckets.get(kind) ?? []),
  )
  const offset =
    direction === 'RIGHT'
      ? { x: 0, y: hierarchy.length ? bounds.height + AUXILIARY_REGION_GAP : 0 }
      : { x: hierarchy.length ? bounds.width + AUXILIARY_REGION_GAP : 0, y: 0 }

  return placeBucketRegions(direction, regions).map((node) => ({
    ...node,
    x: node.x + offset.x,
    y: node.y + offset.y,
  }))
}

export async function layoutSchemaGraph(
  requestValue: unknown,
  elk: ElkLayoutExecutor,
): Promise<LayoutResult> {
  const validation = validateLayoutRequest(requestValue)
  if (!validation.ok) return invalidRequest(requestValue, validation.error)
  const request = validation.value

  try {
    const graph = prepareGraph(request)
    const nodeById = new Map(request.nodes.map((node) => [node.id, node]))
    const hierarchy = graph.hierarchyNodes.length
      ? normalizeHierarchy(
          await elk.layout(createElkGraph(request.direction, graph)),
          nodeById,
        )
      : []
    const auxiliary = packAuxiliaryNodes(
      request.direction,
      graph.auxiliaryNodes,
      hierarchy,
    )
    const positionById = new Map(
      [...hierarchy, ...auxiliary].map(({ id, x, y }) => [id, { id, x, y }]),
    )

    return {
      protocolVersion: LAYOUT_PROTOCOL_VERSION,
      kind: LAYOUT_RESULT_KIND,
      ...getLayoutRequestIdentity(request),
      ok: true,
      positions: [...request.nodes]
        .sort(compareNodes)
        .map((node) => positionById.get(node.id))
        .filter((position): position is LayoutNodePosition => position !== undefined),
    }
  } catch (error) {
    return {
      protocolVersion: LAYOUT_PROTOCOL_VERSION,
      kind: LAYOUT_RESULT_KIND,
      ...getLayoutRequestIdentity(request),
      ok: false,
      error: {
        code: 'LAYOUT_FAILED',
        message: error instanceof Error ? error.message : 'ELK layout failed.',
      },
    }
  }
}
