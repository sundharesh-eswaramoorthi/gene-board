-- Read models for the board, backlog and epics pages (SPEC §2 Boards, §5).
-- Every list is in rank order; ties (which only manual SQL can create) break by id.

-- ListSprintBoardIssues returns the issues shown on a Scrum board: every non-epic issue
-- (standard issues and subtasks) of the sprint.
-- name: ListSprintBoardIssues :many
SELECT * FROM issues
WHERE sprint_id = @sprint_id::bigint AND type <> 'epic'
ORDER BY rank, id;

-- ListKanbanBoardIssues returns the issues shown on a Kanban board: every non-epic issue
-- of the project except done-category issues resolved more than @done_retention_days
-- ago.
-- name: ListKanbanBoardIssues :many
SELECT * FROM issues i
WHERE i.project_id = @project_id
  AND i.type <> 'epic'
  AND NOT (
      i.resolved_at IS NOT NULL
      AND i.resolved_at < now() - make_interval(days => @done_retention_days::int)
      AND i.status_id IN (SELECT s.id FROM statuses s WHERE s.project_id = @project_id AND s.category = 'done')
  )
ORDER BY i.rank, i.id;

-- ListBacklogIssues returns the standard issues (stories, tasks, bugs) shown on the
-- backlog page: those without a sprint, those in active or planned sprints, and open
-- issues left behind in completed sprints (e.g. reopened after the sprint closed), which
-- Jira also lists in the backlog. Done issues of completed sprints are history and are
-- excluded.
-- name: ListBacklogIssues :many
SELECT * FROM issues i
WHERE i.project_id = @project_id
  AND i.type IN ('story', 'task', 'bug')
  AND NOT (
      i.sprint_id IN (SELECT sp.id FROM sprints sp WHERE sp.project_id = @project_id AND sp.state = 'completed')
      AND i.status_id IN (SELECT s.id FROM statuses s WHERE s.project_id = @project_id AND s.category = 'done')
  )
ORDER BY i.rank, i.id;

-- name: ListProjectEpics :many
SELECT * FROM issues WHERE project_id = $1 AND type = 'epic' ORDER BY rank, id;

-- ListEpicProgress aggregates each epic's direct children (stories, tasks and bugs) by
-- status category. Epics without children have no row.
-- name: ListEpicProgress :many
SELECT i.parent_id::bigint AS epic_id,
       count(*)::bigint AS total,
       count(*) FILTER (WHERE s.category = 'done')::bigint AS done,
       count(*) FILTER (WHERE s.category = 'in_progress')::bigint AS in_progress,
       COALESCE(sum(i.story_points), 0)::float8 AS points_total,
       COALESCE(sum(i.story_points) FILTER (WHERE s.category = 'done'), 0)::float8 AS points_done
FROM issues i
JOIN statuses s ON s.id = i.status_id
WHERE i.parent_id = ANY(@epic_ids::bigint[])
  AND i.type <> 'subtask'
GROUP BY i.parent_id;
