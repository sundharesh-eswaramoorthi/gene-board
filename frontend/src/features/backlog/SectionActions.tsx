import { CheckCheck, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type { Sprint } from '@/api/types'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from '@/components/ui'
import { useBacklogActions } from './BacklogContext'
import type { BacklogContainer } from './model'

/** Header actions of a sprint section: Start / Complete sprint and the Edit / Delete menu. */
export function SprintActions({ container, sprint }: { container: BacklogContainer; sprint: Sprint }) {
  const actions = useBacklogActions()
  const isActive = sprint.state === 'active'

  let primary
  if (isActive) {
    primary = (
      <Button
        size="sm"
        icon={<CheckCheck />}
        onClick={() => actions.completeSprint(sprint)}
        data-testid={`backlog-complete-sprint-${sprint.id}`}
      >
        Complete sprint
      </Button>
    )
  } else if (actions.hasActiveSprint) {
    // aria-disabled (not disabled) keeps the button focusable and hoverable for the tooltip.
    primary = (
      <Tooltip content="Only one sprint can be active. Complete the active sprint first.">
        <Button
          size="sm"
          icon={<Play />}
          aria-disabled
          className="aria-disabled:pointer-events-auto aria-disabled:cursor-not-allowed"
          data-testid={`backlog-start-sprint-${sprint.id}`}
        >
          Start sprint
        </Button>
      </Tooltip>
    )
  } else {
    primary = (
      <Button
        size="sm"
        icon={<Play />}
        onClick={() => actions.startSprint(sprint)}
        data-testid={`backlog-start-sprint-${sprint.id}`}
      >
        Start sprint
      </Button>
    )
  }

  return (
    <>
      {primary}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            label={`${sprint.name} actions`}
            tooltip="Sprint actions"
            icon={<MoreHorizontal />}
            data-testid={`backlog-sprint-menu-${sprint.id}`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Pencil />} onSelect={() => actions.editSprint(sprint)}>
            Edit sprint
          </DropdownMenuItem>
          {sprint.state === 'planned' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" icon={<Trash2 />} onSelect={() => actions.deleteSprint(container)}>
                Delete sprint
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** Header action of the Backlog section: Create sprint. */
export function CreateSprintButton() {
  const actions = useBacklogActions()
  return (
    <Button
      size="sm"
      icon={<Plus />}
      loading={actions.creatingSprint}
      onClick={actions.createSprint}
      data-testid="backlog-create-sprint"
    >
      Create sprint
    </Button>
  )
}
