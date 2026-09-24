-- Issues. The dynamic, filterable search lives in internal/service/issue_query.go.

-- name: CreateIssue :one
INSERT INTO issues (
    project_id, number, key, type, summary, description, status_id, priority,
    assignee_id, reporter_id, parent_id, sprint_id, story_points, due_date, rank, resolved_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    $9, $10, $11, $12, $13, $14, $15, $16
)
RETURNING *;

-- name: GetIssueByID :one
SELECT * FROM issues WHERE id = $1;

-- GetIssueForShare reads an issue with a share lock held until the end of the transaction:
-- a new or re-parented subtask copies its parent's sprint, and the lock keeps that sprint
-- from changing (or the parent from being deleted) before the subtask is committed.
-- name: GetIssueForShare :one
SELECT * FROM issues WHERE id = $1 FOR SHARE;

-- GetIssueForKeyShare reads an issue with the lock a foreign-key check takes. Writes that
-- insert rows referencing the issue (comments, links, activity) take it when they validate
-- the issue, so a concurrent delete either commits first (the row is then gone: 404) or
-- waits for the insert — never a foreign-key violation.
-- name: GetIssueForKeyShare :one
SELECT * FROM issues WHERE id = $1 FOR KEY SHARE;

-- LockIssue re-reads an issue with a row lock that serialises writers of the issue but not
-- inserts that reference it (comments, links, activity rows).
-- name: LockIssue :one
SELECT * FROM issues WHERE id = $1 FOR NO KEY UPDATE;

-- GetIssueAccessByKey returns the issue, its project and the caller's role.
-- No row means the issue does not exist or the caller is not a member of its project.
-- name: GetIssueAccessByKey :one
SELECT sqlc.embed(i), sqlc.embed(p), pm.role
FROM issues i
JOIN projects p ON p.id = i.project_id
JOIN project_members pm ON pm.project_id = i.project_id AND pm.user_id = @user_id
WHERE i.key = @key;

-- name: GetIssueAccessByID :one
SELECT sqlc.embed(i), sqlc.embed(p), pm.role
FROM issues i
JOIN projects p ON p.id = i.project_id
JOIN project_members pm ON pm.project_id = i.project_id AND pm.user_id = @user_id
WHERE i.id = @issue_id;

-- name: ListIssuesByIDs :many
SELECT * FROM issues WHERE id = ANY(@ids::bigint[]);

-- ListChildIssues returns direct children (epic -> standard issues, standard -> subtasks).
-- name: ListChildIssues :many
SELECT * FROM issues WHERE parent_id = @parent_id::bigint ORDER BY rank, id;

-- name: ListSubtasks :many
SELECT * FROM issues WHERE parent_id = @parent_id::bigint AND type = 'subtask' ORDER BY rank, id;

-- name: CountSubtasks :many
SELECT parent_id::bigint AS parent_id, count(*)::bigint AS subtask_count
FROM issues
WHERE type = 'subtask' AND parent_id = ANY(@parent_ids::bigint[])
GROUP BY parent_id;

-- name: MaxIssueRank :one
SELECT COALESCE(MAX(rank), '')::text FROM issues WHERE project_id = $1;

-- RankAfter returns the smallest rank in the project greater than `rank` ('' if none),
-- ignoring the issue being moved. Used to keep generated ranks unique project-wide.
-- name: RankAfter :one
SELECT COALESCE(MIN(i.rank), '')::text FROM issues i
WHERE i.project_id = @project_id AND i.rank > @rank::text AND i.id <> @exclude_id;

-- RankBefore returns the greatest rank in the project less than `rank` ('' if none),
-- ignoring the issue being moved.
-- name: RankBefore :one
SELECT COALESCE(MAX(i.rank), '')::text FROM issues i
WHERE i.project_id = @project_id AND i.rank < @rank::text AND i.id <> @exclude_id;

-- UpdateIssue writes every mutable column and bumps updated_at.
-- name: UpdateIssue :one
UPDATE issues
SET type         = $2,
    summary      = $3,
    description  = $4,
    status_id    = $5,
    priority     = $6,
    assignee_id  = $7,
    reporter_id  = $8,
    parent_id    = $9,
    sprint_id    = $10,
    story_points = $11,
    due_date     = $12,
    resolved_at  = $13,
    updated_at   = now()
WHERE id = $1
RETURNING *;

-- SetIssueRank changes only the rank (rank-only moves do not touch updated_at).
-- name: SetIssueRank :one
UPDATE issues SET rank = $2 WHERE id = $1 RETURNING *;

-- name: DeleteIssue :exec
DELETE FROM issues WHERE id = $1;

-- LogUnparentChildren records the parent change of every non-subtask child of
-- `parent_id`; run it before UnparentChildren.
-- name: LogUnparentChildren :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
SELECT i.project_id, i.id, i.key, @actor_id::bigint, 'issue.updated', 'parent', @parent_key::text, NULL
FROM issues i
WHERE i.parent_id = @parent_id::bigint AND i.type <> 'subtask';

-- name: UnparentChildren :exec
UPDATE issues SET parent_id = NULL, updated_at = now()
WHERE parent_id = @parent_id::bigint AND type <> 'subtask';

-- LogSubtaskSprintSync records a sprint change for every subtask (of the given parents)
-- whose sprint differs from its parent's; run it before SyncSubtaskSprints.
-- name: LogSubtaskSprintSync :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
SELECT st.project_id, st.id, st.key, @actor_id::bigint, 'issue.updated', 'sprint', os.name, ns.name
FROM issues st
JOIN issues par ON par.id = st.parent_id
LEFT JOIN sprints os ON os.id = st.sprint_id
LEFT JOIN sprints ns ON ns.id = par.sprint_id
WHERE st.type = 'subtask'
  AND st.parent_id = ANY(@parent_ids::bigint[])
  AND st.sprint_id IS DISTINCT FROM par.sprint_id;

-- SyncSubtaskSprints sets each subtask's sprint to its parent's sprint.
-- name: SyncSubtaskSprints :execrows
UPDATE issues st
SET sprint_id = par.sprint_id, updated_at = now()
FROM issues par
WHERE par.id = st.parent_id
  AND st.type = 'subtask'
  AND st.parent_id = ANY(@parent_ids::bigint[])
  AND st.sprint_id IS DISTINCT FROM par.sprint_id;
