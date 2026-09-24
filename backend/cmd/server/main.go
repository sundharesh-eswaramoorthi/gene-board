// Command server runs the Gene Board API.
//
//	server [serve]       run migrations, then serve HTTP on $PORT (default)
//	server migrate       apply database migrations and exit
//	server seed          load demo data (see internal/seed)
//	server healthcheck   exit 0 if the server on $PORT answers /api/health (container probe)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"geneboard/internal/api"
	"geneboard/internal/auth"
	"geneboard/internal/config"
	"geneboard/internal/database"
	"geneboard/internal/realtime"
	"geneboard/internal/service"
)

const (
	shutdownTimeout    = 15 * time.Second
	healthcheckTimeout = 3 * time.Second
	usage              = "usage: server [serve|migrate|seed|healthcheck]"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], logger); err != nil {
		logger.Error("fatal", "err", err)
		stop()
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) error {
	command := "serve"
	if len(args) > 0 {
		command = args[0]
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	switch command {
	case "serve", "migrate", "seed":
	case "healthcheck":
		return healthcheck(ctx, cfg)
	case "help", "-h", "--help":
		fmt.Println(usage)
		return nil
	default:
		return fmt.Errorf("unknown command %q (%s)", command, usage)
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := database.Migrate(ctx, pool, logger); err != nil {
		return err
	}
	if command == "migrate" {
		return nil
	}

	switch {
	case cfg.JWTSecretGenerated:
		logger.Warn("JWT_SECRET is not set; using a random secret for this run, so sign-ins end when the server restarts (set JWT_SECRET, 32+ characters, to keep them)")
	case cfg.UsingDefaultJWTSecret():
		logger.Warn("JWT_SECRET is not set; using the insecure development default")
	}
	if cfg.AuthRateLimit == 0 {
		logger.Warn("AUTH_RATE_LIMIT=0: sign-in and registration are not throttled")
	}
	hub := realtime.NewHub(realtime.DefaultBuffer)
	svc := service.New(service.Options{
		Pool:   pool,
		Hub:    hub,
		Tokens: auth.NewTokens(cfg.JWTSecret, cfg.JWTTTL),
		Hasher: auth.NewPasswordHasher(auth.DefaultBcryptCost),
		Logger: logger,
	})

	if command == "seed" {
		return runSeed(ctx, svc, pool, logger)
	}
	return serve(ctx, cfg, svc, hub, logger)
}

// serve runs the HTTP server until ctx is cancelled, then shuts down gracefully.
func serve(ctx context.Context, cfg config.Config, svc *service.Service, hub *realtime.Hub, logger *slog.Logger) error {
	// Long-lived requests (websockets) derive from baseCtx, cancelled when shutdown starts.
	baseCtx, cancelBase := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelBase()

	srv := &http.Server{
		Addr: cfg.Addr(),
		Handler: api.NewRouter(api.Deps{
			Service: svc, Logger: logger, CORSOrigins: cfg.CORSOrigins, AuthRateLimit: cfg.AuthRateLimit,
		}),
		// No ReadTimeout/WriteTimeout: they would also cut hijacked websocket connections.
		// The router bounds every other request itself (httpx.Deadlines); request bodies
		// are capped at 1 MB by httpx.DecodeJSON.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	srv.RegisterOnShutdown(func() {
		cancelBase()
		hub.Close() // closes every websocket subscription
	})

	errCh := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "addr", srv.Addr, "cors_origins", cfg.CORSOrigins)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http shutdown: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

// healthcheck probes GET /api/health of the server listening on cfg.Port. The runtime
// container image has no shell or curl, so its HEALTHCHECK runs `server healthcheck`.
func healthcheck(ctx context.Context, cfg config.Config) error {
	ctx, cancel := context.WithTimeout(ctx, healthcheckTimeout)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d/api/health", cfg.Port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: %s answered %s", url, res.Status)
	}
	return nil
}
