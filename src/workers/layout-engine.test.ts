import { describe, expect, it } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'

import { layoutSchemaGraph } from './layout-engine'
import {
  createLayoutRequest,
  LAYOUT_PROTOCOL_VERSION,
  LAYOUT_REQUEST_KIND,
  LAYOUT_RESULT_KIND,
  validateLayoutRequest,
  validateLayoutResult,
  type LayoutNodeKind,
  type LayoutDirection,
  type LayoutHierarchyEdge,
  type LayoutNodeInput,
  type LayoutNodePosition,
  type LayoutRequest,
} from './layout-protocol'

function model(id: string, order: number): LayoutNodeInput {
  return { id, order, kind: 'model', width: 160, height: 100 }
}

function request(
  nodes: readonly LayoutNodeInput[],
  hierarchyEdges: readonly LayoutHierarchyEdge[],
  direction: LayoutDirection = 'RIGHT',
): LayoutRequest {
  return createLayoutRequest({
    editorSessionId: 'editor-session-1',
    requestId: 1,
    projectId: 'project-1',
    graphRevision: 7,
    direction,
    nodes,
    hierarchyEdges,
  })
}

async function positionsFor(layoutRequest: LayoutRequest) {
  const result = await runLayout(layoutRequest)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return new Map(result.positions.map((position) => [position.id, position]))
}

async function runLayout(requestValue: unknown) {
  const elk = new ELK()
  return layoutSchemaGraph(requestValue, elk)
}

function position(
  positions: ReadonlyMap<string, LayoutNodePosition>,
  id: string,
): LayoutNodePosition {
  const value = positions.get(id)
  if (!value) throw new Error(`Missing position for ${id}`)
  return value
}

function expectNoOverlap(
  positions: ReadonlyMap<string, LayoutNodePosition>,
  nodes: readonly LayoutNodeInput[],
): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const leftNode = nodes[leftIndex]
      const rightNode = nodes[rightIndex]
      if (!leftNode || !rightNode) continue
      const left = position(positions, leftNode.id)
      const right = position(positions, rightNode.id)
      const separated =
        left.x + leftNode.width <= right.x ||
        right.x + rightNode.width <= left.x ||
        left.y + leftNode.height <= right.y ||
        right.y + rightNode.height <= left.y
      expect(separated, `${leftNode.id} overlaps ${rightNode.id}`).toBe(true)
    }
  }
}

function getPositionBounds(
  positions: ReadonlyMap<string, LayoutNodePosition>,
  nodes: readonly LayoutNodeInput[],
): { width: number; height: number } {
  return {
    width: Math.max(
      ...nodes.map((node) => position(positions, node.id).x + node.width),
      0,
    ),
    height: Math.max(
      ...nodes.map((node) => position(positions, node.id).y + node.height),
      0,
    ),
  }
}

describe('ELK layout engine', () => {
  it.each([
    ['RIGHT', 'x'],
    ['DOWN', 'y'],
  ] as const)('puts a three-level root toward %s', async (direction, axis) => {
    const nodes = [model('leaf', 0), model('middle', 1), model('root', 2)]
    const positions = await positionsFor(
      request(
        nodes,
        [
          { id: 'leaf-middle', childId: 'leaf', parentId: 'middle' },
          { id: 'middle-root', childId: 'middle', parentId: 'root' },
        ],
        direction,
      ),
    )

    expect(position(positions, 'leaf')[axis]).toBeLessThan(
      position(positions, 'middle')[axis],
    )
    expect(position(positions, 'middle')[axis]).toBeLessThan(
      position(positions, 'root')[axis],
    )
  })

  it('retains three semantic ranks when a chain has a shortcut', async () => {
    const nodes = [model('leaf', 0), model('middle', 1), model('root', 2)]
    const positions = await positionsFor(
      request(nodes, [
        { id: 'leaf-middle', childId: 'leaf', parentId: 'middle' },
        { id: 'middle-root', childId: 'middle', parentId: 'root' },
        { id: 'leaf-root', childId: 'leaf', parentId: 'root' },
      ]),
    )

    expect(position(positions, 'leaf').x).toBeLessThan(position(positions, 'middle').x)
    expect(position(positions, 'middle').x).toBeLessThan(position(positions, 'root').x)
  })

  it('lays out branching hierarchies without overlap', async () => {
    const nodes = [model('left', 0), model('right', 1), model('root', 2)]
    const positions = await positionsFor(
      request(nodes, [
        { id: 'left-root', childId: 'left', parentId: 'root' },
        { id: 'right-root', childId: 'right', parentId: 'root' },
      ]),
    )

    expect(position(positions, 'left').x).toBeLessThan(position(positions, 'root').x)
    expect(position(positions, 'right').x).toBeLessThan(position(positions, 'root').x)
    expectNoOverlap(positions, nodes)
  })

  it('is deterministic for repeated input', async () => {
    const layoutRequest = request(
      [model('b', 1), model('root', 2), model('a', 0)],
      [
        { id: 'b-root', childId: 'b', parentId: 'root' },
        { id: 'a-root', childId: 'a', parentId: 'root' },
      ],
    )
    const first = await runLayout(layoutRequest)
    const second = await runLayout(layoutRequest)

    expect(first).toEqual(second)
  })

  it('handles a cycle without an SCC prepass', async () => {
    const nodes = [model('a', 0), model('b', 1), model('c', 2)]
    const positions = await positionsFor(
      request(nodes, [
        { id: 'a-b', childId: 'a', parentId: 'b' },
        { id: 'b-c', childId: 'b', parentId: 'c' },
        { id: 'c-a', childId: 'c', parentId: 'a' },
      ]),
    )

    expect(positions.size).toBe(3)
    expectNoOverlap(positions, nodes)
  })

  it('handles self edges', async () => {
    const nodes = [model('self', 0)]
    const positions = await positionsFor(
      request(nodes, [{ id: 'self-edge', childId: 'self', parentId: 'self' }]),
    )

    expect(Number.isFinite(position(positions, 'self').x)).toBe(true)
    expect(Number.isFinite(position(positions, 'self').y)).toBe(true)
  })

  it('handles parallel hierarchy edges', async () => {
    const nodes = [model('child', 0), model('root', 1)]
    const positions = await positionsFor(
      request(nodes, [
        { id: 'first', childId: 'child', parentId: 'root' },
        { id: 'second', childId: 'child', parentId: 'root' },
      ]),
    )

    expect(position(positions, 'child').x).toBeLessThan(position(positions, 'root').x)
    expectNoOverlap(positions, nodes)
  })

  it('keeps disconnected models out of hierarchy ranks', async () => {
    const hierarchyNodes = [model('child', 0), model('root', 1)]
    const edges = [{ id: 'child-root', childId: 'child', parentId: 'root' }]
    const hierarchyOnly = await positionsFor(request(hierarchyNodes, edges))
    const disconnected = model('standalone', 2)
    const withDisconnected = await positionsFor(
      request([...hierarchyNodes, disconnected], edges),
    )

    expect(position(withDisconnected, 'child')).toEqual(
      position(hierarchyOnly, 'child'),
    )
    expect(position(withDisconnected, 'root')).toEqual(position(hierarchyOnly, 'root'))
    expect(position(withDisconnected, 'standalone').y).toBeGreaterThan(
      Math.max(
        position(withDisconnected, 'child').y + hierarchyNodes[0]!.height,
        position(withDisconnected, 'root').y + hierarchyNodes[1]!.height,
      ),
    )
    expectNoOverlap(withDisconnected, [...hierarchyNodes, disconnected])
  })

  it('packs declaration kinds into deterministic auxiliary regions', async () => {
    const nodes: LayoutNodeInput[] = [
      model('child', 0),
      model('root', 1),
      { id: 'role', order: 2, kind: 'enum', width: 120, height: 80 },
      { id: 'generator', order: 3, kind: 'config', width: 140, height: 90 },
      { id: 'json', order: 4, kind: 'type-alias', width: 100, height: 70 },
    ]
    const positions = await positionsFor(
      request(nodes, [{ id: 'child-root', childId: 'child', parentId: 'root' }]),
    )
    const hierarchyBottom = Math.max(
      position(positions, 'child').y + nodes[0]!.height,
      position(positions, 'root').y + nodes[1]!.height,
    )

    expect(position(positions, 'role').y).toBeGreaterThan(hierarchyBottom)
    expect(position(positions, 'role').x).toBe(position(positions, 'json').x)
    expect(position(positions, 'generator').x).toBeLessThan(
      position(positions, 'json').x,
    )
    expect(position(positions, 'role').y).toBeLessThan(
      position(positions, 'generator').y,
    )
    expectNoOverlap(positions, nodes)
  })

  it.each(['RIGHT', 'DOWN'] as const)(
    'wraps 100 disconnected nodes with bounded %s dimensions',
    async (direction) => {
      const nodes = Array.from({ length: 100 }, (_, index) =>
        model(`standalone-${String(index).padStart(3, '0')}`, index),
      )
      const positions = await positionsFor(request(nodes, [], direction))
      const bounds = getPositionBounds(positions, nodes)

      expect(positions.size).toBe(100)
      expectNoOverlap(positions, nodes)
      expect(bounds.width).toBeLessThanOrEqual(3_000)
      expect(bounds.height).toBeLessThanOrEqual(3_000)
      expect(
        Math.max(bounds.width / bounds.height, bounds.height / bounds.width),
      ).toBeLessThan(2)
    },
  )

  it('does not move hierarchy nodes when auxiliary buckets grow', async () => {
    const hierarchyNodes = [model('child', 0), model('root', 1)]
    const edges = [{ id: 'child-root', childId: 'child', parentId: 'root' }]
    const hierarchyOnly = await positionsFor(request(hierarchyNodes, edges))
    const kinds: LayoutNodeKind[] = ['model', 'enum', 'config', 'type-alias']
    const auxiliaries = Array.from({ length: 80 }, (_, index): LayoutNodeInput => ({
      id: `auxiliary-${index}`,
      order: index + 2,
      kind: kinds[index % kinds.length]!,
      width: 100 + (index % 3) * 20,
      height: 70 + (index % 2) * 20,
    }))
    const withAuxiliaries = await positionsFor(
      request([...hierarchyNodes, ...auxiliaries], edges),
    )

    expect(position(withAuxiliaries, 'child')).toEqual(position(hierarchyOnly, 'child'))
    expect(position(withAuxiliaries, 'root')).toEqual(position(hierarchyOnly, 'root'))
    expectNoOverlap(withAuxiliaries, [...hierarchyNodes, ...auxiliaries])
  })

  it('does not promote non-model endpoints into the ELK hierarchy', async () => {
    const nodes: LayoutNodeInput[] = [
      model('child', 0),
      model('root', 1),
      { id: 'role', order: 2, kind: 'enum', width: 120, height: 80 },
    ]
    const hierarchyOnly = await positionsFor(
      request(nodes.slice(0, 2), [
        { id: 'child-root', childId: 'child', parentId: 'root' },
      ]),
    )
    const positions = await positionsFor(
      request(nodes, [
        { id: 'child-root', childId: 'child', parentId: 'root' },
        { id: 'role-root', childId: 'role', parentId: 'root' },
      ]),
    )

    expect(position(positions, 'child')).toEqual(position(hierarchyOnly, 'child'))
    expect(position(positions, 'root')).toEqual(position(hierarchyOnly, 'root'))
    expect(position(positions, 'role').y).toBeGreaterThan(position(positions, 'root').y)
  })

  it('returns a structured error with the request identity', async () => {
    const layoutRequest = request(
      [model('duplicate', 0), model('duplicate', 1)],
      [],
      'DOWN',
    )
    const result = await runLayout(layoutRequest)

    expect(result).toMatchObject({
      protocolVersion: LAYOUT_PROTOCOL_VERSION,
      kind: LAYOUT_RESULT_KIND,
      editorSessionId: layoutRequest.editorSessionId,
      requestId: layoutRequest.requestId,
      projectId: layoutRequest.projectId,
      graphRevision: layoutRequest.graphRevision,
      direction: layoutRequest.direction,
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    })
  })

  it('validates request and result protocol envelopes at runtime', async () => {
    const validRequest = request([model('node', 0)], [])
    expect(validateLayoutRequest(validRequest)).toEqual({
      ok: true,
      value: validRequest,
    })
    expect(
      validateLayoutRequest({ ...validRequest, protocolVersion: 2 }),
    ).toMatchObject({ ok: false })
    expect(
      validateLayoutRequest({ ...validRequest, kind: 'layout-something-else' }),
    ).toMatchObject({ ok: false })
    expect(validateLayoutRequest({ ...validRequest, direction: 'LEFT' })).toMatchObject(
      {
        ok: false,
      },
    )
    expect(validateLayoutRequest({ ...validRequest, nodes: {} })).toMatchObject({
      ok: false,
    })
    expect(
      validateLayoutRequest({
        ...validRequest,
        nodes: [{ ...model('node', 0), kind: 'view' }],
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateLayoutRequest({
        ...validRequest,
        nodes: [{ ...model('node', 0), width: 0 }],
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateLayoutRequest({
        ...validRequest,
        nodes: [{ ...model('node', 0), order: 0.5 }],
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateLayoutRequest({
        ...validRequest,
        hierarchyEdges: [{ id: 'missing', childId: 'node', parentId: 'missing' }],
      }),
    ).toMatchObject({ ok: false })

    const result = await runLayout(validRequest)
    expect(validateLayoutResult(result)).toEqual({ ok: true, value: result })
    expect(
      validateLayoutResult({ ...result, kind: LAYOUT_REQUEST_KIND }),
    ).toMatchObject({
      ok: false,
    })
    expect(
      validateLayoutResult({
        ...result,
        ok: true,
        positions: [{ id: 'node', x: NaN, y: 0 }],
      }),
    ).toMatchObject({ ok: false })
  })
})
