-- E-mail addresses are now stored and looked up in Unicode NFC (service.normalizeEmail), so
-- an address registered with a decomposed accent (NFD) is converted; its account could not
-- sign in otherwise. An address whose NFC form already belongs to another account is left
-- as it is, and of several converting to the same address only the oldest account's is
-- converted (the unique index lets no two accounts share one). normalize() needs a UTF8
-- database; with any other encoding there is nothing to convert.

-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF current_setting('server_encoding') = 'UTF8' THEN
        UPDATE users u
        SET email = normalize(u.email, NFC)
        FROM (
            SELECT DISTINCT ON (normalize(email, NFC)) id
            FROM users
            WHERE email IS NOT NFC NORMALIZED
            ORDER BY normalize(email, NFC), id
        ) pick
        WHERE u.id = pick.id
          AND NOT EXISTS (SELECT 1 FROM users o WHERE o.email = normalize(u.email, NFC));
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- Nothing to undo: the converted addresses are the ones their owners sign in with.
