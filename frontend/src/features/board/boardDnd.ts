import {
  closestCenter,
  closestCorners,
  getFirstCollision,
  KeyboardCode,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import type { ID } from '@/api/types'

/**
 * dnd-kit plumbing for the board. Draggable cards use the issue id (a number) as their dnd id;
 * columns are droppables with string ids `column:<statusId>`.
 */

/** Visible card ids per column (status id → ids, top to bottom). */
export type ColumnItems = Readonly<Record<ID, readonly ID[]>>

/** `data` attached to column droppables (read by the keyboard coordinate getter). */
export interface ColumnDroppableData {
  type: 'column'
  statusId: ID
  /** Number of cards currently rendered in the column. */
  count: number
}

const COLUMN_PREFIX = 'column:'

/** Droppable id of a column. */
export function columnDroppableId(statusId: ID): string {
  return `${COLUMN_PREFIX}${statusId}`
}

/** Status id of a column droppable id, or null for card ids. */
export function statusIdOfDroppable(id: UniqueIdentifier): ID | null {
  if (typeof id !== 'string' || !id.startsWith(COLUMN_PREFIX)) return null
  const statusId = Number(id.slice(COLUMN_PREFIX.length))
  return Number.isFinite(statusId) ? statusId : null
}

/** The column (status id) holding a card or column id, or null. */
export function findColumn(id: UniqueIdentifier, items: ColumnItems): ID | null {
  const columnId = statusIdOfDroppable(id)
  if (columnId != null) return columnId in items ? columnId : null
  if (typeof id !== 'number') return null
  for (const [statusId, ids] of Object.entries(items)) {
    if (ids.includes(id)) return Number(statusId)
  }
  return null
}

/** Keyboard dragging: Space picks up; Space or Enter drops; Escape cancels. Enter alone opens a card. */
export const BOARD_KEYBOARD_CODES: KeyboardCodes = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter],
}

/**
 * State the collision detection keeps between calls (one instance per board, created once with
 * `useState(() => new CollisionMemory())`).
 */
export class CollisionMemory {
  /** Last resolved target, reused while nothing is under the dragged card. */
  lastOverId: UniqueIdentifier | null = null
  /** Set when a card just moved to another column (the layout shifts for a frame). */
  movedToNewColumn = false

  /** A new drag starts: forget the previous target. */
  reset(): void {
    this.lastOverId = null
    this.movedToNewColumn = false
  }

  /** The dragged card was just moved into another column's list. */
  markColumnChange(): void {
    this.movedToNewColumn = true
  }

  /** The layout has settled after a column change; collisions can be trusted again. */
  settle(): void {
    this.movedToNewColumn = false
  }
}

/**
 * Collision detection for sortable lists in several columns (after dnd-kit's multi-container
 * recipe): the pointer (or, for the keyboard, rectangle intersection) picks a column or card;
 * when it picks a column that has cards, the closest card inside it wins. While the layout
 * shifts after a card changes column, the previous target is kept so cards don't flicker.
 */
export function createBoardCollisionDetection(
  items: ColumnItems,
  activeId: UniqueIdentifier | null,
  memory: CollisionMemory,
): CollisionDetection {
  return (args) => {
    const pointerHits = pointerWithin(args)
    const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')

    if (overId != null) {
      const statusId = statusIdOfDroppable(overId)
      const ids = statusId != null ? (items[statusId] ?? []) : []
      if (ids.length > 0) {
        const closest = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => typeof container.id === 'number' && ids.includes(container.id),
          ),
        })
        overId = closest[0]?.id ?? overId
      }
      memory.lastOverId = overId
      return [{ id: overId }]
    }

    if (memory.movedToNewColumn && activeId != null) memory.lastOverId = activeId
    return memory.lastOverId != null ? [{ id: memory.lastOverId }] : []
  }
}

const ARROW_KEYS: readonly string[] = [KeyboardCode.Down, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Left]

/** Vertical offset used when moving a card into an empty column (below the column header). */
const EMPTY_COLUMN_OFFSET = 48

/**
 * Arrow-key movement across columns: ↑/↓ move within the current column, ←/→ jump to the
 * nearest card of the neighbouring column (or into it, when it is empty).
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (!ARROW_KEYS.includes(event.code)) return undefined
  event.preventDefault()

  const { active, collisionRect, droppableRects, droppableContainers, over } = context
  if (!active || !collisionRect) return undefined

  const candidates: DroppableContainer[] = []
  for (const entry of droppableContainers.getEnabled()) {
    if (entry.id === active.id) continue
    const rect = droppableRects.get(entry.id)
    if (!rect) continue
    const data = entry.data.current as Partial<ColumnDroppableData> | undefined
    // Aim at cards; a column itself is only a target while it shows no cards.
    if (data?.type === 'column' && (data.count ?? 0) > 0) continue
    const sameColumn = rect.left < collisionRect.right && rect.right > collisionRect.left
    switch (event.code) {
      case KeyboardCode.Down:
        if (sameColumn && rect.top > collisionRect.top) candidates.push(entry)
        break
      case KeyboardCode.Up:
        if (sameColumn && rect.top < collisionRect.top) candidates.push(entry)
        break
      case KeyboardCode.Left:
        if (rect.right <= collisionRect.left) candidates.push(entry)
        break
      case KeyboardCode.Right:
        if (rect.left >= collisionRect.right) candidates.push(entry)
        break
    }
  }

  const collisions = closestCorners({
    active,
    collisionRect,
    droppableRects,
    droppableContainers: candidates,
    pointerCoordinates: null,
  })
  let targetId = getFirstCollision(collisions, 'id')
  if (targetId === over?.id && collisions.length > 1) targetId = collisions[1].id
  if (targetId == null) return undefined

  const target = droppableContainers.get(targetId)
  const rect = target ? droppableRects.get(target.id) : undefined
  if (!target || !rect) return undefined
  if ((target.data.current as Partial<ColumnDroppableData> | undefined)?.type === 'column') {
    return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + EMPTY_COLUMN_OFFSET }
  }
  return { x: rect.left, y: rect.top }
}
