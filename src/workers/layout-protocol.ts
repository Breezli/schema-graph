export const LAYOUT_PROTOCOL_VERSION = 1 as const
export const LAYOUT_REQUEST_KIND = 'layout-schema-graph' as const
export const LAYOUT_RESULT_KIND = 'layout-schema-graph-result' as const

export type LayoutDirection = 'RIGHT' | 'DOWN'

export type LayoutNodeKind = 'model' | 'enum' | 'config' | 'type-alias'

export interface LayoutNodeInput {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly kind: LayoutNodeKind
  readonly order: number
}

export interface LayoutHierarchyEdge {
  readonly id: string
  readonly childId: string
  readonly parentId: string
}

export interface LayoutRequestIdentity {
  readonly editorSessionId: string
  readonly requestId: number
  readonly projectId: string
  readonly graphRevision: number
  readonly direction: LayoutDirection
}

export interface LayoutRequest extends LayoutRequestIdentity {
  readonly protocolVersion: typeof LAYOUT_PROTOCOL_VERSION
  readonly kind: typeof LAYOUT_REQUEST_KIND
  readonly nodes: readonly LayoutNodeInput[]
  readonly hierarchyEdges: readonly LayoutHierarchyEdge[]
}

export interface LayoutNodePosition {
  readonly id: string
  readonly x: number
  readonly y: number
}

export type LayoutErrorCode = 'INVALID_REQUEST' | 'LAYOUT_FAILED'

interface LayoutResultEnvelope extends LayoutRequestIdentity {
  readonly protocolVersion: typeof LAYOUT_PROTOCOL_VERSION
  readonly kind: typeof LAYOUT_RESULT_KIND
}

export interface LayoutSuccessResult extends LayoutResultEnvelope {
  readonly ok: true
  readonly positions: readonly LayoutNodePosition[]
}

export interface LayoutErrorResult extends LayoutResultEnvelope {
  readonly ok: false
  readonly error: {
    readonly code: LayoutErrorCode
    readonly message: string
  }
}

export type LayoutResult = LayoutSuccessResult | LayoutErrorResult

export type LayoutValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

type UnknownRecord = Record<string, unknown>

const NODE_KINDS = new Set<LayoutNodeKind>(['model', 'enum', 'config', 'type-alias'])
const ERROR_CODES = new Set<LayoutErrorCode>(['INVALID_REQUEST', 'LAYOUT_FAILED'])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDirection(value: unknown): value is LayoutDirection {
  return value === 'RIGHT' || value === 'DOWN'
}

function validateIdentity(value: UnknownRecord): string | undefined {
  if (!isNonEmptyString(value.editorSessionId)) {
    return 'editorSessionId must not be empty.'
  }
  if (!isNonNegativeSafeInteger(value.requestId)) {
    return 'requestId must be a non-negative safe integer.'
  }
  if (!isNonEmptyString(value.projectId)) return 'projectId must not be empty.'
  if (!isNonNegativeSafeInteger(value.graphRevision)) {
    return 'graphRevision must be a non-negative safe integer.'
  }
  if (!isDirection(value.direction)) return 'direction must be RIGHT or DOWN.'
  return undefined
}

function invalid<T>(error: string): LayoutValidationResult<T> {
  return { ok: false, error }
}

export function validateLayoutRequest(
  value: unknown,
): LayoutValidationResult<LayoutRequest> {
  if (!isRecord(value)) return invalid('Layout request must be an object.')
  if (value.protocolVersion !== LAYOUT_PROTOCOL_VERSION) {
    return invalid(
      `Unsupported layout protocol version: ${String(value.protocolVersion)}.`,
    )
  }
  if (value.kind !== LAYOUT_REQUEST_KIND) {
    return invalid(`Invalid layout request kind: ${String(value.kind)}.`)
  }

  const identityError = validateIdentity(value)
  if (identityError) return invalid(identityError)
  if (!Array.isArray(value.nodes)) return invalid('nodes must be an array.')
  if (!Array.isArray(value.hierarchyEdges)) {
    return invalid('hierarchyEdges must be an array.')
  }

  const nodeIds = new Set<string>()
  for (const [index, candidate] of value.nodes.entries()) {
    if (!isRecord(candidate)) {
      return invalid(`Node at index ${index} must be an object.`)
    }
    if (!isNonEmptyString(candidate.id)) {
      return invalid(`Node at index ${index} must have a non-empty id.`)
    }
    if (nodeIds.has(candidate.id)) {
      return invalid(`Duplicate node id: ${candidate.id}`)
    }
    if (!NODE_KINDS.has(candidate.kind as LayoutNodeKind)) {
      return invalid(`Node ${candidate.id} has an invalid kind.`)
    }
    if (!isFiniteNumber(candidate.width) || candidate.width <= 0) {
      return invalid(`Node ${candidate.id} has an invalid width.`)
    }
    if (!isFiniteNumber(candidate.height) || candidate.height <= 0) {
      return invalid(`Node ${candidate.id} has an invalid height.`)
    }
    if (!isNonNegativeSafeInteger(candidate.order)) {
      return invalid(`Node ${candidate.id} has an invalid order.`)
    }
    nodeIds.add(candidate.id)
  }

  const edgeIds = new Set<string>()
  for (const [index, candidate] of value.hierarchyEdges.entries()) {
    if (!isRecord(candidate)) {
      return invalid(`Hierarchy edge at index ${index} must be an object.`)
    }
    if (!isNonEmptyString(candidate.id)) {
      return invalid(`Hierarchy edge at index ${index} must have a non-empty id.`)
    }
    if (edgeIds.has(candidate.id)) {
      return invalid(`Duplicate hierarchy edge id: ${candidate.id}`)
    }
    if (!isNonEmptyString(candidate.childId) || !isNonEmptyString(candidate.parentId)) {
      return invalid(`Hierarchy edge ${candidate.id} must have childId and parentId.`)
    }
    if (!nodeIds.has(candidate.childId) || !nodeIds.has(candidate.parentId)) {
      return invalid(`Hierarchy edge ${candidate.id} references an unknown node.`)
    }
    edgeIds.add(candidate.id)
  }

  return { ok: true, value: value as unknown as LayoutRequest }
}

export function isLayoutRequest(value: unknown): value is LayoutRequest {
  return validateLayoutRequest(value).ok
}

export function validateLayoutResult(
  value: unknown,
): LayoutValidationResult<LayoutResult> {
  if (!isRecord(value)) return invalid('Layout result must be an object.')
  if (value.protocolVersion !== LAYOUT_PROTOCOL_VERSION) {
    return invalid(
      `Unsupported layout protocol version: ${String(value.protocolVersion)}.`,
    )
  }
  if (value.kind !== LAYOUT_RESULT_KIND) {
    return invalid(`Invalid layout result kind: ${String(value.kind)}.`)
  }

  const identityError = validateIdentity(value)
  if (identityError) return invalid(identityError)
  if (typeof value.ok !== 'boolean') return invalid('Layout result ok must be boolean.')

  if (value.ok) {
    if (!Array.isArray(value.positions)) return invalid('positions must be an array.')
    const positionIds = new Set<string>()
    for (const [index, candidate] of value.positions.entries()) {
      if (!isRecord(candidate)) {
        return invalid(`Position at index ${index} must be an object.`)
      }
      if (!isNonEmptyString(candidate.id)) {
        return invalid(`Position at index ${index} must have a non-empty id.`)
      }
      if (positionIds.has(candidate.id)) {
        return invalid(`Duplicate position id: ${candidate.id}`)
      }
      if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) {
        return invalid(`Position ${candidate.id} must have finite coordinates.`)
      }
      positionIds.add(candidate.id)
    }
  } else {
    if (!isRecord(value.error))
      return invalid('Layout error result must include error.')
    if (!ERROR_CODES.has(value.error.code as LayoutErrorCode)) {
      return invalid('Layout error result has an invalid code.')
    }
    if (!isNonEmptyString(value.error.message)) {
      return invalid('Layout error result must include a message.')
    }
  }

  return { ok: true, value: value as unknown as LayoutResult }
}

export function isLayoutResult(value: unknown): value is LayoutResult {
  return validateLayoutResult(value).ok
}

export function createLayoutRequest(
  request: Omit<LayoutRequest, 'protocolVersion' | 'kind'>,
): LayoutRequest {
  return {
    protocolVersion: LAYOUT_PROTOCOL_VERSION,
    kind: LAYOUT_REQUEST_KIND,
    ...request,
  }
}

export function getLayoutRequestIdentity(
  request: LayoutRequestIdentity,
): LayoutRequestIdentity {
  return {
    editorSessionId: request.editorSessionId,
    requestId: request.requestId,
    projectId: request.projectId,
    graphRevision: request.graphRevision,
    direction: request.direction,
  }
}

export function hasSameLayoutIdentity(
  left: LayoutRequestIdentity,
  right: LayoutRequestIdentity,
): boolean {
  return (
    left.editorSessionId === right.editorSessionId &&
    left.requestId === right.requestId &&
    left.projectId === right.projectId &&
    left.graphRevision === right.graphRevision &&
    left.direction === right.direction
  )
}
