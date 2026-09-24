-- Activity / audit log. All list queries return the same column set so the service can
-- map their rows with one function.

-- name: CreateActivity :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListIssueActivities :many
SELECT sqlc.embed(a), p.key AS project_key, u.name AS actor_name, u.email AS actor_email
FROM activities a
JOIN projects p ON p.id = a.project_id
LEFT JOIN users u ON u.id = a.actor_id
WHERE a.issue_id = @issue_id::bigint
ORDER BY a.created_at DESC, a.id DESC;

-- name: ListProjectActivities :many
SELECT sqlc.embed(a), p.key AS project_key, u.name AS actor_name, u.email AS actor_email
FROM activities a
JOIN projects p ON p.id = a.project_id
LEFT JOIN users u ON u.id = a.actor_id
WHERE a.project_id = @project_id
ORDER BY a.created_at DESC, a.id DESC
LIMIT @max_results::int OFFSET @skip::bigint;

-- name: ListUserFeedActivities :many
SELECT sqlc.embed(a), p.key AS project_key, u.name AS actor_name, u.email AS actor_email
FROM activities a
JOIN projects p ON p.id = a.project_id
LEFT JOIN users u ON u.id = a.actor_id
WHERE a.project_id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = @user_id)
ORDER BY a.created_at DESC, a.id DESC
LIMIT @max_results::int OFFSET @skip::bigint;
