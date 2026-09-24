package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"geneboard/internal/httpx"
)

// userID returns the authenticated caller (routes behind RequireAuth only).
func userID(r *http.Request) int64 { return httpx.MustUserID(r.Context()) }

// pathID parses a positive integer path parameter.
func pathID(r *http.Request, name string) (int64, error) {
	raw := chi.URLParam(r, name)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, httpx.BadRequest("Invalid %s %q in path", name, raw)
	}
	return id, nil
}

// queryInt parses an optional non-negative integer query parameter; minValue is the smallest
// accepted value (e.g. 1 for limits).
func queryInt(r *http.Request, name string, def, minValue int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < minValue {
		return 0, httpx.BadRequest("Invalid value for query parameter %q", name)
	}
	return n, nil
}

// optionalQueryID parses an optional positive id query parameter.
func optionalQueryID(r *http.Request, name string) (*int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return nil, nil
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return nil, httpx.BadRequest("Invalid value for query parameter %q", name)
	}
	return &id, nil
}
