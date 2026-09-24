import { keepPreviousData } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useAddComment, useComments, useDeleteComment, useUpdateComment } from '@/api/comments'
import type { Comment, IssueDetail } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { UserAvatar } from '@/components/issue'
import { Button, EmptyState, ErrorState, Skeleton, SkeletonText, Tooltip, controlClasses, useConfirm } from '@/components/ui'
import { Markdown } from '@/components/ui/Markdown'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { useEditorFocusReturn } from '@/lib/hooks'
import { toastSaveError } from '../shared/errors'
import { MarkdownEditor } from '../shared/MarkdownEditor'
import { useIssueView, useReportUnsaved } from './IssueViewContext'

/** Server limit for comment bodies (SPEC §5). */
const MAX_COMMENT_LENGTH = 10_000

/**
 * Comments, oldest first (newest last, next to the composer). Authors can edit/delete their
 * own comments; project admins can delete anyone's. Viewers read only.
 */
export function CommentsPanel({ issue }: { issue: IssueDetail }) {
  const { canEdit, isAdmin, deleting } = useIssueView()
  const { user: me } = useAuth()
  const comments = useComments(issue.key, { enabled: !deleting, placeholderData: keepPreviousData })

  let list
  if (comments.isPending) {
    list = (
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading comments">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-40" />
              <SkeletonText lines={2} />
            </div>
          </div>
        ))}
      </div>
    )
  } else if (comments.isError && !comments.data) {
    list = <ErrorState size="sm" error={comments.error} title="Couldn’t load comments" onRetry={() => void comments.refetch()} />
  } else if (comments.data.length === 0) {
    list = (
      <EmptyState
        size="sm"
        icon={<MessageSquare />}
        title="No comments yet"
        description={canEdit ? 'Start the conversation below.' : undefined}
      />
    )
  } else {
    list = (
      <ol className="flex flex-col gap-5">
        {comments.data.map((comment) => {
          const own = me != null && comment.author?.id === me.id
          return (
            <CommentItem
              key={comment.id}
              comment={comment}
              issueKey={issue.key}
              canModify={canEdit && own}
              canDelete={canEdit && (own || isAdmin)}
            />
          )
        })}
      </ol>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {list}
      {canEdit && <CommentComposer issueKey={issue.key} />}
    </div>
  )
}

/** One comment: author, time (edited marker), Markdown body, Edit / Delete. */
function CommentItem({
  comment,
  issueKey,
  canModify,
  canDelete,
}: {
  comment: Comment
  issueKey: string
  canModify: boolean
  canDelete: boolean
}) {
  const confirm = useConfirm()
  const update = useUpdateComment(issueKey)
  const remove = useDeleteComment(issueKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  useReportUnsaved(editing && draft.trim() !== comment.body.trim())
  // Closing the editor puts focus back on the comment's Edit button.
  const { buttonRef, editorRef, returnFocus } = useEditorFocusReturn(editing)
  const stopEditing = (options?: { ifFocusInside?: boolean }) => {
    returnFocus(options)
    setEditing(false)
  }

  const startEdit = () => {
    setDraft(comment.body)
    setEditing(true)
  }

  const save = async () => {
    const body = draft.trim()
    if (!body || update.isPending) return
    if (body === comment.body.trim()) {
      stopEditing()
      return
    }
    try {
      await update.mutateAsync({ id: comment.id, body })
      stopEditing({ ifFocusInside: true })
    } catch (err) {
      toastSaveError(err, 'Couldn’t update the comment')
    }
  }

  const cancel = async () => {
    if (draft.trim() !== comment.body.trim()) {
      const discard = await confirm({
        title: 'Discard changes?',
        description: 'Your edits to this comment haven’t been saved.',
        confirmLabel: 'Discard',
      })
      if (!discard) return
    }
    stopEditing()
  }

  const onDelete = () =>
    confirm({
      title: 'Delete this comment?',
      description: 'The comment will be permanently removed.',
      confirmLabel: 'Delete',
      onConfirm: () => remove.mutateAsync(comment.id),
    })

  const authorName = comment.author?.name ?? 'Deleted user'

  return (
    <li className="flex gap-3">
      <UserAvatar user={comment.author} size="lg" emptyLabel="Deleted user" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-fg">{authorName}</span>
          <Tooltip content={formatDateTime(comment.createdAt)}>
            <time dateTime={comment.createdAt} tabIndex={-1} className="text-xs text-fg-subtle">
              {formatRelative(comment.createdAt)}
            </time>
          </Tooltip>
          {comment.edited && (
            <Tooltip content={`Edited ${formatDateTime(comment.updatedAt)}`}>
              <span tabIndex={-1} className="text-xs text-fg-subtle">
                (edited)
              </span>
            </Tooltip>
          )}
        </div>
        {editing ? (
          <div ref={editorRef} data-local-escape className="mt-1.5">
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              autoFocus
              minRows={3}
              maxLength={MAX_COMMENT_LENGTH}
              saving={update.isPending}
              aria-label="Edit comment"
              onSubmit={() => void save()}
              submitHint="to save"
              onEscape={() => void cancel()}
              footer={
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" loading={update.isPending} disabled={!draft.trim()} onClick={() => void save()}>
                    Save
                  </Button>
                  <Button variant="subtle" size="sm" disabled={update.isPending} onClick={() => stopEditing()}>
                    Cancel
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <Markdown className="mt-1">{comment.body}</Markdown>
            {(canModify || canDelete) && (
              <div className="mt-1 flex items-center gap-3 text-xs">
                {canModify && (
                  <button
                    ref={buttonRef}
                    type="button"
                    onClick={startEdit}
                    className="rounded-sm font-medium text-fg-muted hover:text-fg hover:underline"
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void onDelete()}
                    className="rounded-sm font-medium text-fg-muted hover:text-danger hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

/**
 * "Add a comment…" placeholder that expands into a Markdown editor. ⌘/Ctrl+Enter posts;
 * Escape collapses an empty editor or just leaves a non-empty one (the draft is kept).
 */
function CommentComposer({ issueKey }: { issueKey: string }) {
  const { user: me } = useAuth()
  const add = useAddComment(issueKey)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  useReportUnsaved(open && draft.trim() !== '')
  // Closing the editor (posted, Cancel, Escape when empty) puts focus back on "Add a comment…".
  const { buttonRef, editorRef, returnFocus } = useEditorFocusReturn(open)
  const close = (options?: { ifFocusInside?: boolean }) => {
    returnFocus(options)
    setDraft('')
    setOpen(false)
  }

  const submit = async () => {
    const body = draft.trim()
    if (!body || add.isPending) return
    try {
      await add.mutateAsync(body)
      close({ ifFocusInside: true })
    } catch (err) {
      toastSaveError(err, 'Couldn’t add the comment')
    }
  }

  const onEscape = () => {
    if (!draft.trim()) {
      close()
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && editorRef.current?.contains(active)) active.blur()
  }

  return (
    <div className="flex gap-3">
      <UserAvatar user={me} size="lg" tooltip={false} />
      <div ref={editorRef} className="min-w-0 flex-1" data-local-escape={open || undefined}>
        {open ? (
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            autoFocus
            minRows={3}
            maxLength={MAX_COMMENT_LENGTH}
            saving={add.isPending}
            placeholder="Add a comment… (Markdown supported)"
            aria-label="Add a comment"
            onSubmit={() => void submit()}
            submitHint="to save"
            onEscape={onEscape}
            footer={
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" loading={add.isPending} disabled={!draft.trim()} onClick={() => void submit()}>
                  Save
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={add.isPending}
                  onClick={() => close()}
                >
                  Cancel
                </Button>
              </div>
            }
          />
        ) : (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            className={cn(controlClasses, 'flex h-9 items-center px-3 text-left text-sm text-fg-subtle')}
          >
            Add a comment…
          </button>
        )}
      </div>
    </div>
  )
}
