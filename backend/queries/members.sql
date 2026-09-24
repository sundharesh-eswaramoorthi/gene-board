-- Project members.

-- name: AddMember :one
INSERT INTO project_members (project_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetMember :one
SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2;

-- ListMemberViews returns members with their user data ordered by name (optionally one user),
-- in the Unicode root collation like every name-ordered list (see labels.sql).
-- name: ListMemberViews :many
SELECT pm.user_id, pm.role, pm.created_at, u.name, u.email
FROM project_members pm
JOIN users u ON u.id = pm.user_id
WHERE pm.project_id = @project_id
  AND (sqlc.narg(user_id)::bigint IS NULL OR pm.user_id = sqlc.narg(user_id)::bigint)
ORDER BY lower(u.name) COLLATE "und-x-icu", u.id;

-- name: UpdateMemberRole :exec
UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2;

-- name: DeleteMember :exec
DELETE FROM project_members WHERE project_id = $1 AND user_id = $2;

-- name: CountProjectAdmins :one
SELECT count(*) FROM project_members WHERE project_id = $1 AND role = 'admin';

-- name: IsProjectMember :one
SELECT EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2);

-- name: ListMemberProjectIDs :many
SELECT project_id FROM project_members WHERE user_id = $1;

-- name: ListMemberProjectKeys :many
SELECT p.key FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = $1;

-- LogUnassignMemberIssues records an assignee change for every issue about to be
-- unassigned by UnassignMemberIssues. Run it first.
-- name: LogUnassignMemberIssues :exec
INSERT INTO activities (project_id, issue_id, issue_key, actor_id, action, field, old_value, new_value)
SELECT i.project_id, i.id, i.key, @actor_id::bigint, 'issue.updated', 'assignee', u.name, NULL
FROM issues i
JOIN users u ON u.id = i.assignee_id
WHERE i.project_id = @project_id AND i.assignee_id = @user_id::bigint;

-- name: UnassignMemberIssues :exec
UPDATE issues SET assignee_id = NULL, updated_at = now()
WHERE project_id = @project_id AND assignee_id = @user_id::bigint;
