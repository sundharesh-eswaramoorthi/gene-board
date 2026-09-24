-- Workflow statuses (board columns).

-- name: ListStatuses :many
SELECT * FROM statuses WHERE project_id = $1 ORDER BY position, id;

-- name: ListStatusesByIDs :many
SELECT * FROM statuses WHERE id = ANY(@ids::bigint[]);

-- name: GetStatus :one
SELECT * FROM statuses WHERE id = $1;

-- GetStatusForKeyShare reads a status with the FOR KEY SHARE lock a foreign-key check takes.
-- Issue writes that point an issue at a status use it, so a concurrent DeleteStatus or
-- category change (which hold LockStatus) either finishes first — and the write then finds
-- the status gone or reads its new category — or waits for the write and then includes the
-- issue (moving it along, or re-deriving its resolved_at).
-- name: GetStatusForKeyShare :one
SELECT * FROM statuses WHERE id = $1 FOR KEY SHARE;

-- LockStatus locks a status that is about to be changed or deleted. FOR UPDATE conflicts
-- with GetStatusForKeyShare (a plain category change would only take FOR NO KEY UPDATE,
-- which issue writers do not wait for).
-- name: LockStatus :one
SELECT * FROM statuses WHERE id = $1 FOR UPDATE;

-- name: CreateStatus :one
INSERT INTO statuses (project_id, name, category, position, wip_limit)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: NextStatusPosition :one
SELECT COALESCE(MAX(position) + 1, 0)::int FROM statuses WHERE project_id = $1;

-- name: UpdateStatus :one
UPDATE statuses SET name = $2, category = $3, wip_limit = $4 WHERE id = $1 RETURNING *;

-- ReorderStatuses sets position = index in `ids` (0-based). `ids` must be a permutation of
-- the project's status ids (validated by the service).
-- name: ReorderStatuses :exec
UPDATE statuses s
SET position = (o.ord - 1)::int
FROM unnest(@ids::bigint[]) WITH ORDINALITY AS o(id, ord)
WHERE s.id = o.id AND s.project_id = @project_id::bigint;

-- CompactStatusPositions renumbers positions 0..n-1 keeping the current order.
-- name: CompactStatusPositions :exec
UPDATE statuses s
SET position = r.pos
FROM (
    SELECT s2.id, (row_number() OVER (ORDER BY s2.position, s2.id) - 1)::int AS pos
    FROM statuses s2
    WHERE s2.project_id = @project_id::bigint
) r
WHERE s.id = r.id AND s.position <> r.pos;

-- name: DeleteStatus :exec
DELETE FROM statuses WHERE id = $1;

-- name: CountStatusIssues :one
SELECT count(*) FROM issues WHERE status_id = $1;

-- SyncResolvedAtForStatus re-derives resolved_at after a status changed category.
-- name: SyncResolvedAtForStatus :exec
UPDATE issues
SET resolved_at = CASE WHEN @done::bool THEN COALESCE(resolved_at, now()) ELSE NULL END
WHERE status_id = @status_id;

-- LogStatusMigration records the status change of every issue about to be moved by
-- MoveIssuesToStatus. Run it first.
-- name: LogStatusMigration :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
SELECT i.project_id, i.id, i.key, @actor_id::bigint, 'issue.updated', 'status', @old_name::text, @new_name::text
FROM issues i
WHERE i.status_id = @from_status_id;

-- name: MoveIssuesToStatus :exec
UPDATE issues
SET status_id   = @to_status_id,
    resolved_at = CASE WHEN @to_done::bool THEN COALESCE(resolved_at, now()) ELSE NULL END,
    updated_at  = now()
WHERE status_id = @from_status_id;
