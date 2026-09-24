-- Sprints (Scrum) and their lifecycle: planned -> active -> completed.

-- name: GetSprint :one
SELECT * FROM sprints WHERE id = $1;

-- GetSprintForShare reads a sprint with a FOR SHARE lock: issue writes that put an issue
-- into a sprint take it, so they serialise with sprint lifecycle changes (LockSprint) and
-- never add issues to a sprint that is being completed or deleted.
-- name: GetSprintForShare :one
SELECT * FROM sprints WHERE id = $1 FOR SHARE;

-- LockSprint locks a sprint for a lifecycle change. FOR NO KEY UPDATE conflicts with
-- GetSprintForShare but not with foreign-key checks of issue rows.
-- name: LockSprint :one
SELECT * FROM sprints WHERE id = $1 FOR NO KEY UPDATE;

-- name: ListSprintsByIDs :many
SELECT * FROM sprints WHERE id = ANY(@ids::bigint[]);

-- ListProjectSprints lists a project's sprints, optionally restricted to some states (an
-- empty array means all), ordered as the UI shows them: the active sprint first, then
-- planned sprints by creation (id), then completed sprints, most recently completed first.
-- name: ListProjectSprints :many
SELECT * FROM sprints
WHERE project_id = @project_id
  AND (COALESCE(cardinality(@states::text[]), 0) = 0 OR state = ANY(@states::text[]))
ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
         CASE WHEN state = 'planned' THEN id END,
         completed_at DESC NULLS LAST,
         id DESC;

-- name: GetActiveSprint :one
SELECT * FROM sprints WHERE project_id = $1 AND state = 'active';

-- CountSprintsCreated is the number of sprints ever created in a project, used for default
-- sprint names. sprint.created activity rows outlive deleted sprints; the row count covers
-- sprints inserted without an activity row.
-- name: CountSprintsCreated :one
SELECT GREATEST(
    (SELECT count(*) FROM activities a WHERE a.project_id = @project_id AND a.action = 'sprint.created'),
    (SELECT count(*) FROM sprints s WHERE s.project_id = @project_id)
)::bigint;

-- name: ListSprintNames :many
SELECT name FROM sprints WHERE project_id = $1;

-- name: CreateSprint :one
INSERT INTO sprints (project_id, name, goal, start_date, end_date)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateSprint :one
UPDATE sprints
SET name = $2, goal = $3, start_date = $4, end_date = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: StartSprint :one
UPDATE sprints
SET state = 'active', name = $2, goal = $3, start_date = $4, end_date = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CompleteSprint :one
UPDATE sprints
SET state = 'completed', completed_at = now(), updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteSprint :exec
DELETE FROM sprints WHERE id = $1;

-- ListSprintStats returns, per sprint, the SPEC §4 Sprint statistics over its standard
-- issues (stories, tasks and bugs; subtasks and epics are not counted). Sprints without
-- issues have no row.
-- name: ListSprintStats :many
SELECT i.sprint_id::bigint AS sprint_id,
       count(*)::bigint AS issue_count,
       COALESCE(sum(i.story_points), 0)::float8 AS points_total,
       COALESCE(sum(i.story_points) FILTER (WHERE s.category = 'done'), 0)::float8 AS points_done
FROM issues i
JOIN statuses s ON s.id = i.status_id
WHERE i.sprint_id = ANY(@sprint_ids::bigint[])
  AND i.type IN ('story', 'task', 'bug')
GROUP BY i.sprint_id;

-- ListSprintStandardIssues returns the standard issues of a sprint (the ones that carry
-- their subtasks along when they change sprint) with their status category, locking them
-- for the rest of the transaction. A row locked by a concurrent writer is re-checked once
-- that writer commits (READ COMMITTED's EvalPlanQual): an issue moved out of the sprint or
-- deleted drops out, and an issue whose status changed is returned with its new category.
-- The category must come from a correlated subquery, not a join: the re-check does not
-- re-fetch a joined statuses row for the new status_id, so with a join a re-statused issue
-- would silently vanish from the result (and stay behind in a completed sprint).
-- name: ListSprintStandardIssues :many
SELECT i.id, (SELECT s.category FROM statuses s WHERE s.id = i.status_id)::text AS category
FROM issues i
WHERE i.sprint_id = @sprint_id::bigint
  AND i.type IN ('story', 'task', 'bug')
ORDER BY i.rank, i.id
FOR NO KEY UPDATE;

-- LogIssueSprintChanges records a sprint change (old -> new sprint name; null = backlog)
-- for every listed issue whose sprint differs from the target. Run it before
-- SetIssuesSprint.
-- name: LogIssueSprintChanges :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
SELECT i.project_id, i.id, i.key, @actor_id::bigint, 'issue.updated', 'sprint', os.name, ns.name
FROM issues i
LEFT JOIN sprints os ON os.id = i.sprint_id
LEFT JOIN sprints ns ON ns.id = sqlc.narg(sprint_id)::bigint
WHERE i.id = ANY(@issue_ids::bigint[])
  AND i.sprint_id IS DISTINCT FROM sqlc.narg(sprint_id)::bigint
ORDER BY i.rank, i.id;

-- SetIssuesSprint moves the listed issues to a sprint (null = backlog).
-- name: SetIssuesSprint :exec
UPDATE issues
SET sprint_id = sqlc.narg(sprint_id)::bigint, updated_at = now()
WHERE id = ANY(@issue_ids::bigint[])
  AND sprint_id IS DISTINCT FROM sqlc.narg(sprint_id)::bigint;
