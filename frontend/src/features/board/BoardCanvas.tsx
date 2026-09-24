import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardSensorOptions,
  type MeasuringConfiguration,
  type MouseSensorOptions,
  type TouchSensorOptions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ID, Issue, Status } from '@/api/types'
import { BoardColumn } from './BoardColumn'
import {
  BOARD_KEYBOARD_CODES,
  boardKeyboardCoordinates,
  columnDroppableId,
  CollisionMemory,
  createBoardCollisionDetection,
  findColumn,
  statusIdOfDroppable,
  type ColumnDroppableData,
  type ColumnItems,
} from './boardDnd'
import type { EpicOption } from './boardFilters'
import { computeAnchors, type BoardColumns, type MoveTarget } from './boardModel'
import { IssueCardOverlay, SortableIssueCard, StaticIssueCard } from './IssueCard'

/** Props of `BoardCanvas`. */
export interface BoardCanvasProps {
  statuses: readonly Status[]
  /** Every issue per column in rank order (filters ignored). */
  columns: BoardColumns
  /** The issues left per column after the toolbar filters. */
  visibleColumns: BoardColumns
  /** Filters are narrowing the board. */
  filtered: boolean
  /** Member/admin: cards can be dragged. */
  canEdit: boolean
  /** Epic of each issue on the board (issue id → epic). */
  epics: ReadonlyMap<ID, EpicOption>
  onOpenIssue: (issueKey: string) => void
  onMoveIssue: (issue: Issue, target: MoveTarget) => void
  /** Adds "+ Create issue" at the bottom of the first column. */
  onCreateIssue?: () => void
}

/** The columns of the board — draggable for members, read-only for viewers. */
export function BoardCanvas(props: BoardCanvasProps) {
  return props.canEdit ? <DraggableBoard {...props} /> : <ReadOnlyBoard {...props} />
}

/**
 * Horizontal strip of columns; scrolls sideways when the columns don't fit. Positioned, so
 * visually hidden (absolutely positioned) text inside off-screen columns is clipped by it
 * instead of widening the page.
 */
function ColumnsRow({ children }: { children: ReactNode }) {
  return <div className="relative flex h-full min-h-0 gap-3 overflow-x-auto pb-1">{children}</div>
}

function CreateIssueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-neutral-subtle hover:text-fg"
    >
      <Plus className="size-4" aria-hidden />
      Create issue
    </button>
  )
}

function ReadOnlyBoard({ statuses, columns, visibleColumns, filtered, epics, onOpenIssue }: BoardCanvasProps) {
  return (
    <ColumnsRow>
      {statuses.map((status) => {
        const shown = visibleColumns.get(status.id) ?? []
        return (
          <BoardColumn
            key={status.id}
            status={status}
            total={columns.get(status.id)?.length ?? 0}
            shown={shown.length}
            filtered={filtered}
          >
            {shown.map((issue) => (
              <StaticIssueCard key={issue.id} issue={issue} epic={epics.get(issue.id) ?? null} onOpen={onOpenIssue} />
            ))}
          </BoardColumn>
        )
      })}
    </ColumnsRow>
  )
}

// ---------------------------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------------------------

/** Transient state of the card being dragged. */
interface DragState {
  activeId: ID
  /** Column the card was picked up from. */
  originStatusId: ID
  /** Visible ids per column at pickup (to recognise drops that change nothing). */
  initial: ColumnItems
  /** Visible ids per column, updated as the card crosses columns. */
  items: ColumnItems
}

/** Mouse: a 5px movement starts a drag, so a plain click still opens the issue. */
const MOUSE_OPTIONS: MouseSensorOptions = { activationConstraint: { distance: 5 } }
/**
 * Touch: press and hold to pick a card up; a swipe that starts on a card keeps scrolling the
 * board (a pointer-distance constraint loses that race to the browser's panning).
 */
const TOUCH_OPTIONS: TouchSensorOptions = { activationConstraint: { delay: 250, tolerance: 5 } }
const KEYBOARD_OPTIONS: KeyboardSensorOptions = {
  coordinateGetter: boardKeyboardCoordinates,
  keyboardCodes: BOARD_KEYBOARD_CODES,
}
const MEASURING: MeasuringConfiguration = { droppable: { strategy: MeasuringStrategy.Always } }
const DROP_ANIMATION: DropAnimation = {
  duration: 200,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
}
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'Press Enter to open the issue. To move it, press Space to pick it up, use the up and down arrow keys to change its position ' +
    'and the left and right arrow keys to move it to another column, then press Space again to drop it. Press Escape to cancel.',
}

function toColumnItems(statuses: readonly Status[], columns: BoardColumns): ColumnItems {
  const items: Record<ID, ID[]> = {}
  for (const status of statuses) items[status.id] = (columns.get(status.id) ?? []).map((issue) => issue.id)
  return items
}

function sameOrder(a: readonly ID[], b: readonly ID[] | undefined): boolean {
  return !!b && a.length === b.length && a.every((id, i) => id === b[i])
}

function DraggableBoard({
  statuses,
  columns,
  visibleColumns,
  filtered,
  epics,
  onOpenIssue,
  onMoveIssue,
  onCreateIssue,
}: BoardCanvasProps) {
  const baseItems = useMemo(() => toColumnItems(statuses, visibleColumns), [statuses, visibleColumns])
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const issueById = useMemo(() => {
    const map = new Map<ID, Issue>()
    for (const list of columns.values()) for (const issue of list) map.set(issue.id, issue)
    return map
  }, [columns])

  const [drag, setDragState] = useState<DragState | null>(null)
  // Mirror for the dnd-kit callbacks, which can fire several times before React re-renders.
  const dragRef = useRef<DragState | null>(null)
  // The most recent drag, kept after the drop for the end/cancel announcements.
  const lastDragRef = useRef<DragState | null>(null)
  const setDrag = (next: DragState | null) => {
    dragRef.current = next
    if (next) lastDragRef.current = next
    setDragState(next)
  }

  const items = drag?.items ?? baseItems
  const activeColumn = drag ? findColumn(drag.activeId, drag.items) : null
  const activeIssue = drag ? issueById.get(drag.activeId) : undefined

  const [collisionMemory] = useState(() => new CollisionMemory())
  const collisionDetection = useMemo(
    () => createBoardCollisionDetection(items, drag?.activeId ?? null, collisionMemory),
    [items, drag?.activeId, collisionMemory],
  )
  // Once the layout has settled after a card changed column, collisions are trusted again.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      collisionMemory.settle()
    })
    return () => cancelAnimationFrame(frame)
  }, [items, collisionMemory])

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_OPTIONS),
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (typeof active.id !== 'number') return
    const origin = findColumn(active.id, baseItems)
    if (origin == null) return
    collisionMemory.reset()
    setDrag({ activeId: active.id, originStatusId: origin, initial: baseItems, items: baseItems })
  }

  // Crossing into another column: move the card into that column's list so it opens a gap there.
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const state = dragRef.current
    if (!state || !over) return
    const from = findColumn(state.activeId, state.items)
    // A column is looked up among the current statuses, not the lists taken at pickup: a column
    // added during the drag (by a teammate) is a drop target too, and starts out empty.
    const overColumn = statusIdOfDroppable(over.id)
    const to = overColumn != null ? (statusById.has(overColumn) ? overColumn : null) : findColumn(over.id, state.items)
    if (from == null || to == null || from === to) return
    const target = state.items[to] ?? []
    let index = target.length
    if (typeof over.id === 'number') {
      const overIndex = target.indexOf(over.id)
      const dragged = active.rect.current.translated
      const below = !!dragged && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2
      if (overIndex >= 0) index = overIndex + (below ? 1 : 0)
    }
    collisionMemory.markColumnChange()
    setDrag({
      ...state,
      items: {
        ...state.items,
        [from]: state.items[from].filter((id) => id !== state.activeId),
        [to]: [...target.slice(0, index), state.activeId, ...target.slice(index)],
      },
    })
  }

  const handleDragEnd = ({ over }: DragEndEvent) => {
    const state = dragRef.current
    setDrag(null)
    if (!state || !over) return
    const statusId = findColumn(state.activeId, state.items)
    if (statusId == null) return
    let visible = state.items[statusId]
    if (typeof over.id === 'number' && findColumn(over.id, state.items) === statusId) {
      const from = visible.indexOf(state.activeId)
      const to = visible.indexOf(over.id)
      if (from >= 0 && to >= 0 && from !== to) visible = arrayMove([...visible], from, to)
    }
    if (statusId === state.originStatusId && sameOrder(visible, state.initial[statusId])) return
    const issue = issueById.get(state.activeId)
    const status = statusById.get(statusId)
    if (!issue || !status) return
    // Neighbours come from the full column, so cards hidden by filters keep their place.
    const fullIds = (columns.get(statusId) ?? []).map((i) => i.id)
    onMoveIssue(issue, { status, ...computeAnchors(fullIds, visible, issue.id) })
  }

  const announcements = useBoardAnnouncements(lastDragRef, baseItems, issueById, statusById)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={MEASURING}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <ColumnsRow>
        {statuses.map((status, index) => (
          <DroppableColumn
            key={status.id}
            status={status}
            ids={items[status.id] ?? []}
            issueById={issueById}
            epics={epics}
            total={columns.get(status.id)?.length ?? 0}
            filtered={filtered}
            dragActive={drag != null}
            dropTarget={activeColumn === status.id}
            onOpenIssue={onOpenIssue}
            footer={index === 0 && onCreateIssue ? <CreateIssueButton onClick={onCreateIssue} /> : undefined}
          />
        ))}
      </ColumnsRow>
      {createPortal(
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeIssue ? <IssueCardOverlay issue={activeIssue} epic={epics.get(activeIssue.id) ?? null} /> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

interface DroppableColumnProps {
  status: Status
  ids: readonly ID[]
  issueById: ReadonlyMap<ID, Issue>
  epics: ReadonlyMap<ID, EpicOption>
  total: number
  filtered: boolean
  dragActive: boolean
  dropTarget: boolean
  onOpenIssue: (issueKey: string) => void
  footer?: ReactNode
}

function DroppableColumn({
  status,
  ids,
  issueById,
  epics,
  total,
  filtered,
  dragActive,
  dropTarget,
  onOpenIssue,
  footer,
}: DroppableColumnProps) {
  const issues = ids.map((id) => issueById.get(id)).filter((issue): issue is Issue => issue != null)
  const data: ColumnDroppableData = { type: 'column', statusId: status.id, count: issues.length }
  const { setNodeRef } = useDroppable({ id: columnDroppableId(status.id), data })
  return (
    <BoardColumn
      status={status}
      total={total}
      shown={issues.length}
      filtered={filtered}
      dragActive={dragActive}
      dropTarget={dropTarget}
      columnRef={setNodeRef}
      footer={footer}
    >
      <SortableContext id={`column-list:${status.id}`} items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {issues.map((issue) => (
          <SortableIssueCard
            key={issue.id}
            issue={issue}
            epic={epics.get(issue.id) ?? null}
            statusId={status.id}
            onOpen={onOpenIssue}
          />
        ))}
      </SortableContext>
    </BoardColumn>
  )
}

/**
 * Screen-reader announcements that name the issue key, column and position. `dragRef` holds the
 * current (or just finished) drag, whose column lists reflect where the card is.
 */
function useBoardAnnouncements(
  dragRef: { readonly current: DragState | null },
  baseItems: ColumnItems,
  issueById: ReadonlyMap<ID, Issue>,
  statusById: ReadonlyMap<ID, Status>,
): Announcements {
  return useMemo(() => {
    const keyOf = (id: UniqueIdentifier) => (typeof id === 'number' ? (issueById.get(id)?.key ?? 'The issue') : 'The issue')
    const placeOf = (id: UniqueIdentifier): string | null => {
      const items = dragRef.current?.items ?? baseItems
      const statusId = findColumn(id, items)
      if (statusId == null) return null
      const ids = items[statusId] ?? []
      const index = typeof id === 'number' ? ids.indexOf(id) : ids.length - 1
      const name = statusById.get(statusId)?.name ?? 'the column'
      return ids.length > 0 ? `${name}, position ${Math.max(index, 0) + 1} of ${ids.length}` : name
    }
    return {
      onDragStart: ({ active }) => {
        const place = placeOf(active.id)
        return `Picked up ${keyOf(active.id)}${place ? ` in ${place}` : ''}.`
      },
      onDragOver: ({ active, over }) => {
        const place = over ? placeOf(over.id) : null
        return place ? `${keyOf(active.id)} is over ${place}.` : `${keyOf(active.id)} is not over a column.`
      },
      onDragEnd: ({ active, over }) => {
        const place = over ? placeOf(over.id) : null
        return place ? `${keyOf(active.id)} was dropped in ${place}.` : `${keyOf(active.id)} was dropped. Nothing changed.`
      },
      onDragCancel: ({ active }) => {
        const origin = dragRef.current ? statusById.get(dragRef.current.originStatusId)?.name : undefined
        return `Moving ${keyOf(active.id)} was cancelled${origin ? `. It stays in ${origin}` : ''}.`
      },
    }
  }, [dragRef, baseItems, issueById, statusById])
}
