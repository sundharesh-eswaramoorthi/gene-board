-- Users. Emails are always stored lower-cased (the service normalises input).

-- name: CreateUser :one
INSERT INTO users (email, name, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- UpdateUser writes the name and password hash. revoke_tokens increments token_version,
-- which invalidates every access token issued before (used when the password changes).
-- name: UpdateUser :one
UPDATE users
SET name          = @name,
    password_hash = @password_hash,
    token_version = token_version + CASE WHEN @revoke_tokens::bool THEN 1 ELSE 0 END,
    updated_at    = now()
WHERE id = @id
RETURNING *;

-- GetUserTokenVersion returns the token version access tokens of the user must carry.
-- name: GetUserTokenVersion :one
SELECT token_version FROM users WHERE id = $1;

-- name: ListUsersByIDs :many
SELECT * FROM users WHERE id = ANY(@ids::bigint[]);

-- SearchUsers matches name or e-mail case-insensitively. `pattern` must already have
-- LIKE wildcards escaped; an empty pattern returns the first users by name.
-- name: SearchUsers :many
SELECT * FROM users
WHERE @pattern::text = ''
   OR name ILIKE '%' || @pattern::text || '%'
   OR email ILIKE '%' || @pattern::text || '%'
ORDER BY lower(name), id
LIMIT @max_results::int;
