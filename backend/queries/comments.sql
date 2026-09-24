-- Issue comments.

-- name: CreateComment :one
INSERT INTO comments (issue_id, author_id, body) VALUES ($1, $2, $3) RETURNING *;

-- name: GetComment :one
SELECT * FROM comments WHERE id = $1;

-- name: ListCommentViews :many
SELECT sqlc.embed(c), u.name AS author_name, u.email AS author_email
FROM comments c
LEFT JOIN users u ON u.id = c.author_id
WHERE c.issue_id = $1
ORDER BY c.created_at, c.id;

-- name: UpdateCommentBody :one
UPDATE comments SET body = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteComment :exec
DELETE FROM comments WHERE id = $1;
