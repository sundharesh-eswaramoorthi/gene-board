-- Users. Emails are always stored lower-cased (the service normalises input).

-- name: CreateUser :one
INSERT INTO users (email, name, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- UpdateUser changes the name and/or the password hash; a NULL argument keeps that column,
-- so a concurrent update of the other column is never overwritten with a stale value. It
-- writes only while token_version is still the caller's (a password change committed since
-- revoked the caller's token), and a new password hash only while the stored one is still
-- verified_password_hash (the hash the current password was checked against); otherwise no
-- row is returned. A new password hash increments token_version, which invalidates every
-- access token issued before.
-- name: UpdateUser :one
UPDATE users
SET name          = COALESCE(sqlc.narg(name)::text, name),
    password_hash = COALESCE(sqlc.narg(password_hash)::text, password_hash),
    token_version = token_version + CASE WHEN sqlc.narg(password_hash)::text IS NULL THEN 0 ELSE 1 END,
    updated_at    = now()
WHERE id = @id
  AND token_version = @token_version
  AND (sqlc.narg(password_hash)::text IS NULL OR password_hash = @verified_password_hash)
RETURNING *;

-- GetUserTokenVersion returns the token version access tokens of the user must carry.
-- name: GetUserTokenVersion :one
SELECT token_version FROM users WHERE id = $1;

-- name: ListUsersByIDs :many
SELECT * FROM users WHERE id = ANY(@ids::bigint[]);

-- SearchUsers matches name or e-mail case-insensitively. `pattern` must already have
-- LIKE wildcards escaped; an empty pattern returns the first users by name (Unicode root
-- collation, see labels.sql).
-- name: SearchUsers :many
SELECT * FROM users
WHERE @pattern::text = ''
   OR name ILIKE '%' || @pattern::text || '%'
   OR email ILIKE '%' || @pattern::text || '%'
ORDER BY lower(name) COLLATE "und-x-icu", id
LIMIT @max_results::int;
