import type {
  SchemaArgument,
  SchemaAttribute,
  SchemaDeclaration,
  SchemaProjectSnapshot,
  SchemaValue,
} from '@/domain/schema'

type LocatedDeclaration = Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }>

export interface DeclarationPositionReconciliation<T> {
  readonly positions: Readonly<Record<string, T>>
  readonly declarationIdRemap: Readonly<Record<string, string>>
  readonly newDeclarationIds: readonly string[]
}

interface DeclarationIdentity {
  readonly declaration: LocatedDeclaration
  readonly order: number
  readonly signature: string
}

function serializeValue(value: SchemaValue): unknown {
  switch (value.kind) {
    case 'literal':
      return [value.kind, value.value]
    case 'path':
      return [value.kind, value.value]
    case 'array':
      return [value.kind, value.items.map(serializeValue)]
    case 'functionCall':
      return [value.kind, value.path, value.args.map(serializeArgument)]
  }
}

function serializeArgument(argument: SchemaArgument): unknown {
  return [argument.name, serializeValue(argument.value)]
}

function serializeAttribute(attribute: SchemaAttribute): unknown {
  return [attribute.path, attribute.args.map(serializeArgument)]
}

function declarationSignature(declaration: LocatedDeclaration): string {
  switch (declaration.kind) {
    case 'model':
    case 'view':
    case 'type':
      return JSON.stringify(
        declaration.members
          .filter((member) => member.kind !== 'commentBlock')
          .map((member) =>
            member.kind === 'field'
              ? [
                  member.kind,
                  member.name,
                  member.type.name === declaration.name ? '$self' : member.type.name,
                  member.type.modifier,
                  member.type.unsupported,
                  member.attributes.map(serializeAttribute),
                ]
              : [member.kind, serializeAttribute(member.attribute)],
          ),
      )
    case 'enum':
      return JSON.stringify(
        declaration.members
          .filter((member) => member.kind !== 'commentBlock')
          .map((member) =>
            member.kind === 'enumValue'
              ? [member.kind, member.name, member.attributes.map(serializeAttribute)]
              : [member.kind, serializeAttribute(member.attribute)],
          ),
      )
    case 'datasource':
    case 'generator':
      return JSON.stringify(
        declaration.members
          .filter((member) => member.kind !== 'commentBlock')
          .map((member) => [member.kind, member.name, serializeValue(member.value)]),
      )
    case 'typeAlias':
      return JSON.stringify([
        declaration.type.name === declaration.name ? '$self' : declaration.type.name,
        declaration.type.modifier,
        declaration.type.unsupported,
        declaration.attributes.map(serializeAttribute),
      ])
  }
}

function declarationIdentities(
  snapshot: SchemaProjectSnapshot,
): readonly DeclarationIdentity[] {
  const declarations = snapshot.graph.declarations.filter(
    (declaration): declaration is LocatedDeclaration =>
      declaration.kind !== 'commentBlock',
  )
  const orders = new Map<string, number>()

  return declarations.map((declaration) => {
    const key = `${declaration.source.filePath}\0${declaration.kind}`
    const order = orders.get(key) ?? 0
    orders.set(key, order + 1)
    return {
      declaration,
      order,
      signature: declarationSignature(declaration),
    }
  })
}

function rangesOverlap(
  previous: LocatedDeclaration,
  next: LocatedDeclaration,
): boolean {
  const previousRange = previous.source.range
  const nextRange = next.source.range
  if (!previousRange || !nextRange) return false
  return (
    previousRange.start.offset <= nextRange.end.offset &&
    nextRange.start.offset <= previousRange.end.offset
  )
}

function isConservativeCandidate(
  previous: DeclarationIdentity,
  next: DeclarationIdentity,
): boolean {
  return (
    previous.declaration.source.filePath === next.declaration.source.filePath &&
    previous.declaration.kind === next.declaration.kind &&
    previous.signature === next.signature &&
    (previous.order === next.order ||
      rangesOverlap(previous.declaration, next.declaration))
  )
}

/**
 * Conservatively migrates saved positions when a declaration's parser ID changes.
 * Exact IDs are untouched, and a removed/added pair is accepted only when both
 * sides identify each other uniquely by file, kind, source location/order and
 * declaration contents excluding the declaration name.
 */
export function reconcileDeclarationPositions<T>(
  previousSnapshot: SchemaProjectSnapshot | undefined,
  nextSnapshot: SchemaProjectSnapshot,
  positions: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  return reconcileDeclarationPositionsDetailed(
    previousSnapshot,
    nextSnapshot,
    positions,
  ).positions
}

export function reconcileDeclarationPositionsDetailed<T>(
  previousSnapshot: SchemaProjectSnapshot | undefined,
  nextSnapshot: SchemaProjectSnapshot,
  positions: Readonly<Record<string, T>>,
): DeclarationPositionReconciliation<T> {
  if (!previousSnapshot) {
    return {
      positions,
      declarationIdRemap: {},
      newDeclarationIds: declarationIdentities(nextSnapshot)
        .map(({ declaration }) => declaration.id)
        .filter((id) => !(id in positions)),
    }
  }

  const previousIdentities = declarationIdentities(previousSnapshot)
  const nextIdentities = declarationIdentities(nextSnapshot)
  const previousIds = new Set(
    previousIdentities.map(({ declaration }) => declaration.id),
  )
  const nextIds = new Set(nextIdentities.map(({ declaration }) => declaration.id))
  const removed = previousIdentities.filter(
    ({ declaration }) => !nextIds.has(declaration.id),
  )
  const added = nextIdentities.filter(
    ({ declaration }) => !previousIds.has(declaration.id),
  )

  const candidatesByRemoved = new Map<string, readonly DeclarationIdentity[]>()
  const candidatesByAdded = new Map<string, readonly DeclarationIdentity[]>()
  for (const previous of removed) {
    candidatesByRemoved.set(
      previous.declaration.id,
      added.filter((next) => isConservativeCandidate(previous, next)),
    )
  }
  for (const next of added) {
    candidatesByAdded.set(
      next.declaration.id,
      removed.filter((previous) => isConservativeCandidate(previous, next)),
    )
  }

  let reconciled: Record<string, T> | undefined
  const declarationIdRemap: Record<string, string> = {}
  for (const previous of removed) {
    const nextCandidates = candidatesByRemoved.get(previous.declaration.id) ?? []
    const next = nextCandidates[0]
    if (
      nextCandidates.length !== 1 ||
      !next ||
      candidatesByAdded.get(next.declaration.id)?.length !== 1
    ) {
      continue
    }

    declarationIdRemap[previous.declaration.id] = next.declaration.id
    if (!(previous.declaration.id in positions) || next.declaration.id in positions) {
      continue
    }
    reconciled ??= { ...positions }
    reconciled[next.declaration.id] = positions[previous.declaration.id] as T
    delete reconciled[previous.declaration.id]
  }

  const finalPositions = reconciled ?? positions
  const newDeclarationIds = added
    .filter(({ declaration }) => !(declaration.id in finalPositions))
    .map(({ declaration }) => declaration.id)

  return {
    positions: finalPositions,
    declarationIdRemap,
    newDeclarationIds,
  }
}

export interface DerivedCanvasPosition {
  readonly x: number
  readonly y: number
}

export function placeNewDeclarationPositions(
  snapshot: SchemaProjectSnapshot,
  positions: Readonly<Record<string, DerivedCanvasPosition>>,
  newDeclarationIds: readonly string[],
  direction: 'RIGHT' | 'DOWN',
): Readonly<Record<string, DerivedCanvasPosition>> {
  const missingIds = newDeclarationIds.filter((id) => !(id in positions))
  if (!missingIds.length) return positions

  const next = { ...positions }
  const occupied = new Set(
    Object.values(next).map(({ x, y }) => `${Math.round(x)}:${Math.round(y)}`),
  )
  const existing = Object.values(next)
  let boundary =
    direction === 'RIGHT'
      ? Math.max(-320, ...existing.map(({ x }) => x)) + 320
      : Math.max(-220, ...existing.map(({ y }) => y)) + 220

  const relationNeighbors = new Map<string, string[]>()
  for (const relation of snapshot.graph.logicalRelations) {
    const source = relationNeighbors.get(relation.source.modelId) ?? []
    source.push(relation.target.modelId)
    relationNeighbors.set(relation.source.modelId, source)
    const target = relationNeighbors.get(relation.target.modelId) ?? []
    target.push(relation.source.modelId)
    relationNeighbors.set(relation.target.modelId, target)
  }

  for (const id of missingIds) {
    const relatedPosition = (relationNeighbors.get(id) ?? [])
      .map((relatedId) => next[relatedId])
      .find((position) => position !== undefined)
    let candidate = relatedPosition
      ? direction === 'RIGHT'
        ? { x: relatedPosition.x + 320, y: relatedPosition.y }
        : { x: relatedPosition.x, y: relatedPosition.y + 220 }
      : direction === 'RIGHT'
        ? { x: boundary, y: 0 }
        : { x: 0, y: boundary }

    while (occupied.has(`${Math.round(candidate.x)}:${Math.round(candidate.y)}`)) {
      candidate =
        direction === 'RIGHT'
          ? { x: candidate.x, y: candidate.y + 180 }
          : { x: candidate.x + 280, y: candidate.y }
    }
    next[id] = candidate
    occupied.add(`${Math.round(candidate.x)}:${Math.round(candidate.y)}`)
    if (!relatedPosition) boundary += direction === 'RIGHT' ? 320 : 220
  }

  return next
}
