package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"geneboard/internal/realtime"
)

// TestShutdownLetsRequestsFinish: a request in progress when shutdown starts is not
// cancelled but completes within the grace period (a save must not be rolled back by a
// restart), while websocket subscriptions end as soon as shutdown starts.
func TestShutdownLetsRequestsFinish(t *testing.T) {
	hub := realtime.NewHub(0)
	sub := hub.Subscribe(1)
	started, release := make(chan struct{}), make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		if err := r.Context().Err(); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	srv, cancel := newHTTPServer(t.Context(), "", handler, hub, slog.New(slog.DiscardHandler))
	defer cancel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()

	type result struct {
		status int
		err    error
	}
	done := make(chan result, 1)
	go func() {
		res, err := http.Get("http://" + ln.Addr().String() + "/api/issues")
		if err != nil {
			done <- result{err: err}
			return
		}
		_ = res.Body.Close()
		done <- result{status: res.StatusCode}
	}()
	<-started

	shutdown := make(chan error, 1)
	go func() { shutdown <- srv.Shutdown(context.Background()) }()
	select {
	case _, ok := <-sub.C:
		if ok {
			t.Fatal("unexpected event")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the websocket subscription did not end when shutdown started")
	}
	close(release)

	if res := <-done; res.err != nil || res.status != http.StatusNoContent {
		t.Fatalf("request in progress during shutdown: %d, %v; want 204", res.status, res.err)
	}
	if err := <-shutdown; err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve: %v", err)
	}
}

// TestShutdownCancelsRequestsPastTheGracePeriod: a request still running when the grace
// period ends (e.g. stuck on a row lock) is cancelled and its connection closed, and the
// server still stops cleanly (exit 0 on SIGTERM), with a warning instead of an error.
func TestShutdownCancelsRequestsPastTheGracePeriod(t *testing.T) {
	started, cancelled := make(chan struct{}), make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	srv, cancel := newHTTPServer(t.Context(), "", handler, realtime.NewHub(0), logger)
	defer cancel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve(ln) }()

	done := make(chan struct{})
	go func() {
		defer close(done)
		if res, err := http.Get("http://" + ln.Addr().String() + "/api/issues"); err == nil {
			_ = res.Body.Close()
		}
	}()
	<-started

	if err := shutdown(srv, cancel, 50*time.Millisecond, logger); err != nil {
		t.Fatalf("shutdown: %v; want nil once the stuck request is cancelled", err)
	}
	for what, ch := range map[string]chan struct{}{"handler": cancelled, "request": done} {
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			t.Fatalf("the %s did not end after the grace period", what)
		}
	}
	if !strings.Contains(logs.String(), "level=WARN") {
		t.Fatalf("no warning logged: %q", logs.String())
	}
}
