package service

import (
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"geneboard/internal/httpx"
)

// Frequently used client-facing errors.
var (
	errProjectNotFound = httpx.NotFound("Project not found")
	errIssueNotFound   = httpx.NotFound("Issue not found")
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// isUniqueViolation reports whether err is a PostgreSQL unique_violation (23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// invalid is a validation_error that is not tied to a single field.
func invalid(format string, args ...any) *httpx.Error {
	e := httpx.BadRequest(format, args...)
	e.Code = httpx.CodeValidation
	return e
}
