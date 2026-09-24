import { ChevronRight, Copy, Link2, Maximize2, MoreHorizontal, Trash2, X } from 'lucide-react'
import { Link } from 'react-router'
import { useDeleteIssue } from '@/api/issues'
import type { IssueDetail, Project } from '@/api/types'
import { IssueTypeIcon, ProjectAvatar } from '@/components/issue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  toast,
  useConfirm,
} from '@/components/ui'
import { issueUrl, pluralize } from '@/lib/format'
import { copyToClipboard } from '@/lib/hooks'
import { isStandardType } from '@/lib/issueMeta'
import type { SaveIssue } from '../shared/useIssueSave'
import { TypeField } from './detailFields'
import { IssueRefLink } from './IssueRefRow'
import { useIssueView } from './IssueViewContext'

/** Props of `IssueHeader`. */
export interface IssueHeaderProps {
  issue: IssueDetail
  project: Project | undefined
  save: SaveIssue
  /** Modal only: close button. */
  onClose?: () => void
  /** Called after the issue was deleted (close the modal / leave the page). */
  onDeleted: () => void
  /** Marks the view as deleting (pauses its queries) while the DELETE runs. */
  onDeletingChange: (deleting: boolean) => void
}

function Separator() {
  return <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
}

function deleteConsequence(issue: IssueDetail): string {
  const base = 'Its comments and links are removed too.'
  if (isStandardType(issue.type) && issue.subtaskCount > 0) {
    return `${base} Its ${pluralize(issue.subtaskCount, 'subtask')} will be deleted too.`
  }
  if (issue.type === 'epic' && issue.children.length > 0) {
    return `${base} Its ${pluralize(issue.children.length, 'child issue')} will be kept, but no longer belong to an epic.`
  }
  return base
}

/** Breadcrumb (project › parent › key, with the type switcher) and the view's actions. */
export function IssueHeader({ issue, project, save, onClose, onDeleted, onDeletingChange }: IssueHeaderProps) {
  const { variant, canEdit } = useIssueView()
  const confirm = useConfirm()
  const deleteIssue = useDeleteIssue()

  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) toast.success(`${what} copied to clipboard`)
    else toast.error(`Couldn’t copy the ${what.toLowerCase()}`)
  }

  const onDelete = async () => {
    const deleted = await confirm({
      title: `Delete ${issue.key}?`,
      description: `You’re about to permanently delete “${issue.summary}”. ${deleteConsequence(issue)} This can’t be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        onDeletingChange(true)
        try {
          await deleteIssue.mutateAsync(issue.key)
        } catch (err) {
          onDeletingChange(false)
          throw err
        }
      },
    })
    if (!deleted) return
    toast.success(`${issue.key} was deleted`)
    onDeleted()
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg-muted">
        <Link
          to={`/projects/${issue.projectKey}/board`}
          className="flex min-w-0 shrink items-center gap-1.5 rounded-sm hover:text-fg hover:underline"
        >
          <ProjectAvatar project={project ?? { key: issue.projectKey }} size="sm" />
          <span className="truncate">{project?.name ?? issue.projectKey}</span>
        </Link>
        {issue.parent && (
          <>
            <Separator />
            <span className="flex shrink-0 items-center gap-1.5">
              <IssueTypeIcon type={issue.parent.type} size="sm" />
              <IssueRefLink
                issueKey={issue.parent.key}
                title={`${issue.parent.key}: ${issue.parent.summary}`}
                className="hover:text-fg hover:underline"
              />
            </span>
          </>
        )}
        <Separator />
        <span className="flex shrink-0 items-center gap-1">
          <TypeField issue={issue} save={save} />
          {variant === 'modal' ? (
            <Link to={`/browse/${issue.key}`} className="rounded-sm font-medium text-fg-muted hover:text-fg hover:underline">
              {issue.key}
            </Link>
          ) : (
            <span aria-current="page" className="font-medium text-fg">
              {issue.key}
            </span>
          )}
        </span>
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label="Copy link" icon={<Link2 />} onClick={() => void copy(issueUrl(issue.key), 'Link')} />
        {variant === 'modal' && (
          <Tooltip content="Open in full page">
            <Link
              to={`/browse/${issue.key}`}
              aria-label="Open in full page"
              className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg [&_svg]:size-4"
            >
              <Maximize2 />
            </Link>
          </Tooltip>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" icon={<MoreHorizontal />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Copy />} onSelect={() => void copy(issue.key, 'Issue key')}>
              Copy issue key
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger" icon={<Trash2 />} onSelect={() => void onDelete()}>
                  Delete issue
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && <IconButton label="Close" icon={<X />} onClick={onClose} />}
      </div>
    </>
  )
}
