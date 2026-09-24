-- Projects and project membership lookups used for permission checks.

-- name: CreateProject :one
INSERT INTO projects (key, name, description, type, lead_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetProjectByID :one
SELECT * FROM projects WHERE id = $1;

-- GetProjectAccessByKey returns the project together with the caller's role.
-- No row means the project does not exist or the caller is not a member.
-- name: GetProjectAccessByKey :one
SELECT sqlc.embed(p), pm.role
FROM projects p
JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = @user_id
WHERE p.key = @key;

-- name: GetProjectAccessByID :one
SELECT sqlc.embed(p), pm.role
FROM projects p
JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = @user_id
WHERE p.id = @project_id;

-- ListProjectViews returns everything needed to render Project DTOs for the projects the
-- user belongs to (optionally restricted to one project).
-- name: ListProjectViews :many
SELECT sqlc.embed(p),
       pm.role,
       (SELECT count(*) FROM issues i WHERE i.project_id = p.id)::bigint AS issue_count,
       u.name  AS lead_name,
       u.email AS lead_email
FROM projects p
JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = @user_id
LEFT JOIN users u ON u.id = p.lead_id
WHERE (sqlc.narg(project_id)::bigint IS NULL OR p.id = sqlc.narg(project_id)::bigint)
ORDER BY lower(p.name) COLLATE "und-x-icu", p.id;

-- LockProject takes a row lock on the project; used to serialise rank computations,
-- admin-count checks and sprint lifecycle changes inside a transaction. FOR NO KEY UPDATE
-- (like the implicit lock of NextIssueNumber) still lets other transactions insert rows
-- that reference the project: a plain FOR UPDATE would also block their foreign-key checks
-- and deadlock with writers that hold an issue lock while logging activity.
-- Call it through the service's lockProjectAs, which re-reads the project and the caller's
-- role once the lock is held (a project deleted meanwhile locks no row here).
-- name: LockProject :exec
SELECT id FROM projects WHERE id = $1 FOR NO KEY UPDATE;

-- name: UpdateProject :one
UPDATE projects
SET name = $2, description = $3, type = $4, lead_id = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProject :exec
DELETE FROM projects WHERE id = $1;

-- NextIssueNumber atomically reserves the next issue number (and locks the project row
-- until the surrounding transaction ends).
-- name: NextIssueNumber :one
UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = $1 RETURNING issue_counter;

-- name: ClearProjectLead :exec
UPDATE projects SET lead_id = NULL, updated_at = now() WHERE id = @project_id AND lead_id = @user_id::bigint;
