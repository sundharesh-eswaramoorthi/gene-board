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
	if err != nil {
		if httpx.IsCode(err, httpx.CodeUnauthorized) {
			h.throttle.loginFailed(account)
		}
		return err
	}
	h.throttle.loginSucceeded(account)
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
	res, err := h.svc.UpdateMe(r.Context(), userID(r), in)
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
