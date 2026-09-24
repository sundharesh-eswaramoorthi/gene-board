import { keepPreviousData } from '@tanstack/react-query'
import { useId } from 'react'
import { useComments } from '@/api/comments'
import type { IssueDetail } from '@/api/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { useLocalStorageState } from '@/lib/hooks'
import { CommentsPanel } from './CommentsPanel'
import { HistoryPanel } from './HistoryPanel'
import { useIssueView } from './IssueViewContext'

type ActivityTab = 'comments' | 'history'

/** Activity: Comments / History tabs (the last chosen tab is remembered in this browser). */
export function ActivitySection({ issue }: { issue: IssueDetail }) {
  const { deleting } = useIssueView()
  const headingId = useId()
  const [storedTab, setTab] = useLocalStorageState<ActivityTab>('gb-issue-activity-tab', 'comments')
  const tab: ActivityTab = storedTab === 'history' ? 'history' : 'comments'
  // Same query as the Comments tab (deduplicated): feeds the count badge.
  const comments = useComments(issue.key, { enabled: !deleting, placeholderData: keepPreviousData })
  const count = comments.data?.length

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-sm font-semibold text-fg">
        Activity
      </h3>
      <Tabs value={tab} onValueChange={(value) => setTab(value === 'history' ? 'history' : 'comments')}>
        <TabsList aria-label="Activity">
          <TabsTrigger value="comments" count={count ? count : undefined}>
            Comments
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="comments">
          <CommentsPanel issue={issue} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryPanel issueKey={issue.key} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
