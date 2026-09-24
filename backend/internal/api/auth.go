package api

import (
	"net/http"
	"strings"

	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) error {
	return httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) error {
	if err := h.throttle.allowClient(w, r); err != nil {
		return err
	}
	var in service.RegisterInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	res, err := h.svc.Register(r.Context(), in)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusCreated, res)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) error {
	if err := h.throttle.allowClient(w, r); err != nil {
		return err
	}
	var in service.LoginInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	account := strings.ToLower(strings.TrimSpace(in.Email))
	if err := h.throttle.allowAccount(w, account); err != nil {
		return err
	}
	res, err := h.svc.Login(r.Context(), in)
	h.throttle.loginDone(account, err)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) error {
	user, err := h.svc.Me(r.Context(), userID(r))
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, user)
}

func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) error {
	var in service.UpdateMeInput
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		return err
	}
	// RequireAuth has checked the token; UpdateMe needs it again (its version, and it is
	// returned unless the password changes).
	token, _ := httpx.BearerToken(r)
	// A password change verifies the current password, so it is throttled like a login.
	// Name-only updates are not.
	changePassword, session := in.ChangesPassword(), sessionKey(token)
	if changePassword {
		if err := h.throttle.allowPasswordChange(w, r, session); err != nil {
			return err
		}
	}
	res, err := h.svc.UpdateMe(r.Context(), token, in)
	if changePassword {
		h.throttle.passwordChangeDone(session, err)
	}
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) searchUsers(w http.ResponseWriter, r *http.Request) error {
	limit, err := queryInt(r, "limit", service.DefaultUserSearchLimit, 1)
	if err != nil {
		return err
	}
	users, err := h.svc.SearchUsers(r.Context(), r.URL.Query().Get("query"), limit)
	if err != nil {
		return err
	}
	return httpx.WriteJSON(w, http.StatusOK, users)
}
