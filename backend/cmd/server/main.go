// Command server runs the Gene Board API.
//
//	server [serve]       run migrations, then serve HTTP on $BIND_HOST:$PORT (default)
//	server migrate       apply database migrations and exit
//	server seed          load demo data (see internal/seed)
//	server seed --if-empty
//	                     load demo data only into a database without users (make up)
//	server healthcheck   exit 0 if the server on $BIND_HOST:$PORT answers /api/health (container probe)
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
	"slices"
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
	usage              = "usage: server [serve|migrate|seed [--if-empty]|healthcheck]"
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
	command, flags := "serve", []string(nil)
	if len(args) > 0 {
		command, flags = args[0], args[1:]
	}
	seedIfEmpty := command == "seed" && slices.Equal(flags, []string{"--if-empty"})
	if len(flags) > 0 && !seedIfEmpty {
		return fmt.Errorf("unexpected arguments %q (%s)", flags, usage)
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
		logger.Warn("JWT_SECRET is not set; using the insecure development default (accepted only while BIND_HOST is a loopback address)")
	}
	if cfg.AuthRateLimit == 0 {
		logger.Warn("AUTH_RATE_LIMIT=0: sign-in, registration and password changes are not throttled")
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
		return runSeed(ctx, svc, pool, logger, seedIfEmpty)
	}
	return serve(ctx, cfg, svc, hub, logger)
}

// serve runs the HTTP server until ctx is cancelled, then shuts down gracefully.
func serve(ctx context.Context, cfg config.Config, svc *service.Service, hub *realtime.Hub, logger *slog.Logger) error {
	handler := api.NewRouter(api.Deps{
		Service: svc, Logger: logger, CORSOrigins: cfg.CORSOrigins,
		AuthRateLimit: cfg.AuthRateLimit, TrustedProxies: cfg.TrustedProxies,
	})
	if cfg.UsingDefaultJWTSecret() { // only on loopback (config.Load): refuse DNS rebinding too
		handler = loopbackHostsOnly(handler)
	}
	srv, cancelRequests := newHTTPServer(ctx, cfg.Addr(), handler, hub, logger)
	defer cancelRequests()

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
	if err := shutdown(srv, cancelRequests, shutdownTimeout, logger); err != nil {
		return err
	}
	logger.Info("server stopped")
	return nil
}

// shutdown stops srv: it stops accepting connections and waits up to timeout for the
// requests in progress. Requests still running then (e.g. waiting on a row lock) are
// cancelled through cancelRequests and their connections closed. That is logged, not
// returned: an ordinary SIGTERM still exits cleanly.
func shutdown(srv *http.Server, cancelRequests context.CancelFunc, timeout time.Duration, logger *slog.Logger) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	err := srv.Shutdown(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		logger.Warn("requests still running after the shutdown grace period; cancelling them", "grace_period", timeout)
		cancelRequests()
		_ = srv.Close() // Shutdown closed the listeners already; this closes the connections
		return nil
	}
	if err != nil {
		return fmt.Errorf("http shutdown: %w", err)
	}
	return nil
}

// newHTTPServer builds the API's server. Requests run under a context that the shutdown
// signal does not cancel, so srv.Shutdown lets those in progress finish (within
// shutdownTimeout, see shutdown). Shutdown neither waits for nor cancels websockets
// (hijacked connections): closing the hub when it starts ends their subscriptions. cancel
// cancels whatever still runs; call it once Shutdown has returned.
func newHTTPServer(ctx context.Context, addr string, handler http.Handler, hub *realtime.Hub, logger *slog.Logger) (srv *http.Server, cancel context.CancelFunc) {
	baseCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	srv = &http.Server{
		Addr:    addr,
		Handler: handler,
		// No ReadTimeout/WriteTimeout: they would also cut hijacked websocket connections.
		// The router bounds every other request itself (httpx.Deadlines); request bodies
		// are capped at 1 MB by httpx.DecodeJSON.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	srv.RegisterOnShutdown(hub.Close) // closes every websocket subscription
	return srv, cancel
}

// healthcheck probes GET /api/health of the server listening on cfg.Addr(). The runtime
// container image has no shell or curl, so its HEALTHCHECK runs `server healthcheck`.
func healthcheck(ctx context.Context, cfg config.Config) error {
	ctx, cancel := context.WithTimeout(ctx, healthcheckTimeout)
	defer cancel()
	url := "http://" + cfg.LocalAddr() + "/api/health"
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
