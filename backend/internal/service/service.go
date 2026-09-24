// Package service holds Gene Board's domain logic, independent of HTTP: permission checks,
// validation, transactions, activity logging and realtime notifications.
//
// Conventions (read before adding a feature):
//
//   - Every exported method takes the acting user's id and returns dto values or an error.
//     Client-facing failures are *httpx.Error values (validation_error, not_found, ...);
//     anything else is treated as an internal error by the HTTP layer.
//   - Permissions: resolve the project/issue with projectByKey / projectByID / issueByKey /
//     issueByID and a minimum Role. Non-members get 404, insufficient roles get 403.
//   - Mutations run inside s.inTx. Activity rows are written in the same transaction via
//     txn.logActivity, and realtime events are queued with txn.publish; the queue is
//     flushed to the hub only after a successful commit.
//   - Issue rows are turned into dto.Issue values exclusively through hydrateIssues (or its
//     wrappers hydrateIssue / issueDetail), which uses a constant number of queries.
package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"

	"geneboard/internal/auth"
	"geneboard/internal/db"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// Options configures a Service.
type Options struct {
	Pool   *pgxpool.Pool
	Hub    *realtime.Hub
	Tokens *auth.Tokens
	Hasher auth.PasswordHasher
	Logger *slog.Logger
}

// Service implements all Gene Board use cases.
type Service struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	hub    *realtime.Hub
	tokens *auth.Tokens
	hasher auth.PasswordHasher
	logger *slog.Logger

	dummyOnce sync.Once // guards dummy
	dummy     string    // see dummyHash
}

// New creates a Service.
func New(o Options) *Service {
	logger := o.Logger
	if logger == nil {
		logger = slog.Default()
	}
	hub := o.Hub
	if hub == nil {
		hub = realtime.NewHub(0)
	}
	return &Service{
		pool:   o.Pool,
		q:      db.New(o.Pool),
		hub:    hub,
		tokens: o.Tokens,
		hasher: o.Hasher,
		logger: logger,
	}
}

// errInvalidToken answers any access token that is malformed, forged, expired or revoked.
var errInvalidToken = httpx.Unauthorized("Invalid or expired token")

// VerifyToken validates an access token and returns its user id (used by the HTTP auth
// middleware and the websocket handshake and re-checks). Besides the signature and expiry
// it checks, against the database, that the token has not been revoked: its version must
// still be the user's token_version, which a password change increments. Rejected tokens
// give a 401 *httpx.Error; any other error is a database failure.
func (s *Service) VerifyToken(ctx context.Context, token string) (int64, error) {
	userID, version, err := s.tokens.Verify(token)
	if err != nil {
		return 0, errInvalidToken
	}
	current, err := s.q.GetUserTokenVersion(ctx, userID)
	if isNoRows(err) { // account deleted
		return 0, errInvalidToken
	}
	if err != nil {
		return 0, fmt.Errorf("load token version: %w", err)
	}
	if version != current {
		return 0, errInvalidToken
	}
	return userID, nil
}

// Hub returns the realtime hub events are published to.
func (s *Service) Hub() *realtime.Hub { return s.hub }
