package api

import (
	"net/http"

	"geneboard/internal/httpx"
)

// Board, backlog and epics endpoints (SPEC §5 "Board, backlog, epics").
//
//	GET /api/projects/{key}/board    -> getBoard    { project, statuses, sprint, issues }
//	GET /api/projects/{key}/backlog  -> getBacklog  { sprints: [{ sprint, issues }], backlog }
//	GET /api/projects/{key}/epics    -> listEpics   EpicProgress[]

func (h *Handler) getBoard(w http.ResponseWriter, r *http.Request) error {
	board, err := h.svc.Board(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, board)
}

func (h *Handler) getBacklog(w http.ResponseWriter, r *http.Request) error {
	backlog, err := h.svc.Backlog(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, backlog)
}

func (h *Handler) listEpics(w http.ResponseWriter, r *http.Request) error {
	epics, err := h.svc.Epics(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, epics)
}
