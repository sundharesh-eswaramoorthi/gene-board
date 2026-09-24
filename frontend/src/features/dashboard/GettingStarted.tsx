import { FolderPlus, ListChecks, Rocket, UsersRound, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClasses } from '@/components/ui/Button'

const STEPS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: FolderPlus,
    title: 'Create a project',
    description: 'Pick Scrum to plan in sprints from a backlog, or Kanban for a continuous flow of work.',
  },
  {
    icon: UsersRound,
    title: 'Invite your team',
    description: 'Add teammates by email from Project settings → Members and choose what they can do.',
  },
  {
    icon: ListChecks,
    title: 'Plan the work',
    description: 'Break epics into stories, tasks and bugs, then track them across the board.',
  },
]

/** First-run panel for users who are not in any project yet. */
export function GettingStarted({ name }: { name: string }) {
  return (
    <section
      aria-labelledby="getting-started-heading"
      className="overflow-hidden rounded-lg border border-border bg-surface"
      data-testid="dashboard-getting-started"
    >
      <div className="flex flex-col items-start gap-4 border-b border-border bg-primary-subtle/60 px-6 py-8 sm:flex-row sm:items-center">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
          <Rocket className="size-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="getting-started-heading" className="text-lg font-semibold text-fg">
            Welcome to Gene Board, {name}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            You’re not part of any project yet. Create one to start tracking work — or ask a teammate to add you to
            theirs.
          </p>
        </div>
        <Link to="/projects?create=1" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
          <FolderPlus aria-hidden />
          Create your first project
        </Link>
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, description }, i) => (
          <li key={title} className="flex gap-3 bg-surface px-6 py-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-fg-muted">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">
                <span className="text-fg-subtle">{i + 1}.</span> {title}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
