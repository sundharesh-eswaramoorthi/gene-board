package api

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"

	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// Websocket timing.
const (
	// DefaultWebsocketPingInterval is how often idle connections are pinged (SPEC §5).
	DefaultWebsocketPingInterval = 30 * time.Second
	wsPongTimeout                = 10 * time.Second
	wsWriteTimeout               = 10 * time.Second
)

// projectWebsocket serves GET /api/projects/{key}/ws?token=<jwt> (SPEC §5 "Realtime").
//
// It is mounted outside the Bearer-auth group because browsers cannot set headers on
// websocket requests; the JWT comes from ?token=. Before upgrading, the handler checks the
// Origin (403), the token (401) and viewer access to the project (404), answering with the
// usual JSON error envelope. The upgraded connection then receives every realtime.Event
// of the project as a JSON text message until the client goes away, the server shuts
// down, the subscriber falls too far behind, or a check finds that the token expired or was
// revoked (password change) or the user lost access to the project. That check runs at
// every ping and right after each project.changed event (membership changes, project
// deletion), so a removed member stops receiving events immediately. Clients reconnect and
// refetch after any close.
func (h *Handler) projectWebsocket(w http.ResponseWriter, r *http.Request) error {
	if !websocketOriginAllowed(r, h.corsOrigins) {
		return httpx.Forbidden("Origin not allowed")
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		return httpx.Unauthorized("The token query parameter is required")
	}
	uid, err := h.svc.VerifyToken(r.Context(), token)
	if err != nil {
		return err // 401 for a rejected token
	}
	ctx := httpx.WithUserID(r.Context(), uid)
	projectID, err := h.svc.RealtimeProjectID(ctx, uid, projectKey(r))
	if err != nil {
		return err
	}
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return httpx.BadRequest("Expected a websocket upgrade request")
	}
	// The Origin was verified above (websocketOriginAllowed matches CORS_ORIGINS by scheme,
	// host and port, which Accept's host-only OriginPatterns cannot express).
	conn, err := websocket.Accept(w, r.WithContext(ctx), &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		// Accept has already written an HTTP error response.
		httpx.Logger(ctx).InfoContext(ctx, "websocket handshake rejected", "err", err)
		return nil
	}
	h.streamProjectEvents(ctx, conn, token, uid, projectID)
	return nil
}

// streamProjectEvents forwards the project's realtime events to conn until it closes.
func (h *Handler) streamProjectEvents(ctx context.Context, conn *websocket.Conn, token string, userID, projectID int64) {
	hub := h.svc.Hub()
	sub := hub.Subscribe(projectID)
	defer hub.Unsubscribe(sub)
	defer func() { _ = conn.CloseNow() }() // no-op after a completed close handshake

	// Clients never send messages. CloseRead discards anything they send (closing the
	// connection on data messages), answers pings and close frames, and cancels ctx once
	// the connection is gone or the request context ends (server shutdown).
	ctx = conn.CloseRead(ctx)
	logger := httpx.Logger(ctx)
	ping := time.NewTicker(h.wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-sub.C:
			if !ok { // dropped for falling behind, or the hub closed on shutdown
				_ = conn.Close(websocket.StatusGoingAway, "subscription ended, reconnect")
				return
			}
			if err := writeEvent(ctx, conn, ev); err != nil {
				logger.DebugContext(ctx, "websocket write failed", "err", err)
				return
			}
			// Membership changes and project deletion are published as project.changed. The
			// event itself is still delivered (so the client refetches and sees it lost
			// access), then access is re-checked at once instead of at the next ping.
			if ev.Type == realtime.ProjectChanged {
				if reason := h.revokedReason(ctx, token, userID, projectID); reason != "" {
					_ = conn.Close(websocket.StatusPolicyViolation, reason)
					return
				}
			}
		case <-ping.C:
			if reason := h.revokedReason(ctx, token, userID, projectID); reason != "" {
				_ = conn.Close(websocket.StatusPolicyViolation, reason)
				return
			}
			pingCtx, cancel := context.WithTimeout(ctx, wsPongTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				logger.DebugContext(ctx, "websocket ping failed", "err", err)
				return
			}
		}
	}
}

// revokedReason re-validates a long-lived connection: it returns a close reason when the
// token has expired or the user no longer has access to the project, "" otherwise.
// Transient failures (e.g. the database being unreachable) keep the connection open.
func (h *Handler) revokedReason(ctx context.Context, token string, userID, projectID int64) string {
	if _, err := h.svc.VerifyToken(ctx, token); err != nil {
		if httpx.IsCode(err, httpx.CodeUnauthorized) {
			return "token expired or revoked"
		}
		if ctx.Err() == nil {
			httpx.Logger(ctx).WarnContext(ctx, "websocket token check failed", "err", err)
		}
		return ""
	}
	err := h.svc.CheckRealtimeAccess(ctx, userID, projectID)
	var apiErr *httpx.Error
	switch {
	case err == nil:
		return ""
	case errors.As(err, &apiErr):
		return "project access revoked"
	case ctx.Err() != nil:
		return "" // the connection is closing anyway; not worth a warning
	default:
		httpx.Logger(ctx).WarnContext(ctx, "websocket access check failed", "err", err)
		return ""
	}
}

func writeEvent(ctx context.Context, conn *websocket.Conn, ev realtime.Event) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, payload)
}

// websocketOriginAllowed guards against cross-site websocket hijacking. Browsers always
// send Origin, which must be listed in CORS_ORIGINS or be the API's own origin; a page
// served from a loopback address may also reach an API on a loopback address (local
// development through the Vite dev or preview proxy, on localhost or 127.0.0.1). Requests
// without an Origin header come from non-browser clients and are allowed.
func websocketOriginAllowed(r *http.Request, corsOrigins []string) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || httpx.OriginAllowed(corsOrigins, origin) {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	return isLoopbackHost(u.Hostname()) && isLoopbackHost(hostOnly(r.Host))
}

// hostOnly strips the port from a Host header value.
func hostOnly(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return host
	}
	return strings.Trim(hostport, "[]")
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
