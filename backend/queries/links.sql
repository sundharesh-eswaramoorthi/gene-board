-- Issue links. source_id is the outward side ("GB-1 blocks GB-2": source = GB-1).

-- name: CreateIssueLink :one
INSERT INTO issue_links (type, source_id, target_id, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetIssueLink :one
SELECT * FROM issue_links WHERE id = $1;

-- DeleteIssueLink returns the number of links deleted: 0 when a concurrent delete won.
-- name: DeleteIssueLink :execrows
DELETE FROM issue_links WHERE id = $1;

-- name: ListIssueLinks :many
SELECT * FROM issue_links WHERE source_id = $1 OR target_id = $1 ORDER BY created_at, id;

-- IssueLinkExists reports whether a link of `type` exists from source to target.
-- name: IssueLinkExists :one
SELECT EXISTS (
    SELECT 1 FROM issue_links WHERE type = $1 AND source_id = $2 AND target_id = $3
);
