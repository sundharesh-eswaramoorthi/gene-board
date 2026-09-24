import { TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Project } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { toast, toastError } from '@/components/ui/toast'
import { pluralize } from '@/lib/format'
import { useDeleteProjectAndExit } from './useProjectExit'

/** Props of {@link DeleteProjectDialog}. */
export interface DeleteProjectDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Type-the-key confirmation for deleting a project. On success the user lands on `/projects`.
 */
export function DeleteProjectDialog({ project, open, onOpenChange }: DeleteProjectDialogProps) {
  const [typed, setTyped] = useState('')
  const remove = useDeleteProjectAndExit(project.key)
  const matches = typed.trim().toUpperCase() === project.key

  // mutateAsync (not mutate callbacks): on success this dialog unmounts while navigating away,
  // and per-call mutate callbacks don't run for unmounted observers.
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!matches || remove.isPending) return
    try {
      await remove.mutateAsync()
      toast.success(`Project “${project.name}” was deleted`)
    } catch (err) {
      toastError(err, 'Couldn’t delete the project')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('')
        onOpenChange(next)
      }}
      title={`Delete ${project.name}?`}
      size="sm"
      onSubmit={(e) => void submit(e)}
      preventClose={remove.isPending}
      data-testid="delete-project-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!matches} loading={remove.isPending}>
            Delete project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md bg-danger-subtle px-3 py-2.5 text-sm text-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p>
            This permanently deletes the project with its {pluralize(project.issueCount, 'issue')}, sprints, comments,
            labels and history. It can’t be undone.
          </p>
        </div>
        <Field
          label={
            <>
              Type <span className="font-mono font-bold text-fg">{project.key}</span> to confirm
            </>
          }
        >
          <Input
            data-autofocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
            data-testid="delete-project-confirm-input"
          />
        </Field>
      </div>
    </Dialog>
  )
}
