package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// projectKey returns the {key} path parameter (the service normalises case).
func projectKey(r *http.Request) string { return chi.URLParam(r, "key") }

func (h *Handler) listProjects(w http.ResponseWriter, r *http.Request) error {
	projects, err := h.svc.ListProjects(r.Context(), userID(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, projects)
}

func (h *Handler) createProject(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateProjectInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	project, err := h.svc.CreateProject(r.Context(), userID(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, project)
}

func (h *Handler) getProject(w http.ResponseWriter, r *http.Request) error {
	project, err := h.svc.GetProject(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, project)
}

func (h *Handler) updateProject(w http.ResponseWriter, r *http.Request) error {
	var in service.UpdateProjectInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	project, err := h.svc.UpdateProject(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, project)
}

func (h *Handler) deleteProject(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.DeleteProject(r.Context(), userID(r), projectKey(r)); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

// --- members ---

func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) error {
	members, err := h.svc.ListMembers(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, members)
}

func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) error {
	var in service.AddMemberInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	member, err := h.svc.AddMember(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, member)
}

func (h *Handler) updateMember(w http.ResponseWriter, r *http.Request) error {
	memberID, err := pathID(r, "userId")
	if err != nil {
		return err
	}
	var in service.UpdateMemberInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	member, err := h.svc.UpdateMember(r.Context(), userID(r), projectKey(r), memberID, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, member)
}

func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) error {
	memberID, err := pathID(r, "userId")
	if err != nil {
		return err
	}
	if err := h.svc.RemoveMember(r.Context(), userID(r), projectKey(r), memberID); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

// --- statuses ---

func (h *Handler) listStatuses(w http.ResponseWriter, r *http.Request) error {
	statuses, err := h.svc.ListStatuses(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, statuses)
}

func (h *Handler) createStatus(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateStatusInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	status, err := h.svc.CreateStatus(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, status)
}

func (h *Handler) updateStatus(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.UpdateStatusInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	status, err := h.svc.UpdateStatus(r.Context(), userID(r), projectKey(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) reorderStatuses(w http.ResponseWriter, r *http.Request) error {
	var in service.ReorderStatusesInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	statuses, err := h.svc.ReorderStatuses(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, statuses)
}

func (h *Handler) deleteStatus(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	moveTo, err := optionalQueryID(r, "moveTo")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteStatus(r.Context(), userID(r), projectKey(r), id, moveTo); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

// --- labels ---

func (h *Handler) listLabels(w http.ResponseWriter, r *http.Request) error {
	labels, err := h.svc.ListLabels(r.Context(), userID(r), projectKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, labels)
}

func (h *Handler) createLabel(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateLabelInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	label, err := h.svc.CreateLabel(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, label)
}

func (h *Handler) updateLabel(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.UpdateLabelInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	label, err := h.svc.UpdateLabel(r.Context(), userID(r), projectKey(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, label)
}

func (h *Handler) deleteLabel(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteLabel(r.Context(), userID(r), projectKey(r), id); err != nil {
		return err
	}
	return httpx.NoContent(w)
}
