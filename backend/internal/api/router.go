// Package api is the HTTP layer: a chi router mounting every endpoint of SPEC §5 and thin
// handlers that decode requests, call the service layer and encode dto values.
//
// Handler conventions: a handler has the signature
//
//	func (h *Handler) name(w http.ResponseWriter, r *http.Request) error
//
// and is mounted through httpx.Handle, which renders a returned error as the standard error
// envelope. Handlers never contain domain logic; they parse path/query parameters, decode
// JSON bodies into service input structs and pick the success status (201 for creates,
// 204 for deletes, 200 otherwise).
package api

import (
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// Deps are the router's dependencies.
type Deps struct {
	Service     *service.Service
	Logger      *slog.Logger
	CORSOrigins []string
	// WebsocketPingInterval overrides DefaultWebsocketPingInterval (tests use a short one).
	WebsocketPingInterval time.Duration
	// AuthRateLimit is how many POST /auth/login and /auth/register requests (and password
	// changes) one client address may make per minute (see authThrottle). 0 turns
	// throttling off (tests).
	AuthRateLimit int
	// TrustedProxies are the peers whose X-Real-IP / X-Forwarded-For headers name the real
	// client for that throttling (the reverse proxies in front of the API; see clientAddr).
	// Nil trusts no peer.
	TrustedProxies []netip.Prefix
	// RequestReadTimeout and ResponseWriteTimeout bound sending the request and receiving
	// the response on every route except the websocket (0 = the defaults below).
	RequestReadTimeout   time.Duration
	ResponseWriteTimeout time.Duration
}

// Default per-request deadlines (see httpx.Deadlines). Bodies are at most 1 MB.
const (
	DefaultRequestReadTimeout   = 30 * time.Second
	DefaultResponseWriteTimeout = 60 * time.Second
)

// Handler holds what the HTTP handlers need.
type Handler struct {
	svc            *service.Service
	logger         *slog.Logger
	corsOrigins    []string // also used for the websocket origin check
	wsPingInterval time.Duration
	throttle       *authThrottle // nil = auth endpoints are not throttled
}

// NewRouter builds the complete HTTP handler.
func NewRouter(d Deps) http.Handler {
	logger := d.Logger
	if logger == nil {
		logger = slog.Default()
	}
	ping := d.WebsocketPingInterval
	if ping <= 0 {
		ping = DefaultWebsocketPingInterval
	}
	readTimeout, writeTimeout := d.RequestReadTimeout, d.ResponseWriteTimeout
	if readTimeout <= 0 {
		readTimeout = DefaultRequestReadTimeout
	}
	if writeTimeout <= 0 {
		writeTimeout = DefaultResponseWriteTimeout
	}
	h := &Handler{
		svc: d.Service, logger: logger, corsOrigins: d.CORSOrigins, wsPingInterval: ping,
		throttle: newAuthThrottle(d.AuthRateLimit, d.TrustedProxies),
	}
	handle := httpx.Handle

	r := chi.NewRouter()
	r.Use(
		httpx.RequestID,
		httpx.RequestLogger(logger),
		httpx.Recoverer,
		httpx.Deadlines(readTimeout, writeTimeout, isProjectWebsocket),
		httpx.RejectInvalidText,
		httpx.CORS(d.CORSOrigins),
	)
	r.NotFound(handle(func(http.ResponseWriter, *http.Request) error {
		return httpx.NotFound("Route not found")
	}))
	r.MethodNotAllowed(handle(func(http.ResponseWriter, *http.Request) error {
		return &httpx.Error{Status: http.StatusMethodNotAllowed, Code: httpx.CodeMethodNotAllowed, Message: "Method not allowed"}
	}))

	r.Route("/api", func(r chi.Router) {
		// Public endpoints.
		r.Get("/health", handle(h.health))
		r.Post("/auth/register", handle(h.register))
		r.Post("/auth/login", handle(h.login))
		// The websocket authenticates with ?token= (browsers cannot set headers on it).
		r.Get("/projects/{key}/ws", handle(h.projectWebsocket))

		r.Group(func(r chi.Router) {
			r.Use(httpx.RequireAuth(d.Service.VerifyToken))

			r.Get("/auth/me", handle(h.me))
			r.Patch("/auth/me", handle(h.updateMe))
			r.Get("/users", handle(h.searchUsers))

			r.Get("/projects", handle(h.listProjects))
			r.Post("/projects", handle(h.createProject))
			r.Route("/projects/{key}", func(r chi.Router) {
				r.Get("/", handle(h.getProject))
				r.Patch("/", handle(h.updateProject))
				r.Delete("/", handle(h.deleteProject))

				r.Get("/members", handle(h.listMembers))
				r.Post("/members", handle(h.addMember))
				r.Patch("/members/{userId}", handle(h.updateMember))
				r.Delete("/members/{userId}", handle(h.removeMember))

				r.Get("/statuses", handle(h.listStatuses))
				r.Post("/statuses", handle(h.createStatus))
				r.Put("/statuses/order", handle(h.reorderStatuses))
				r.Patch("/statuses/{id}", handle(h.updateStatus))
				r.Delete("/statuses/{id}", handle(h.deleteStatus))

				r.Get("/labels", handle(h.listLabels))
				r.Post("/labels", handle(h.createLabel))
				r.Patch("/labels/{id}", handle(h.updateLabel))
				r.Delete("/labels/{id}", handle(h.deleteLabel))

				r.Post("/issues", handle(h.createIssue))
				r.Get("/activity", handle(h.projectActivity))

				r.Get("/sprints", handle(h.listSprints))
				r.Post("/sprints", handle(h.createSprint))

				r.Get("/board", handle(h.getBoard))
				r.Get("/backlog", handle(h.getBacklog))
				r.Get("/epics", handle(h.listEpics))
			})

			r.Get("/issues", handle(h.searchIssues))
			r.Route("/issues/{issueKey}", func(r chi.Router) {
				r.Get("/", handle(h.getIssue))
				r.Patch("/", handle(h.updateIssue))
				r.Delete("/", handle(h.deleteIssue))
				r.Post("/move", handle(h.moveIssue))
				r.Get("/comments", handle(h.listComments))
				r.Post("/comments", handle(h.createComment))
				r.Post("/links", handle(h.createLink))
				r.Get("/activity", handle(h.issueActivity))
			})

			r.Patch("/comments/{id}", handle(h.updateComment))
			r.Delete("/comments/{id}", handle(h.deleteComment))
			r.Delete("/issue-links/{id}", handle(h.deleteLink))

			r.Get("/activity", handle(h.activityFeed))

			r.Get("/sprints/{id}", handle(h.getSprint))
			r.Patch("/sprints/{id}", handle(h.updateSprint))
			r.Delete("/sprints/{id}", handle(h.deleteSprint))
			r.Post("/sprints/{id}/start", handle(h.startSprint))
			r.Post("/sprints/{id}/complete", handle(h.completeSprint))
		})
	})
	return r
}

// isProjectWebsocket matches websocket handshakes for GET /api/projects/{key}/ws, the one
// long-lived route (exempt from httpx.Deadlines). Only a bodiless GET asking for the upgrade
// qualifies: any other request to that path could withhold a body with no deadline at all.
func isProjectWebsocket(r *http.Request) bool {
	if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		return false
	}
	rest, ok := strings.CutPrefix(r.URL.Path, "/api/projects/")
	key, tail, found := strings.Cut(rest, "/")
	return ok && found && key != "" && tail == "ws"
}
