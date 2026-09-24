import {
  closestCenter,
  closestCorners,
  getFirstCollision,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DroppableContainer,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  type MouseSensorOptions,
  type ScreenReaderInstructions,
  type TouchSensorOptions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContainerId } from './model'

/** Visible sortable ids (issue keys) per section, in display order. */
export type VisibleItems = Record<ContainerId, string[]>

/** Where a dragged issue was dropped, in terms of the *visible* lists. */
export interface DropResult {
  issueKey: string
  /** Section the drag started in. */
  from: ContainerId
  /** Section it was dropped into. */
  to: ContainerId
  /** Visible issue directly above / below the drop position in `to`. */
  aboveKey: string | null
  belowKey: string | null
}

const CONTAINER_PREFIX = 'section:'

/** `data` of a section droppable. */
export interface SectionDroppableData {
  /** The section shows no rows (empty or collapsed), so keyboard moves may target it directly. */
  keyboardTarget: boolean
}

/** Droppable id of a whole section (header + list), so empty or collapsed sections accept drops. */
export function sectionDroppableId(id: ContainerId): string {
  return `${CONTAINER_PREFIX}${id}`
}

function sectionOf(id: UniqueIdentifier): ContainerId | null {
  const s = String(id)
  return s.startsWith(CONTAINER_PREFIX) ? s.slice(CONTAINER_PREFIX.length) : null
}

function findContainer(items: VisibleItems, id: UniqueIdentifier): ContainerId | undefined {
  const section = sectionOf(id)
  if (section != null) return section in items ? section : undefined
  const key = String(id)
  return Object.keys(items).find((c) => items[c].includes(key))
}

/**
 * Space picks a row up (and drops it), Enter drops, Escape cancels. Enter is *not* a start key so
 * that Enter on a focused row can open the issue.
 */
const KEYBOARD_CODES: KeyboardCodes = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter', 'NumpadEnter'],
}

/** Mouse: a 5px movement starts a drag, so a plain click still opens the issue. */
const MOUSE_OPTIONS: MouseSensorOptions = { activationConstraint: { distance: 5 } }

/**
 * Touch: press and hold to pick a row up; a swipe that starts on a row keeps scrolling the
 * list (a pointer-distance constraint loses that race to the browser's panning).
 */
const TOUCH_OPTIONS: TouchSensorOptions = { activationConstraint: { delay: 250, tolerance: 5 } }

/** Screen-reader instructions announced when a row receives focus. */
export const BACKLOG_DND_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Press Enter to open the issue. To move it, press Space to pick it up, use the up and down arrow keys to change its position or section, then press Space or Enter to drop it, or Escape to cancel.',
}

interface Options {
  /** Visible issue keys per section (after filters), outside of a drag. */
  visible: VisibleItems
  /** Called once per completed drop (not for cancelled drags). */
  onDrop: (result: DropResult) => void
  /** Section display name for announcements. */
  describeSection: (id: ContainerId) => string
}

/**
 * Drag & drop state for the stacked backlog sections (dnd-kit multi-container sortable).
 * While dragging, a local copy of the visible lists is re-arranged live (so the placeholder
 * shows in the section under the pointer); on drop the final visible neighbours are reported.
 */
export function useBacklogDnd({ visible, onDrop, describeSection }: Options) {
  const [dragItems, setDragItems] = useState<VisibleItems | null>(null)
  const [active, setActive] = useState<{ key: string; from: ContainerId } | null>(null)
  const items = dragItems ?? visible
  const lastOverId = useRef<UniqueIdentifier | null>(null)
  const movedToNewContainer = useRef(false)
  // Latest arrangement for callbacks dnd-kit invokes outside React's render (keyboard, a11y).
  const itemsRef = useRef(items)
  useLayoutEffect(() => {
    itemsRef.current = items
  })

  // After an item switched sections the layout shifts; ignore the stale "over" for one frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedToNewContainer.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [dragItems])

  /** Direction of the last keyboard move (null for pointer drags). */
  const keyboardDirection = useRef<'up' | 'down' | null>(null)

  /**
   * Multi-section keyboard moves: ↑/↓ jump to the nearest row above/below in any section.
   * Sections are targets only while they show no rows (empty or collapsed); otherwise their
   * rows are, so crossing a boundary lands next to the nearest row.
   */
  const coordinateGetter = useCallback<KeyboardCoordinateGetter>((event, { context }) => {
    const up = event.code === 'ArrowUp'
    if (!up && event.code !== 'ArrowDown') return undefined
    event.preventDefault()
    const { active: dragged, collisionRect, droppableRects, droppableContainers } = context
    if (!dragged || !collisionRect) return undefined
    const candidates: DroppableContainer[] = []
    for (const entry of droppableContainers.getEnabled()) {
      if (entry.id === dragged.id) continue
      if (sectionOf(entry.id) != null && !(entry.data.current as SectionDroppableData | undefined)?.keyboardTarget) continue
      const rect = droppableRects.get(entry.id)
      if (rect && (up ? rect.top < collisionRect.top : rect.top > collisionRect.top)) candidates.push(entry)
    }
    const closestId = getFirstCollision(
      closestCorners({ active: dragged, collisionRect, droppableRects, droppableContainers: candidates, pointerCoordinates: null }),
      'id',
    )
    const rect = closestId != null ? droppableRects.get(closestId) : undefined
    if (closestId == null || !rect) return undefined
    keyboardDirection.current = up ? 'up' : 'down'
    const from = findContainer(itemsRef.current, dragged.id)
    const to = sectionOf(closestId) ?? findContainer(itemsRef.current, closestId)
    if (to !== from) {
      if (up) {
        // Entering the section above: aim just below its last row so the issue lands at its end.
        return sectionOf(closestId) == null ? { x: rect.left, y: rect.top + rect.height } : { x: rect.left, y: rect.top }
      }
      // Entering an empty or collapsed section below: aim just inside its top edge. (Aiming a
      // row higher, as for rows below, would land above the section, back in the one the row
      // is leaving.)
      if (sectionOf(closestId) != null) return { x: rect.left, y: rect.top + 1 }
      // Entering the section below at a row: the row leaves its current (expanded) section,
      // shifting everything underneath up by one row — aim where the target will be after that shift.
      const fromData = from != null ? droppableContainers.get(sectionDroppableId(from))?.data.current : undefined
      const leavesGap = !(fromData as SectionDroppableData | undefined)?.keyboardTarget
      return { x: rect.left, y: rect.top - (leavesGap ? collisionRect.height : 0) }
    }
    return { x: rect.left, y: rect.top }
  }, [])

  const keyboardOptions = useMemo(() => ({ coordinateGetter, keyboardCodes: KEYBOARD_CODES }), [coordinateGetter])
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_OPTIONS),
    useSensor(TouchSensor, TOUCH_OPTIONS),
    useSensor(KeyboardSensor, keyboardOptions),
  )

  const activeKey = active?.key ?? null

  /**
   * Pointer first (precise with stacked sections), rectangles as fallback (keyboard). When the
   * hit is a whole section that has rows, snap to its closest row instead.
   */
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const pointerHits = pointerWithin(args)
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args)
      let overId = getFirstCollision(hits, 'id')
      if (overId != null) {
        const section = sectionOf(overId)
        if (section != null) {
          const keys = items[section] ?? []
          if (keys.length > 0) {
            const sectionId = overId
            const closest = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (d) => d.id !== sectionId && keys.includes(String(d.id)),
              ),
            })
            overId = closest[0]?.id ?? overId
          }
        }
        lastOverId.current = overId
        return [{ id: overId }]
      }
      if (movedToNewContainer.current && activeKey) lastOverId.current = activeKey
      return lastOverId.current != null ? [{ id: lastOverId.current }] : []
    },
    [items, activeKey],
  )

  const reset = () => {
    setActive(null)
    setDragItems(null)
    lastOverId.current = null
    keyboardDirection.current = null
  }

  const onDragStart = ({ active: dragged }: DragStartEvent) => {
    const key = String(dragged.id)
    const from = findContainer(visible, key)
    if (!from) return
    lastOverId.current = null
    keyboardDirection.current = null
    setActive({ key, from })
    setDragItems(visible)
  }

  const onDragOver = ({ active: dragged, over }: DragOverEvent) => {
    if (!over) return
    setDragItems((current) => {
      if (!current) return current
      const key = String(dragged.id)
      const from = findContainer(current, key)
      // A section is looked up among the current ones, not the lists taken at pickup: a sprint
      // created during the drag (by a teammate) is a drop target too, and starts out empty.
      const section = sectionOf(over.id)
      const to = section != null ? (section in visible ? section : undefined) : findContainer(current, over.id)
      if (!from || !to || from === to) return current
      const target = current[to] ?? []
      let index = target.length
      if (sectionOf(over.id) == null) {
        const overIndex = target.indexOf(String(over.id))
        // Keyboard: moving up enters the section above at its end, moving down enters at the top.
        // Pointer: insert after the hovered row once the dragged row's centre is past its centre.
        const direction = keyboardDirection.current
        const translated = dragged.rect.current.translated
        const below = direction
          ? direction === 'up'
          : translated != null && translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0)
      }
      movedToNewContainer.current = true
      return {
        ...current,
        [from]: current[from].filter((k) => k !== key),
        [to]: [...target.slice(0, index), key, ...target.slice(index)],
      }
    })
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    const state = dragItems
    const origin = active
    reset()
    if (!over || !state || !origin) return
    const key = String(dragged.id)
    const container = findContainer(state, key)
    const overContainer = findContainer(state, over.id)
    if (!container || !overContainer) return

    let to = container
    let list = state[container]
    if (overContainer !== container) {
      // Dropped before onDragOver re-parented the row: insert at the hovered position.
      const target = state[overContainer].filter((k) => k !== key)
      const overIndex = target.indexOf(String(over.id))
      const index = overIndex >= 0 ? overIndex : target.length
      list = [...target.slice(0, index), key, ...target.slice(index)]
      to = overContainer
    } else if (sectionOf(over.id) == null) {
      const fromIndex = list.indexOf(key)
      const toIndex = list.indexOf(String(over.id))
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) list = arrayMove(list, fromIndex, toIndex)
    }

    // Released where it started: the visible order is unchanged, so nothing moves. (With
    // filters active the page can't tell from the full lists — hidden neighbours differ.)
    const before = visible[to]
    if (to === origin.from && before && before.length === list.length && before.every((k, i) => k === list[i])) return

    const index = list.indexOf(key)
    onDrop({
      issueKey: key,
      from: origin.from,
      to,
      aboveKey: index > 0 ? list[index - 1] : null,
      belowKey: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    })
  }

  /** "position 2 of 5 in Backlog" within a section, or just the section name when entering it. */
  const describeOver = useCallback(
    (activeId: UniqueIdentifier, overId: UniqueIdentifier): string => {
      const current = itemsRef.current
      const section = findContainer(current, overId)
      if (!section) return 'no section'
      const name = describeSection(section)
      const list = current[section]
      if (sectionOf(overId) != null || !list.includes(String(activeId))) return name
      return `position ${list.indexOf(String(overId)) + 1} of ${list.length} in ${name}`
    },
    [describeSection],
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active: a }) => `Picked up ${a.id}.`,
      onDragOver: ({ active: a, over }) =>
        over ? `${a.id} moved to ${describeOver(a.id, over.id)}.` : `${a.id} is no longer over a section.`,
      onDragEnd: ({ active: a, over }) =>
        over ? `${a.id} dropped at ${describeOver(a.id, over.id)}.` : `${a.id} was dropped in its original position.`,
      onDragCancel: ({ active: a }) => `Moving ${a.id} was cancelled. It is back in its original position.`,
    }),
    [describeOver],
  )

  return {
    sensors,
    collisionDetection,
    announcements,
    /** Visible keys per section — the live drag arrangement while dragging. */
    items,
    /** Issue key being dragged. */
    activeKey,
    /** Section the dragged issue came from. */
    originContainer: active?.from ?? null,
    /** Section the dragged issue currently sits in (drop target). */
    currentContainer: activeKey ? (findContainer(items, activeKey) ?? null) : null,
    handlers: { onDragStart, onDragOver, onDragEnd, onDragCancel: reset },
  }
}
