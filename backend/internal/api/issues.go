package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// issueKey returns the {issueKey} path parameter (the service normalises case).
func issueKey(r *http.Request) string { return chi.URLParam(r, "issueKey") }

func (h *Handler) searchIssues(w http.ResponseWriter, r *http.Request) error {
	search, err := service.ParseIssueSearch(r.URL.Query())
	if err != nil {
		return err
	}
	page, err := h.svc.SearchIssues(r.Context(), userID(r), search)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) createIssue(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateIssueInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	issue, err := h.svc.CreateIssue(r.Context(), userID(r), projectKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, issue)
}

func (h *Handler) getIssue(w http.ResponseWriter, r *http.Request) error {
	issue, err := h.svc.GetIssue(r.Context(), userID(r), issueKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, issue)
}

func (h *Handler) updateIssue(w http.ResponseWriter, r *http.Request) error {
	var in service.UpdateIssueInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	issue, err := h.svc.UpdateIssue(r.Context(), userID(r), issueKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, issue)
}

func (h *Handler) deleteIssue(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.DeleteIssue(r.Context(), userID(r), issueKey(r)); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

func (h *Handler) moveIssue(w http.ResponseWriter, r *http.Request) error {
	var in service.MoveIssueInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	issue, err := h.svc.MoveIssue(r.Context(), userID(r), issueKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, issue)
}

// --- comments ---

func (h *Handler) listComments(w http.ResponseWriter, r *http.Request) error {
	comments, err := h.svc.ListComments(r.Context(), userID(r), issueKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, comments)
}

func (h *Handler) createComment(w http.ResponseWriter, r *http.Request) error {
	var in service.CommentInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	comment, err := h.svc.CreateComment(r.Context(), userID(r), issueKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, comment)
}

func (h *Handler) updateComment(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	var in service.CommentInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	comment, err := h.svc.UpdateComment(r.Context(), userID(r), id, in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, comment)
}

func (h *Handler) deleteComment(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteComment(r.Context(), userID(r), id); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

// --- links ---

func (h *Handler) createLink(w http.ResponseWriter, r *http.Request) error {
	var in service.CreateLinkInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	link, err := h.svc.CreateLink(r.Context(), userID(r), issueKey(r), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, link)
}

func (h *Handler) deleteLink(w http.ResponseWriter, r *http.Request) error {
	id, err := pathID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteLink(r.Context(), userID(r), id); err != nil {
		return err
	}
	return httpx.NoContent(w)
}

// --- activity ---

func (h *Handler) issueActivity(w http.ResponseWriter, r *http.Request) error {
	activity, err := h.svc.IssueActivity(r.Context(), userID(r), issueKey(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}

func (h *Handler) projectActivity(w http.ResponseWriter, r *http.Request) error {
	limit, err := queryInt(r, "limit", service.DefaultProjectActivityLimit, 1)
	if err != nil {
		return err
	}
	offset, err := queryInt(r, "offset", 0, 0)
	if err != nil {
		return err
	}
	activity, err := h.svc.ProjectActivity(r.Context(), userID(r), projectKey(r), limit, offset)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}

func (h *Handler) activityFeed(w http.ResponseWriter, r *http.Request) error {
	limit, err := queryInt(r, "limit", service.DefaultFeedActivityLimit, 1)
	if err != nil {
		return err
	}
	offset, err := queryInt(r, "offset", 0, 0)
	if err != nil {
		return err
	}
	activity, err := h.svc.ActivityFeed(r.Context(), userID(r), limit, offset)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}
