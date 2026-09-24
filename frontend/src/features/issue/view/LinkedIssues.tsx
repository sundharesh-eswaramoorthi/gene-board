import { Plus, X } from 'lucide-react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '@/api/client'
import { useDeleteLink } from '@/api/links'
import { useProjects } from '@/api/projects'
import type { Issue, IssueDetail, IssueLink, LinkDirection, LinkType } from '@/api/types'
import { IssuePicker, type IssuePickerValue } from '@/components/issue'
import { Button, IconButton, Select, useConfirm } from '@/components/ui'
import { LINK_TYPE_META, LINK_TYPES } from '@/lib/issueMeta'
import { projectKeyOf } from '@/lib/projectKey'
import { toastSaveError } from '../shared/errors'
import { IssueRefRow } from './IssueRefRow'
import { useIssueView } from './IssueViewContext'
import { groupLinksByLabel } from './issueViewUtils'
import { useLinkIssue } from './useLinkIssue'

interface LinkChoice {
  value: string
  label: string
  type: LinkType
  direction: LinkDirection
}

/** "blocks", "is blocked by", "relates to", "duplicates", … (symmetric types listed once). */
const LINK_CHOICES: readonly LinkChoice[] = LINK_TYPES.flatMap((type) => {
  const meta = LINK_TYPE_META[type]
  const choices: LinkChoice[] = [{ value: `${type}:outward`, label: meta.outward, type, direction: 'outward' }]
  if (meta.inward !== meta.outward) {
    choices.push({ value: `${type}:inward`, label: meta.inward, type, direction: 'inward' })
  }
  return choices
})

/**
 * Whether the caller may change issues of a project (member or admin). A link is stored on its
 * outward (source) issue, so creating an inward link or removing any link needs this role in
 * the source issue's project — which, across projects, may not be the viewed one.
 */
function useCanEditProject(): (projectKey: string) => boolean {
  const projects = useProjects()
  return useCallback(
    (projectKey: string) => {
      const role = projects.data?.find((p) => p.key === projectKey)?.myRole
      return role === 'admin' || role === 'member'
    },
    [projects.data],
  )
}

/** Props of `LinkedIssues`. */
export interface LinkedIssuesProps {
  issue: IssueDetail
  /** The "link issue" form is open (toggled from the summary toolbar too). */
  adding: boolean
  onAddingChange: (adding: boolean) => void
}

/**
 * Linked issues grouped by relationship ("blocks", "is blocked by", …) with remove buttons and
 * the "Link issue" form. Hidden when there are no links and the form is closed.
 */
export function LinkedIssues({ issue, adding, onAddingChange }: LinkedIssuesProps) {
  const { canEdit } = useIssueView()
  const canEditProject = useCanEditProject()
  const confirm = useConfirm()
  const headingId = useId()
  const deleteLink = useDeleteLink(issue.key)
  const groups = useMemo(() => groupLinksByLabel(issue.links), [issue.links])
  if (issue.links.length === 0 && !adding) return null

  // An inward link belongs to the other issue: removing it needs edit rights over there.
  const canRemove = (link: IssueLink) =>
    canEdit && (link.direction === 'outward' || canEditProject(projectKeyOf(link.issue.key)))

  const remove = (link: IssueLink) =>
    confirm({
      title: 'Remove this link?',
      description: `${issue.key} will no longer be linked to ${link.issue.key} (“${link.label}”). Neither issue is deleted.`,
      confirmLabel: 'Remove link',
      onConfirm: () => deleteLink.mutateAsync(link),
    })

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex min-h-7 items-center gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-fg">
          Linked issues
        </h3>
        {canEdit && !adding && (
          <IconButton size="sm" className="ml-auto" label="Link issue" icon={<Plus />} onClick={() => onAddingChange(true)} />
        )}
      </div>
      {adding && <LinkIssueForm issue={issue} onClose={() => onAddingChange(false)} />}
      {groups.map(([label, links]) => (
        <div key={label} className="flex flex-col gap-1.5">
          <h4 className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{label}</h4>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {links.map((link) => (
              <IssueRefRow
                key={link.id}
                issue={link.issue}
                actions={
                  canRemove(link) && (
                    <IconButton
                      size="xs"
                      variant="danger"
                      label={`Remove link to ${link.issue.key}`}
                      icon={<X />}
                      onClick={() => void remove(link)}
                      className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    />
                  )
                }
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/**
 * Relationship select + issue search (key or summary, across all the caller's projects).
 * Escape closes the form (after closing the search popover, if open).
 */
function LinkIssueForm({ issue, onClose }: { issue: IssueDetail; onClose: () => void }) {
  const [choiceValue, setChoiceValue] = useState(LINK_CHOICES[0].value)
  const [target, setTarget] = useState<IssuePickerValue | null>(null)
  const [pickerOpen, setPickerOpen] = useState(true)
  const formRef = useRef<HTMLDivElement>(null)
  const link = useLinkIssue(issue.key)
  const canEditProject = useCanEditProject()
  const hasViewOnlyProjects = (useProjects().data ?? []).some((p) => p.myRole === 'viewer')

  // Opened from the toolbar the form may sit below the fold; bring it (and the search popover
  // anchored to it) into view.
  useLayoutEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const choice = LINK_CHOICES.find((c) => c.value === choiceValue) ?? LINK_CHOICES[0]
  // Inward links ("is blocked by X") are created on X, so X's project must be editable.
  const inward = choice.direction === 'inward'
  const targetFilter = useCallback(
    (candidate: Issue) => !inward || canEditProject(candidate.projectKey),
    [inward, canEditProject],
  )
  const targetAllowed = !target || !inward || canEditProject(projectKeyOf(target.key))

  // Issues already linked the same way can't be linked again (409); hide them from the search.
  const excludeIds = useMemo(
    () => [
      issue.id,
      ...issue.links
        .filter((l) => l.type === choice.type && (l.direction === choice.direction || l.type === 'relates'))
        .map((l) => l.issue.id),
    ],
    [issue.id, issue.links, choice],
  )

  const submit = async () => {
    if (!target || !targetAllowed || link.isPending) return
    try {
      await link.mutateAsync({ type: choice.type, direction: choice.direction, targetKey: target.key })
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.isForbidden && inward) {
        toastSaveError(
          new ApiError(403, 'forbidden', `You can only view ${projectKeyOf(target.key)}, so you can’t add “${choice.label}” links to its issues.`),
        )
      } else {
        toastSaveError(err, 'Couldn’t link the issues')
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Escape inside the search popover (a portal) only closes the popover.
    if (e.key === 'Escape' && e.currentTarget.contains(e.target as Node)) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the whole form
    <div
      ref={formRef}
      role="group"
      aria-label="Link an issue"
      data-local-escape
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <Select
        aria-label="Relationship"
        value={choiceValue}
        onChange={(e) => setChoiceValue(e.target.value)}
        options={LINK_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
        className="sm:w-44 sm:shrink-0"
      />
      <div className="min-w-0 flex-1">
        <IssuePicker
          value={target}
          onChange={setTarget}
          excludeIds={excludeIds}
          filter={targetFilter}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          placeholder="Search by key or summary…"
          aria-label={target ? `Issue to link: ${target.key} ${target.summary}` : 'Issue to link'}
          className="bg-surface"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="primary" loading={link.isPending} disabled={!target || !targetAllowed} onClick={() => void submit()}>
          Link
        </Button>
        <Button variant="subtle" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {inward && (hasViewOnlyProjects || !targetAllowed) && (
        <p className="text-xs text-fg-muted sm:basis-full" data-testid="link-inward-hint">
          {targetAllowed
            ? `“${choice.label}” links are added to the other issue, so only issues of projects you can edit are offered.`
            : `You can only view ${projectKeyOf(target?.key ?? '')}: “${choice.label}” links are stored on its issues, so a member of ${projectKeyOf(target?.key ?? '')} has to add this one.`}
        </p>
      )}
    </div>
  )
}
