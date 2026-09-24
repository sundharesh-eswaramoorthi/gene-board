package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// RequestIDHeader carries the request id in both directions.
const RequestIDHeader = "X-Request-Id"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// RequestID assigns every request an id (reusing a well-formed incoming X-Request-Id),
// echoes it in the response header and stores it in the context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if !validRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// RequestLogger logs one line per request (method, path, status, size, duration, user,
// request id and — for 500s — the underlying error) and makes a request-scoped logger
// available through Logger(ctx). Place it after RequestID.
func RequestLogger(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			logger := base.With("request_id", RequestIDFrom(r.Context()))
			info := &requestInfo{}
			ctx := context.WithValue(r.Context(), loggerKey, logger)
			ctx = context.WithValue(ctx, requestInfoKey, info)

			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r.WithContext(ctx))

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"bytes", ww.BytesWritten(),
				"duration", time.Since(start).Round(time.Microsecond),
			}
			if info.userID != 0 {
				attrs = append(attrs, "user_id", info.userID)
			}
			if info.err != nil {
				attrs = append(attrs, "err", info.err)
			}
			level := slog.LevelInfo
			if status >= http.StatusInternalServerError {
				level = slog.LevelError
			}
			logger.Log(r.Context(), level, "http request", attrs...)
		})
	}
}

// Recoverer turns panics into a logged 500 error envelope. http.ErrAbortHandler is
// re-panicked so net/http can abort the connection as intended.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			if rec == http.ErrAbortHandler { // compared by identity, as net/http does
				panic(rec)
			}
			Logger(r.Context()).ErrorContext(r.Context(), "panic recovered", "panic", rec, "stack", string(debug.Stack()))
			recordError(r.Context(), panicError{rec})
			if ww, ok := w.(middleware.WrapResponseWriter); ok && ww.Status() != 0 {
				return // headers already sent; nothing sensible left to write
			}
			_ = WriteJSON(w, http.StatusInternalServerError, errorEnvelope{Error: errorBody{Code: CodeInternal, Message: "Internal server error"}})
		}()
		next.ServeHTTP(w, r)
	})
}

type panicError struct{ v any }

func (p panicError) Error() string { return fmt.Sprintf("panic: %v", p.v) }

// CORS allows cross-origin requests from the configured origins ("*" allows any). Allowed
// preflight requests are answered directly with 204.
func CORS(origins []string) func(http.Handler) http.Handler {
	allowAll := slices.Contains(origins, "*")
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		allowed[strings.TrimRight(o, "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Add("Vary", "Origin")
			preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
			if allowAll || allowed[origin] {
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Expose-Headers", RequestIDHeader)
				if preflight {
					h.Add("Vary", "Access-Control-Request-Method")
					h.Add("Vary", "Access-Control-Request-Headers")
					h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
					h.Set("Access-Control-Max-Age", "600")
				}
			}
			if preflight {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// OriginAllowed reports whether origin is in the CORS allow-list (for websocket origin checks).
func OriginAllowed(origins []string, origin string) bool {
	origin = strings.TrimRight(origin, "/")
	for _, o := range origins {
		if o == "*" || strings.TrimRight(o, "/") == origin {
			return true
		}
	}
	return false
}

// Deadlines bounds how long a client may take to send its request (read) and to receive
// the response (write). The HTTP server sets no ReadTimeout/WriteTimeout because those also
// apply to hijacked websocket connections, so without this a client trickling its body or
// never reading a large response would hold a connection, a goroutine and the response
// buffer indefinitely. exempt requests (the websocket upgrade) get their deadlines cleared
// instead, so a stale deadline from an earlier request on the same keep-alive connection
// cannot cut them.
func Deadlines(read, write time.Duration, exempt func(*http.Request) bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var readBy, writeBy time.Time // zero = no deadline
			if !exempt(r) {
				now := time.Now()
				readBy, writeBy = now.Add(read), now.Add(write)
			}
			// ErrNotSupported (e.g. httptest's recorder) just means there is nothing to bound.
			rc := http.NewResponseController(w)
			_ = rc.SetReadDeadline(readBy)
			_ = rc.SetWriteDeadline(writeBy)
			next.ServeHTTP(w, r)
		})
	}
}

// RejectInvalidText answers 400 bad_request for requests whose path or query string holds
// text PostgreSQL cannot store or compare (NUL characters or invalid UTF-8, e.g. ?q=%00 or
// %FF), and for malformed query strings (a bad escape such as %ZZ, or a ';' separator):
// r.URL.Query() silently drops such a parameter, which would widen a search instead of
// failing it. Request bodies are validated field by field by the service layer.
func RejectInvalidText(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ValidText(r.URL.Path) {
			WriteError(w, r, BadRequest("Invalid characters in the request path"))
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			WriteError(w, r, BadRequest("Malformed query string"))
			return
		}
		for name, values := range query {
			if !ValidText(name) {
				WriteError(w, r, BadRequest("Invalid characters in the query string"))
				return
			}
			for _, v := range values {
				if !ValidText(v) {
					WriteError(w, r, BadRequest("Invalid value for query parameter %q", name))
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// TokenVerifier validates an access token and returns the user id it was issued for. A
// rejected token is reported as an *Error; any other error means the check itself failed
// (e.g. the database is unreachable).
type TokenVerifier func(ctx context.Context, token string) (int64, error)

// RequireAuth rejects requests without a valid "Authorization: Bearer <jwt>" header with a
// 401 envelope and stores the user id in the context for the rest. A failing check (not a
// rejected token) is a 500, so a database hiccup does not sign clients out.
func RequireAuth(verify TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := BearerToken(r)
			if !ok {
				WriteError(w, r, Unauthorized("Authentication required"))
				return
			}
			userID, err := verify(r.Context(), token)
			if err != nil {
				var rejected *Error
				if errors.As(err, &rejected) {
					err = Unauthorized("Invalid or expired token")
				}
				WriteError(w, r, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), userID)))
		})
	}
}

// BearerToken extracts the token from an "Authorization: Bearer <token>" header.
func BearerToken(r *http.Request) (string, bool) {
	scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != ""
}
