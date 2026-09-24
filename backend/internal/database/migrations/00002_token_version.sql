-- Access-token revocation (SPEC §5 PATCH /auth/me). Tokens carry the user's token_version in
-- their `ver` claim and are only accepted while it still matches. Changing the password
-- increments it, which revokes every token issued before the change.

-- +goose Up
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN token_version;
