import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'

import type { RelationCardinality, SchemaLogicalRelation } from '@/domain/schema'
import type { EdgeStyle, RelationNotation } from '@/state'

export interface LogicalRelationEdgeData extends Record<string, unknown> {
  readonly relation: SchemaLogicalRelation
  readonly notation: RelationNotation
  readonly lineStyle: EdgeStyle
  readonly label?: string
}

export type LogicalFlowEdge = Edge<LogicalRelationEdgeData, 'logical-relation'>

function CrowFootMark({ cardinality }: { readonly cardinality: RelationCardinality }) {
  return (
    <svg className="crow-foot-mark" viewBox="0 0 28 14" aria-hidden="true">
      {cardinality !== 'one' && <circle cx="5" cy="7" r="3" />}
      {cardinality === 'one' || cardinality === 'zero-one' ? (
        <>
          <path d="M12 2v10" />
          <path d="M17 2v10" />
        </>
      ) : (
        <>
          <path d="M11 7h6" />
          <path d="m17 7 7-5" />
          <path d="m17 7 7 5" />
          <path d="M17 7h8" />
        </>
      )}
    </svg>
  )
}

function CardinalityMark({
  cardinality,
  notation,
}: {
  readonly cardinality: RelationCardinality
  readonly notation: RelationNotation
}) {
  if (notation === 'numeric') {
    return (
      <span className="numeric-cardinality">
        {cardinality === 'one' ? '1' : cardinality === 'zero-one' ? '0..1' : '0..N'}
      </span>
    )
  }
  return <CrowFootMark cardinality={cardinality} />
}

export function LogicalRelationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<LogicalFlowEdge>) {
  const pathResult =
    data?.lineStyle === 'bezier'
      ? getBezierPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
        })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: 10,
        })
  const [edgePath, labelX, labelY] = pathResult
  const sourceMarkX = sourceX + (targetX - sourceX) * 0.12
  const sourceMarkY = sourceY + (targetY - sourceY) * 0.12
  const targetMarkX = sourceX + (targetX - sourceX) * 0.88
  const targetMarkY = sourceY + (targetY - sourceY) * 0.88

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        className={selected ? 'logical-edge is-selected' : 'logical-edge'}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-cardinality edge-cardinality-source ${selected ? 'is-selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${sourceMarkX}px, ${sourceMarkY}px)`,
          }}
        >
          <CardinalityMark
            cardinality={data?.relation.source.cardinality ?? 'one'}
            notation={data?.notation ?? 'crowfoot'}
          />
        </div>
        <div
          className={`edge-cardinality edge-cardinality-target ${selected ? 'is-selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${targetMarkX}px, ${targetMarkY}px)`,
          }}
        >
          <CardinalityMark
            cardinality={data?.relation.target.cardinality ?? 'one'}
            notation={data?.notation ?? 'crowfoot'}
          />
        </div>
        {data?.label && (
          <div
            className={`logical-edge-label ${selected ? 'is-selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.label}
            {data.relation.foreignKey && <span>FK</span>}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
