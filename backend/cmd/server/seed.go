package main

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"geneboard/internal/seed"
	"geneboard/internal/service"
)

// runSeed is the `server seed` command (SPEC §6): it loads the demo data through the fully
// wired service after migrations have run. It does nothing when the demo user exists, and
// with ifEmpty (`seed --if-empty`) nothing when the database has any user.
func runSeed(ctx context.Context, svc *service.Service, pool *pgxpool.Pool, logger *slog.Logger, ifEmpty bool) error {
	if ifEmpty {
		return seed.RunIfEmpty(ctx, svc, pool, logger)
	}
	return seed.Run(ctx, svc, pool, logger)
}
