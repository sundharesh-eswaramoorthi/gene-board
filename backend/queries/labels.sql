-- Labels and issue <-> label assignments. Labels are always ordered case-insensitively by name.

-- name: ListLabels :many
SELECT * FROM labels WHERE project_id = $1 ORDER BY lower(name), id;

-- LockLabelsByIDs loads labels with the lock a foreign-key check takes: issue writes
-- assigning labels use it, so a label deleted concurrently is either gone when the write
-- validates it or its delete waits until the assignment has committed.
-- name: LockLabelsByIDs :many
SELECT * FROM labels WHERE id = ANY(@ids::bigint[]) ORDER BY lower(name), id FOR KEY SHARE;

-- name: GetLabel :one
SELECT * FROM labels WHERE id = $1;

-- name: CreateLabel :one
INSERT INTO labels (project_id, name, color) VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateLabel :one
UPDATE labels SET name = $2, color = $3 WHERE id = $1 RETURNING *;

-- name: DeleteLabel :exec
DELETE FROM labels WHERE id = $1;

-- name: ListIssueLabels :many
SELECT il.issue_id, sqlc.embed(l)
FROM issue_labels il
JOIN labels l ON l.id = il.label_id
WHERE il.issue_id = ANY(@issue_ids::bigint[])
ORDER BY il.issue_id, lower(l.name), l.id;

-- name: ClearIssueLabels :exec
DELETE FROM issue_labels WHERE issue_id = $1;

-- name: AddIssueLabels :exec
INSERT INTO issue_labels (issue_id, label_id)
SELECT @issue_id::bigint, unnest(@label_ids::bigint[])
ON CONFLICT DO NOTHING;
