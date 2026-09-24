package httpx

import (
	"context"
	"log/slog"
)

type ctxKey int

const (
	userIDKey ctxKey = iota
	requestIDKey
	loggerKey
	requestInfoKey
)

// requestInfo is a mutable per-request record read by the access-log middleware.
type requestInfo struct {
	userID int64
	err    error
}

// WithUserID returns ctx carrying the authenticated user id.
func WithUserID(ctx context.Context, id int64) context.Context {
	if info, ok := ctx.Value(requestInfoKey).(*requestInfo); ok {
		info.userID = id
	}
	return context.WithValue(ctx, userIDKey, id)
}

// UserID returns the authenticated user id, if any.
func UserID(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(userIDKey).(int64)
	return id, ok
}

// MustUserID returns the authenticated user id and panics when the request did not pass
// through the auth middleware (a routing bug; the recoverer turns it into a 500).
func MustUserID(ctx context.Context) int64 {
	id, ok := UserID(ctx)
	if !ok {
		panic("httpx: MustUserID called on an unauthenticated request")
	}
	return id
}

// RequestIDFrom returns the request id assigned by the RequestID middleware.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// Logger returns the request-scoped logger (with request_id), or slog.Default().
func Logger(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

func recordError(ctx context.Context, err error) {
	if info, ok := ctx.Value(requestInfoKey).(*requestInfo); ok {
		info.err = err
	}
}
