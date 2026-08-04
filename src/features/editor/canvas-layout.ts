import type { SchemaDeclaration } from '@/domain/schema'
import type { CanvasPosition, LayoutDirection, NodeDensity } from '@/state'

export type VisualDeclaration = Exclude<
  SchemaDeclaration,
  { readonly kind: 'commentBlock' }
>

export function declarationDimensions(
  declaration: VisualDeclaration,
  density: NodeDensity,
) {
  if (
    declaration.kind === 'model' ||
    declaration.kind === 'view' ||
    declaration.kind === 'type'
  ) {
    const count = declaration.members.filter((member) => member.kind === 'field').length
    if (density === 'overview') return { width: 190, height: 78 }
    return {
      width: 220,
      height: 66 + Math.min(count, density === 'standard' ? 7 : count) * 27,
    }
  }
  return { width: 190, height: 116 }
}

export function calculateLayout(
  declarations: readonly VisualDeclaration[],
  direction: LayoutDirection,
  density: NodeDensity,
): Readonly<Record<string, CanvasPosition>> {
  const positions: Record<string, CanvasPosition> = {}
  const columnCount = direction === 'RIGHT' ? 3 : 4
  const horizontalGap = 310
  const verticalGap = density === 'overview' ? 150 : 260

  declarations.forEach((declaration, index) => {
    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    const dimensions = declarationDimensions(declaration, density)
    positions[declaration.id] =
      direction === 'RIGHT'
        ? {
            x: column * horizontalGap,
            y: row * verticalGap + (column % 2) * 28,
          }
        : {
            x: column * horizontalGap,
            y: row * Math.max(verticalGap, dimensions.height + 80),
          }
  })
  return positions
}
