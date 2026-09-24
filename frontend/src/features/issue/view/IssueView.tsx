import { Link2, ListPlus } from 'lucide-react'
import { useState } from 'react'
import { useUpdateIssue } from '@/api/issues'
import { useProject } from '@/api/projects'
import type { IssueDetail } from '@/api/types'
import { Button, EditableText } from '@/components/ui'
import { cn } from '@/lib/cn'
import { allowedChildTypes } from '@/lib/issueMeta'
import { useProjectRealtime } from '@/realtime/useProjectRealtime'
import { useIssueSave } from '../shared/useIssueSave'
import { ActivitySection } from './ActivitySection'
import { ChildIssues } from './ChildIssues'
import { DetailsPanel } from './DetailsPanel'
import { IssueDescription } from './IssueDescription'
import { IssueHeader } from './IssueHeader'
import { IssueLayout } from './IssueLayout'
import { useIssueView } from './IssueViewContext'
import { LinkedIssues } from './LinkedIssues'

/** Props of `IssueView`. */
export interface IssueViewProps {
  issue: IssueDetail
  /** Modal only: close button in the header. */
  onClose?: () => void
  /** Called after the issue was deleted. */
  onDeleted: () => void
  onDeletingChange: (deleting: boolean) => void
}

/**
 * Live updates on the full page. Project pages get them from ProjectLayout; `/browse/:key`
 * sits outside it, so the page subscribes to the issue's project itself.
 */
function ProjectLiveUpdates({ projectKey }: { projectKey: string }) {
  useProjectRealtime(projectKey)
  return null
}

/**
 * The issue view shared by the issue modal and `/browse/:issueKey`: breadcrumb and actions,
 * inline-editable summary, description, child issues, linked issues, comments / history, and
 * the details panel. Everything is read-only for viewers.
 */
export function IssueView({ issue, onClose, onDeleted, onDeletingChange }: IssueViewProps) {
  const { variant, canEdit, deleting } = useIssueView()
  const project = useProject(issue.projectKey).data
  const updateSummary = useUpdateIssue(issue.key)
  const save = useIssueSave(issue.key)
  const [creatingChild, setCreatingChild] = useState(false)
  const [linking, setLinking] = useState(false)

  const canHaveChildren = allowedChildTypes(issue.type).length > 0
  const Heading = variant === 'page' ? 'h1' : 'h2'

  const summary = (
    <div className="flex flex-col gap-3">
      <Heading className="text-2xl leading-8 font-semibold tracking-tight text-fg">
        <EditableText
          value={issue.summary}
          onSave={(next) => updateSummary.mutateAsync({ summary: next })}
          label="Summary"
          disabled={!canEdit}
          maxLength={255}
          data-testid="issue-summary"
        />
      </Heading>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {canHaveChildren && (
            <Button size="sm" icon={<ListPlus />} onClick={() => setCreatingChild(true)}>
              {issue.type === 'epic' ? 'Add child issue' : 'Create subtask'}
            </Button>
          )}
          <Button size="sm" icon={<Link2 />} onClick={() => setLinking(true)}>
            Link issue
          </Button>
        </div>
      )}
    </div>
  )

  const content = (
    <div className="flex flex-col gap-8">
      <IssueDescription issue={issue} save={save} />
      {canHaveChildren && (
        <ChildIssues
          issue={issue}
          creating={creatingChild && canEdit}
          onCreatingChange={setCreatingChild}
        />
      )}
      <LinkedIssues issue={issue} adding={linking && canEdit} onAddingChange={setLinking} />
      <ActivitySection issue={issue} />
    </div>
  )

  return (
    <div
      data-testid="issue-view"
      data-issue-key={issue.key}
      inert={deleting}
      aria-busy={deleting || undefined}
      className={cn('flex min-h-0 flex-1 flex-col transition-opacity', deleting && 'opacity-60')}
    >
      <IssueLayout
        variant={variant}
        header={
          <IssueHeader
            issue={issue}
            project={project}
            save={save}
            onClose={onClose}
            onDeleted={onDeleted}
            onDeletingChange={onDeletingChange}
          />
        }
        summary={summary}
        aside={<DetailsPanel issue={issue} project={project} save={save} />}
        content={content}
      />
      {variant === 'page' && <ProjectLiveUpdates projectKey={issue.projectKey} />}
    </div>
  )
}
