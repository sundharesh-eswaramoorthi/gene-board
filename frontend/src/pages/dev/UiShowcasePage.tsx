import { Copy, Inbox, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Activity, ID, IssueType, Label, Priority, UserSummary } from '@/api/types'
import {
  ActivityItem,
  DueDateLabel,
  EpicChip,
  IssueKeyLink,
  IssuePicker,
  IssueTypeIcon,
  LabelChip,
  LabelMultiSelect,
  ParentPicker,
  PriorityIcon,
  PrioritySelect,
  ProjectAvatar,
  ProjectSelect,
  SprintSelect,
  StatusLozenge,
  StatusSelect,
  StoryPointsBadge,
  TypeSelect,
  UserAvatar,
  UserPicker,
  type IssuePickerValue,
} from '@/components/issue'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Markdown } from '@/components/ui/Markdown'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EditableText,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  SegmentedProgress,
  Select,
  Skeleton,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  useConfirm,
} from '@/components/ui'
import { ISSUE_TYPES, PRIORITIES } from '@/lib/issueMeta'

const PROJECT = 'GB'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-fg">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  )
}

const now = new Date().toISOString()
const sampleActivities: Activity[] = [
  { id: 1, projectId: 1, projectKey: 'GB', issueId: 2, issueKey: 'GB-2', actor: { id: 2, name: 'Alex Morgan', email: '' }, action: 'issue.updated', field: 'status', oldValue: 'To Do', newValue: 'In Progress', createdAt: now },
  { id: 2, projectId: 1, projectKey: 'GB', issueId: 3, issueKey: 'GB-3', actor: { id: 1, name: 'Demo User', email: '' }, action: 'comment.created', field: null, oldValue: null, newValue: 'Looks like the refresh token is not persisted between sessions.', createdAt: now },
  { id: 3, projectId: 1, projectKey: 'GB', issueId: null, issueKey: null, actor: { id: 1, name: 'Demo User', email: '' }, action: 'sprint.started', field: null, oldValue: null, newValue: 'GB Sprint 2', createdAt: now },
  { id: 4, projectId: 1, projectKey: 'GB', issueId: 4, issueKey: 'GB-4', actor: { id: 3, name: 'Sam Lee', email: '' }, action: 'issue.updated', field: 'assignee', oldValue: null, newValue: 'Sam Lee', createdAt: now },
]

/** Dev-only design-system playground (`/dev/ui`): every shared primitive, chip and picker. */
export function UiShowcasePage() {
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [type, setType] = useState<IssueType>('story')
  const [priority, setPriority] = useState<Priority>('medium')
  const [statusId, setStatusId] = useState<ID | null>(2)
  const [assignee, setAssignee] = useState<ID | UserSummary | null>(2)
  const [labelIds, setLabelIds] = useState<ID[] | Label[]>([1])
  const [sprintId, setSprintId] = useState<ID | null>(1)
  const [parent, setParent] = useState<IssuePickerValue | null>(null)
  const [linked, setLinked] = useState<IssuePickerValue | null>(null)
  const [projectKey, setProjectKey] = useState<string | null>('GB')
  const [summary, setSummary] = useState('Click to edit this summary')
  const [view, setView] = useState<'list' | 'board'>('board')
  const [checked, setChecked] = useState(true)
  const [query, setQuery] = useState('')

  return (
    <PageContainer size="wide" className="flex flex-col gap-5">
      <PageHeader
        title="UI kit"
        breadcrumbs={[{ label: 'Dev', to: '/' }, { label: 'UI kit' }]}
        description="Shared primitives, issue components and pickers (development only)."
        actions={
          <>
            <Button icon={<Copy />}>Secondary</Button>
            <Button variant="primary" icon={<Plus />}>
              Primary
            </Button>
          </>
        }
      />

      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="danger" icon={<Trash2 />}>
          Delete
        </Button>
        <Button variant="link">Link button</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <IconButton label="Edit" icon={<Pencil />} />
        <IconButton label="More" icon={<MoreHorizontal />} variant="secondary" />
        <IconButton label="Delete" icon={<Trash2 />} variant="danger" size="sm" />
        <span className="flex items-center gap-1 text-sm text-fg-muted">
          Press <Kbd>C</Kbd> to create, <Kbd>/</Kbd> to search
        </span>
      </Section>

      <Section title="Form controls">
        <div className="grid w-full gap-4 md:grid-cols-3">
          <Field label="Summary" required hint="Keep it short">
            <Input placeholder="What needs to be done?" />
          </Field>
          <Field label="With error" error="Summary is required">
            <Input defaultValue="" />
          </Field>
          <Field label="Native select">
            <Select options={PRIORITIES.map((p) => ({ value: p, label: p }))} defaultValue="medium" />
          </Field>
          <Field label="Search">
            <SearchInput value={query} onChange={setQuery} placeholder="Search this board" />
          </Field>
          <Field label="Due date">
            <Input type="date" />
          </Field>
          <Field label="Disabled">
            <Input disabled value="Read only" readOnly />
          </Field>
          <Field label="Description" className="md:col-span-2">
            <Textarea placeholder="Add a description…" minRows={3} />
          </Field>
          <div className="flex flex-col gap-3 pt-6">
            <Checkbox checked={checked} onCheckedChange={setChecked} label="Create another" description="Keep the dialog open" />
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'list', label: 'List' },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="Issue display">
        <div className="flex flex-wrap items-center gap-3">
          {ISSUE_TYPES.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-sm">
              <IssueTypeIcon type={t} /> {t}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {PRIORITIES.map((p) => (
            <PriorityIcon key={p} priority={p} showLabel className="text-sm" />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusLozenge status={{ name: 'To Do', category: 'todo' }} />
          <StatusLozenge status={{ name: 'In Progress', category: 'in_progress' }} />
          <StatusLozenge status={{ name: 'Done', category: 'done' }} />
          <LabelChip label={{ name: 'backend', color: '#0E7C86' }} />
          <LabelChip label={{ name: 'urgent', color: '#E5493A' }} onRemove={() => toast('Removed')} />
          <EpicChip epic={{ id: 1, key: 'GB-1', summary: 'Authentication & onboarding' }} interactive />
          <EpicChip epic={{ id: 2, summary: 'Board polish' }} />
          <StoryPointsBadge points={3} />
          <StoryPointsBadge points={null} showEmpty />
          <DueDateLabel date="2026-01-02" />
          <DueDateLabel date="2099-01-02" format="long" />
          <IssueKeyLink issueKey="GB-2" />
          <IssueKeyLink issueKey="GB-4" tone="muted" done />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UserAvatar user={{ id: 1, name: 'Demo User' }} size="xs" />
          <UserAvatar user={{ id: 2, name: 'Alex Morgan' }} size="sm" />
          <UserAvatar user={{ id: 3, name: 'Sam Lee' }} size="md" />
          <UserAvatar user={{ id: 4, name: 'Priya Natarajan' }} size="lg" />
          <UserAvatar user={null} size="lg" />
          <UserAvatar user={{ id: 5, name: 'Jordan Kim' }} showName />
          <UserAvatar user={null} showName />
          <ProjectAvatar project={{ key: 'GB', name: 'Gene Board' }} size="lg" />
          <ProjectAvatar project={{ key: 'OPS', name: 'Operations' }} size="lg" />
        </div>
        <div className="flex w-full max-w-md flex-col gap-2">
          <ProgressBar value={5} max={13} aria-label="Points done" />
          <SegmentedProgress
            total={10}
            segments={[
              { value: 4, tone: 'success', label: 'Done' },
              { value: 3, tone: 'info', label: 'In progress' },
            ]}
          />
        </div>
      </Section>

      <Section title="Pickers — field variant (forms)">
        <div className="grid w-full gap-4 md:grid-cols-3">
          <Field label="Project">
            <ProjectSelect value={projectKey} onChange={setProjectKey} />
          </Field>
          <Field label="Type">
            <TypeSelect value={type} onChange={setType} />
          </Field>
          <Field label="Status">
            <StatusSelect projectKey={PROJECT} value={statusId} onChange={setStatusId} />
          </Field>
          <Field label="Priority">
            <PrioritySelect value={priority} onChange={setPriority} />
          </Field>
          <Field label="Assignee">
            <UserPicker projectKey={PROJECT} value={assignee} onChange={(id) => setAssignee(id)} />
          </Field>
          <Field label="Labels">
            <LabelMultiSelect projectKey={PROJECT} value={labelIds} onChange={(ids) => setLabelIds(ids)} />
          </Field>
          <Field label="Sprint">
            <SprintSelect projectKey={PROJECT} value={sprintId} onChange={setSprintId} />
          </Field>
          <Field label="Epic">
            <ParentPicker projectKey={PROJECT} childType={type} value={parent} onChange={setParent} />
          </Field>
          <Field label="Linked issue">
            <IssuePicker value={linked} onChange={setLinked} />
          </Field>
        </div>
      </Section>

      <Section title="Pickers — inline & compact variants (issue view, rows, cards)">
        <div className="grid w-80 grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-fg-muted">Status</span>
          <div>
            <StatusSelect projectKey={PROJECT} value={statusId} onChange={setStatusId} variant="button" />
          </div>
          <span className="text-fg-muted">Assignee</span>
          <UserPicker projectKey={PROJECT} value={assignee} onChange={(id) => setAssignee(id)} variant="inline" />
          <span className="text-fg-muted">Priority</span>
          <PrioritySelect value={priority} onChange={setPriority} variant="inline" />
          <span className="text-fg-muted">Labels</span>
          <LabelMultiSelect
            projectKey={PROJECT}
            value={labelIds}
            onChange={(ids) => setLabelIds(ids)}
            variant="inline"
            commitMode="onClose"
          />
          <span className="text-fg-muted">Sprint</span>
          <SprintSelect projectKey={PROJECT} value={sprintId} onChange={setSprintId} variant="inline" />
          <span className="text-fg-muted">Parent</span>
          <ParentPicker projectKey={PROJECT} childType="story" value={parent} onChange={setParent} variant="inline" />
          <span className="text-fg-muted">Read-only</span>
          <UserPicker projectKey={PROJECT} value={assignee} onChange={() => undefined} variant="inline" disabled />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
          <TypeSelect value={type} onChange={setType} variant="compact" />
          <PrioritySelect value={priority} onChange={setPriority} variant="compact" />
          <UserPicker projectKey={PROJECT} value={assignee} onChange={(id) => setAssignee(id)} variant="compact" />
          <LabelMultiSelect projectKey={PROJECT} value={labelIds} onChange={(ids) => setLabelIds(ids)} variant="compact" />
          <StatusSelect projectKey={PROJECT} value={statusId} onChange={setStatusId} variant="compact" />
        </div>
        <div className="w-full max-w-xl">
          <EditableText value={summary} onSave={setSummary} label="Summary" className="text-xl font-semibold" />
        </div>
      </Section>

      <Section title="Overlays & feedback">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Button
          variant="danger"
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete GB-12?',
              description: 'This issue and its subtasks will be deleted permanently.',
              confirmLabel: 'Delete',
              onConfirm: () => new Promise((r) => setTimeout(r, 800)),
            })
            if (ok) toast.success('Deleted GB-12')
          }}
        >
          Confirm dialog
        </Button>
        <Button onClick={() => toast.success('Issue GB-12 created', { action: { label: 'View', onClick: () => undefined } })}>
          Success toast
        </Button>
        <Button onClick={() => toast.error('Couldn’t move the issue')}>Error toast</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Actions" icon={<MoreHorizontal />} variant="secondary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem icon={<Pencil />} shortcut="E">
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />}>Copy link</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} tone="danger">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Start sprint"
          description="GB Sprint 2 · 3 issues"
          footerStart={<Checkbox checked={checked} onCheckedChange={setChecked} label="Create another" />}
          footer={
            <>
              <Button variant="subtle" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Start
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Sprint name" required>
              <Input defaultValue="GB Sprint 2" />
            </Field>
            <Field label="Sprint goal">
              <Textarea minRows={2} />
            </Field>
          </div>
        </Dialog>
      </Section>

      <Section title="Tabs, table, activity, states">
        <Tabs defaultValue="comments" className="w-full max-w-xl">
          <TabsList>
            <TabsTrigger value="comments" count={2}>
              Comments
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="flex flex-col gap-4">
            {sampleActivities.map((a) => (
              <ActivityItem key={a.id} activity={a} withIssue />
            ))}
          </TabsContent>
          <TabsContent value="history">
            <ActivityItem activity={sampleActivities[0]} />
          </TabsContent>
        </Tabs>
        <Table containerClassName="max-w-2xl">
          <TableHeader>
            <TableRow>
              <TableHead sort="asc" onSort={() => undefined}>
                Key
              </TableHead>
              <TableHead>Summary</TableHead>
              <TableHead onSort={() => undefined}>Priority</TableHead>
              <TableHead>Assignee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow interactive>
              <TableCell>
                <span className="flex items-center gap-2">
                  <IssueTypeIcon type="story" />
                  <IssueKeyLink issueKey="GB-2" />
                </span>
              </TableCell>
              <TableCell>Login page with validation</TableCell>
              <TableCell>
                <PriorityIcon priority="high" />
              </TableCell>
              <TableCell>
                <UserAvatar user={{ id: 2, name: 'Alex Morgan' }} showName />
              </TableCell>
            </TableRow>
            <TableRow interactive selected>
              <TableCell>
                <span className="flex items-center gap-2">
                  <IssueTypeIcon type="bug" />
                  <IssueKeyLink issueKey="GB-3" />
                </span>
              </TableCell>
              <TableCell>Token refresh fails after 7 days</TableCell>
              <TableCell>
                <PriorityIcon priority="highest" />
              </TableCell>
              <TableCell>
                <UserAvatar user={null} showName />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div className="w-72 rounded-lg border border-border">
          <EmptyState size="sm" icon={<Inbox />} title="No issues" description="Create one to get started." />
        </div>
        <div className="flex w-72 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <SkeletonRows rows={3} />
        </div>
        <Markdown className="w-full max-w-xl rounded-lg border border-border p-4">
          {'### Acceptance criteria\n\n- [x] Users can **log in** with email\n- [ ] Sessions expire after `7d`\n\n| Field | Rule |\n| --- | --- |\n| email | required |\n\n> See [the spec](https://example.com) and ~~old notes~~.\n\n```ts\nconst ok = true\n```'}
        </Markdown>
        <div className="flex gap-2">
          <Badge>12</Badge>
          <Badge tone="primary">New</Badge>
          <Badge tone="danger" variant="solid">
            4/3
          </Badge>
          <Badge tone="success">Done</Badge>
          <Badge tone="warning" shape="square">
            Due soon
          </Badge>
        </div>
      </Section>
    </PageContainer>
  )
}
