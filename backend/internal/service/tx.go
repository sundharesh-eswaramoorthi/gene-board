package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"geneboard/internal/db"
	"geneboard/internal/realtime"
)

// txn is one unit of work: sqlc queries bound to a database transaction plus the realtime
// events to publish once the transaction has committed.
type txn struct {
	q      *db.Queries
	tx     pgx.Tx
	events []queuedEvent
	nowTS  *time.Time // transaction timestamp, loaded lazily by now
}

type queuedEvent struct {
	projectID int64
	event     realtime.Event
}

// inTx runs fn inside a transaction. If fn returns an error the transaction is rolled back
// and no events are published; otherwise it is committed and the queued events are
// published to the hub.
func (s *Service) inTx(ctx context.Context, fn func(t *txn) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	// Rollback is a no-op once Commit succeeded.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	t := &txn{q: s.q.WithTx(tx), tx: tx}
	if err := fn(t); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	for _, e := range t.events {
		s.hub.Publish(e.projectID, e.event)
	}
	return nil
}

// inReadTx runs fn in a read-only REPEATABLE READ transaction, so reads spanning several
// queries (board, backlog, epics) see one consistent snapshot even while other requests
// move issues or close sprints.
func (s *Service) inReadTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("begin read transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit read transaction: %w", err)
	}
	return nil
}

// now returns the transaction timestamp (PostgreSQL now()), the same instant the database
// writes into created_at / updated_at columns during this transaction. Timestamps computed
// in Go (such as resolved_at) use it so that all times come from one clock.
func (t *txn) now(ctx context.Context) (time.Time, error) {
	if t.nowTS == nil {
		var ts time.Time
		if err := t.tx.QueryRow(ctx, "SELECT now()").Scan(&ts); err != nil {
			return time.Time{}, fmt.Errorf("read transaction time: %w", err)
		}
		t.nowTS = &ts
	}
	return *t.nowTS, nil
}

// publish queues a realtime event for the project; it is sent after commit. An empty
// issueKey is sent as null.
func (t *txn) publish(projectID int64, eventType, projectKey, issueKey string, actorID int64) {
	ev := realtime.Event{Type: eventType, ProjectKey: projectKey, ActorID: actorID}
	if issueKey != "" {
		ev.IssueKey = &issueKey
	}
	t.events = append(t.events, queuedEvent{projectID: projectID, event: ev})
}
