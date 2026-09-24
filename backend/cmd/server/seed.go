package main

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"geneboard/internal/seed"
	"geneboard/internal/service"
)

// runSeed is the `server seed` command (SPEC §6): it loads the demo data through the fully
// wired service after migrations have run. It does nothing when the demo user exists.
func runSeed(ctx context.Context, svc *service.Service, pool *pgxpool.Pool, logger *slog.Logger) error {
	return seed.Run(ctx, svc, pool, logger)
}
