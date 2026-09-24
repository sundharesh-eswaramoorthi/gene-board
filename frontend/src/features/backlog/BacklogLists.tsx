import { DndContext, DragOverlay, MeasuringStrategy } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Issue } from '@/api/types'
import { BacklogRowContent } from './BacklogRow'
import { BacklogSection } from './BacklogSection'
import {
  containerName,
  hasActiveFilters,
  matchesFilters,
  type BacklogContainer,
  type BacklogFilters,
  type ContainerId,
} from './model'
import { BACKLOG_DND_INSTRUCTIONS, useBacklogDnd, type DropResult, type VisibleItems } from './useBacklogDnd'

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }
const MODIFIERS = [restrictToVerticalAxis]

/** Props of `BacklogLists`. */
export interface BacklogListsProps {
  /** Sections with their full issue lists (server data + pending optimistic moves). */
  containers: BacklogContainer[]
  filters: BacklogFilters
  collapsed: readonly ContainerId[]
  onToggleCollapsed: (id: ContainerId) => void
  onDrop: (result: DropResult) => void
}

/** The stacked, drag-and-drop backlog sections plus the floating drag preview. */
export function BacklogLists({ containers, filters, collapsed, onToggleCollapsed, onDrop }: BacklogListsProps) {
  const filtering = hasActiveFilters(filters)

  const issueByKey = useMemo(() => {
    const map = new Map<string, Issue>()
    for (const c of containers) for (const issue of c.issues) map.set(issue.key, issue)
    return map
  }, [containers])

  const visible = useMemo<VisibleItems>(() => {
    const out: VisibleItems = {}
    for (const c of containers) out[c.id] = c.issues.filter((i) => matchesFilters(i, filters)).map((i) => i.key)
    return out
  }, [containers, filters])

  const describeSection = useCallback(
    (id: ContainerId) => {
      const c = containers.find((x) => x.id === id)
      return c ? containerName(c) : 'unknown section'
    },
    [containers],
  )

  const dnd = useBacklogDnd({ visible, onDrop, describeSection })
  const activeIssue = dnd.activeKey ? issueByKey.get(dnd.activeKey) : undefined

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      measuring={MEASURING}
      modifiers={MODIFIERS}
      accessibility={{ announcements: dnd.announcements, screenReaderInstructions: BACKLOG_DND_INSTRUCTIONS }}
      {...dnd.handlers}
    >
      <div className="flex flex-col gap-4">
        {containers.map((c) => {
          const issues = (dnd.items[c.id] ?? []).flatMap((key) => {
            const issue = issueByKey.get(key)
            return issue ? [issue] : []
          })
          return (
            <BacklogSection
              key={c.id}
              container={c}
              issues={issues}
              filtering={filtering}
              collapsed={collapsed.includes(c.id)}
              onToggleCollapsed={() => onToggleCollapsed(c.id)}
              isDropTarget={dnd.currentContainer === c.id && dnd.originContainer !== c.id}
            />
          )
        })}
      </div>
      {createPortal(
        <DragOverlay>
          {activeIssue && (
            <div className="@container">
              <BacklogRowContent issue={activeIssue} overlay />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}
