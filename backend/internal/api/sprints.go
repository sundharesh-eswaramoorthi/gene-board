package api

import (
	"net/http"

	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// Sprint endpoints (SPEC §5 "Sprints").
//
//	GET    /api/projects/{key}/sprints?state=planned,active  -> listSprints
//	POST   /api/projects/{key}/sprints                       -> createSprint   (201)
//	GET    /api/sprints/{id}                                 -> getSprint
//	PATCH  /api/sprints/{id}                                 -> updateSprint
//	DELETE /api/sprints/{id}                                 -> deleteSprint   (204)
//	POST   /api/sprints/{id}/start                           -> startSprint
//	POST   /api/sprints/{id}/complete                        -> completeSprint

func (h *Handler) listSprints(w http.ResponseWriter, r *http.Request) error {
	states, err := service.ParseSprintStates(r.URL.Query())
	if err != nil {
		return err
	}
	sprints, err := h.svc.ListSprints(r.Context(), userID(r), projectKey(r), states)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, sprints)
}

func (h *Handler) createSprint(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateSprintInput
	if err := httpx.DecodeOptionalJSON(w, r, &in); err != nil { // every field is optional
		return err
	}
	sprint, err := h.svc.CreateSprint(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, sprint)
}

func (h *Handler) getSprint(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	sprint, err := h.svc.GetSprint(r.Context(), userID(r), id)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, sprint)
}

func (h *Handler) updateSprint(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.UpdateSprintInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	sprint, err := h.svc.UpdateSprint(r.Context(), userID(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, sprint)
}

func (h *Handler) deleteSprint(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSprint(r.Context(), userID(r), id); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

func (h *Handler) startSprint(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.StartSprintInput
	if err := httpx.DecodeOptionalJSON(w, r, &in); err != nil { // dates may already be stored
		return err
	}
	sprint, err := h.svc.StartSprint(r.Context(), userID(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, sprint)
}

func (h *Handler) completeSprint(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.CompleteSprintInput
	if err := httpx.DecodeOptionalJSON(w, r, &in); err != nil { // empty body = target backlog
		return err
	}
	result, err := h.svc.CompleteSprint(r.Context(), userID(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}
