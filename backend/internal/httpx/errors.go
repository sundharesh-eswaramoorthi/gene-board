package httpx

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
)

// Error codes of the error envelope (SPEC §3).
const (
	CodeBadRequest       = "bad_request"
	CodeValidation       = "validation_error"
	CodeUnauthorized     = "unauthorized"
	CodeForbidden        = "forbidden"
	CodeNotFound         = "not_found"
	CodeConflict         = "conflict"
	CodeInternal         = "internal"
	CodeMethodNotAllowed = "method_not_allowed"
	CodeRateLimited      = "rate_limited"
)

// Error is a client-facing error. Services return it; handlers render it as
//
//	{ "error": { "code": ..., "message": ..., "fields": {...} } }
//
// Any other error type is rendered as a 500 "internal" error and logged.
type Error struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
}

func (e *Error) Error() string {
	if len(e.Fields) == 0 {
		return fmt.Sprintf("%s (%d): %s", e.Code, e.Status, e.Message)
	}
	return fmt.Sprintf("%s (%d): %s %v", e.Code, e.Status, e.Message, e.Fields)
}

// BadRequest is a 400 for malformed requests (bad JSON, bad query/path parameters).
func BadRequest(format string, args ...any) *Error {
	return &Error{Status: http.StatusBadRequest, Code: CodeBadRequest, Message: fmt.Sprintf(format, args...)}
}

// Validation is a 400 validation_error for a single field. The message is derived from the
// field name, e.g. Validation("summary", "is required") -> "Summary is required".
func Validation(field, problem string) *Error {
	var fe FieldErrors
	fe.Add(field, problem)
	return fe.Err().(*Error)
}

// Unauthorized is a 401.
func Unauthorized(format string, args ...any) *Error {
	return &Error{Status: http.StatusUnauthorized, Code: CodeUnauthorized, Message: fmt.Sprintf(format, args...)}
}

// Forbidden is a 403.
func Forbidden(format string, args ...any) *Error {
	return &Error{Status: http.StatusForbidden, Code: CodeForbidden, Message: fmt.Sprintf(format, args...)}
}

// NotFound is a 404.
func NotFound(format string, args ...any) *Error {
	return &Error{Status: http.StatusNotFound, Code: CodeNotFound, Message: fmt.Sprintf(format, args...)}
}

// Conflict is a 409.
func Conflict(format string, args ...any) *Error {
	return &Error{Status: http.StatusConflict, Code: CodeConflict, Message: fmt.Sprintf(format, args...)}
}

// TooManyRequests is a 429 rate_limited error; retryAfter is shown to the user (the
// handler also sends it in a Retry-After header).
func TooManyRequests(message string, retryAfter time.Duration) *Error {
	wait := "a moment"
	switch secs := int(math.Ceil(retryAfter.Seconds())); {
	case secs > 90:
		wait = fmt.Sprintf("%d minutes", (secs+59)/60)
	case secs > 1:
		wait = fmt.Sprintf("%d seconds", secs)
	}
	return &Error{Status: http.StatusTooManyRequests, Code: CodeRateLimited, Message: message + " Try again in " + wait + "."}
}

// IsCode reports whether err is an *Error with the given code.
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

// FieldErrors accumulates per-field validation problems. The zero value is ready to use.
// Only the first problem reported for a field is kept.
type FieldErrors struct {
	order  []string
	fields map[string]string
}

// Add records a problem for field ("is required", "must be at most 80 characters", ...).
func (f *FieldErrors) Add(field, problem string) {
	if f.fields == nil {
		f.fields = make(map[string]string)
	}
	if _, exists := f.fields[field]; exists {
		return
	}
	f.order = append(f.order, field)
	f.fields[field] = problem
}

// Check records problem for field when ok is false.
func (f *FieldErrors) Check(ok bool, field, problem string) {
	if !ok {
		f.Add(field, problem)
	}
}

// Has reports whether field already has a problem.
func (f *FieldErrors) Has(field string) bool {
	_, ok := f.fields[field]
	return ok
}

// Empty reports whether no problems were recorded.
func (f *FieldErrors) Empty() bool { return len(f.order) == 0 }

// Err returns nil when there are no problems, otherwise a validation_error whose message
// describes the first problem.
func (f *FieldErrors) Err() error {
	if f.Empty() {
		return nil
	}
	first := f.order[0]
	fields := make(map[string]string, len(f.fields))
	for k, v := range f.fields {
		fields[k] = v
	}
	return &Error{
		Status:  http.StatusBadRequest,
		Code:    CodeValidation,
		Message: HumanizeField(first) + " " + f.fields[first],
		Fields:  fields,
	}
}

// HumanizeField turns a JSON field name into a sentence prefix: "storyPoints" ->
// "Story points", "parentId" -> "Parent", "labelIds" -> "Labels", "statusIds" -> "Statuses".
func HumanizeField(field string) string {
	switch {
	case strings.HasSuffix(field, "Ids") && len(field) > 3:
		base := field[:len(field)-3]
		if strings.HasSuffix(base, "s") {
			return HumanizeField(base + "es")
		}
		return HumanizeField(base + "s")
	case strings.HasSuffix(field, "Id") && len(field) > 2:
		field = field[:len(field)-2]
	}
	var b strings.Builder
	for i, r := range field {
		switch {
		case i == 0:
			b.WriteRune(unicode.ToUpper(r))
		case unicode.IsUpper(r):
			b.WriteByte(' ')
			b.WriteRune(unicode.ToLower(r))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// clientErrorForDB maps the database errors that stem from the request or from a race with
// another request, not from a server fault, to client errors. These are backstops: the
// service validates input and locks referenced rows so that they should not occur.
func clientErrorForDB(err error) *Error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	switch pgErr.Code {
	case "22021": // character_not_in_repertoire: NUL or invalid UTF-8 in a text value
		return BadRequest("Text must not contain NUL characters")
	case "23503": // foreign_key_violation: a referenced row was deleted concurrently
		return Conflict("Something this request refers to was just changed or deleted. Reload and try again.")
	case "40P01", "40001": // deadlock_detected, serialization_failure
		return Conflict("The request collided with a concurrent change. Try again.")
	}
	return nil
}

// ValidText reports whether s can be stored in and compared by PostgreSQL: valid UTF-8
// without NUL characters. JSON bodies can carry NUL ("\u0000"); query strings and paths
// can also carry invalid UTF-8 (%FF). The database rejects both with SQLSTATE 22021.
func ValidText(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
