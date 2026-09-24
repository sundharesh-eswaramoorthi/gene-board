import { useSearchParams } from 'react-router'
import { useLabels } from '@/api/labels'
import { useMembers } from '@/api/members'
import { useStatuses } from '@/api/statuses'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useDocumentTitle } from '@/lib/hooks'
import { useProjectRole } from '@/lib/useProjectRole'
import { ColumnsTab } from './ColumnsTab'
import { DetailsTab } from './DetailsTab'
import { LabelsTab } from './LabelsTab'
import { MembersTab } from './MembersTab'
import { ReadOnlyNotice } from './SettingsSection'

const TABS = ['details', 'members', 'columns', 'labels'] as const
type SettingsTab = (typeof TABS)[number]

const TAB_LABELS: Record<SettingsTab, string> = {
  details: 'Details',
  members: 'Members',
  columns: 'Columns',
  labels: 'Labels',
}

function parseTab(value: string | null): SettingsTab {
  return TABS.find((t) => t === value?.toLowerCase()) ?? 'details'
}

/**
 * Project settings with Details, Members, Columns and Labels tabs. The active tab is kept in
 * `?tab=` so each tab can be linked to. Non-admins see read-only views and a note explaining why.
 */
export function ProjectSettingsPage() {
  const project = useCurrentProject()
  const { role, isAdmin, canEdit } = useProjectRole(project.key)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  useDocumentTitle(`${TAB_LABELS[tab]} · ${project.name} settings`)

  // Counts for the tab badges (shared cache with the tabs themselves).
  const members = useMembers(project.key)
  const statuses = useStatuses(project.key)
  const labels = useLabels(project.key)

  const selectTab = (value: string) => {
    const next = parseTab(value)
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'details') params.delete('tab')
        else params.set('tab', next)
        return params
      },
      { replace: true },
    )
  }

  return (
    <PageContainer size="narrow" className="max-w-4xl pb-10">
      <PageHeader
        title="Project settings"
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          { label: project.name, to: `/projects/${project.key}` },
          { label: 'Settings' },
        ]}
      />
      {!isAdmin && role && <ReadOnlyNotice role={role} />}
      <Tabs value={tab} onValueChange={selectTab} className={!isAdmin && role ? 'mt-4' : undefined}>
        <TabsList aria-label="Project settings sections">
          <TabsTrigger value="details" data-testid="settings-tab-details">
            {TAB_LABELS.details}
          </TabsTrigger>
          <TabsTrigger value="members" count={members.data?.length} data-testid="settings-tab-members">
            {TAB_LABELS.members}
          </TabsTrigger>
          <TabsTrigger value="columns" count={statuses.data?.length} data-testid="settings-tab-columns">
            {TAB_LABELS.columns}
          </TabsTrigger>
          <TabsTrigger value="labels" count={labels.data?.length} data-testid="settings-tab-labels">
            {TAB_LABELS.labels}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-5">
          <DetailsTab project={project} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="members" className="pt-5">
          <MembersTab project={project} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="columns" className="pt-5">
          <ColumnsTab project={project} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="labels" className="pt-5">
          <LabelsTab project={project} isAdmin={isAdmin} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
