package api

import (
	"net/http"
	"strings"
	"testing"

	"geneboard/internal/dto"
)

func TestHealth(t *testing.T) {
	e := newTestEnv(t)
	res := decodeAs[map[string]string](t, e.do(http.MethodGet, "/api/health", "", nil), http.StatusOK)
	if res["status"] != "ok" {
		t.Fatalf("health = %v", res)
	}
}

func TestRegisterLoginMe(t *testing.T) {
	e := newTestEnv(t)

	reg := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "  Ada@Example.TEST ", "name": "  Ada Lovelace ", "password": "password123",
	}), http.StatusCreated)
	if reg.Token == "" || reg.User.ID == 0 || reg.User.Email != "ada@example.test" || reg.User.Name != "Ada Lovelace" {
		t.Fatalf("unexpected register response: %+v", reg)
	}

	// Duplicate e-mail (case-insensitive) -> 409.
	expectError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "ADA@example.test", "name": "Other", "password": "password123",
	}), http.StatusConflict, "conflict")

	// Validation.
	bad := expectError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "not-an-email", "name": "", "password": "short",
	}), http.StatusBadRequest, "validation_error")
	for _, f := range []string{"email", "name", "password"} {
		if bad.Fields[f] == "" {
			t.Errorf("expected field error for %s: %+v", f, bad)
		}
	}
	expectFieldError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "x@example.test", "name": strings.Repeat("n", 101), "password": "password123",
	}), "name")

	// Login.
	login := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
		"email": "ADA@example.test", "password": "password123",
	}), http.StatusOK)
	if login.User.ID != reg.User.ID || login.Token == "" {
		t.Fatalf("login: %+v", login)
	}
	wrong := expectError(t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
		"email": "ada@example.test", "password": "wrong-password",
	}), http.StatusUnauthorized, "unauthorized")
	if wrong.Message != "Invalid email or password" {
		t.Errorf("message = %q", wrong.Message)
	}
	expectError(t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
		"email": "nobody@example.test", "password": "password123",
	}), http.StatusUnauthorized, "unauthorized")

	// Me.
	me := decodeAs[dto.User](t, e.do(http.MethodGet, "/api/auth/me", login.Token, nil), http.StatusOK)
	if me.ID != reg.User.ID || me.Email != "ada@example.test" {
		t.Fatalf("me: %+v", me)
	}
}

func TestUpdateMe(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Grace")
	nextTokenSecond()

	renamed := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": " Grace Hopper "}), http.StatusOK)
	if renamed.User.Name != "Grace Hopper" || renamed.Token != u.Token {
		t.Fatalf("rename: %+v", renamed)
	}
	// A rename revokes nothing (and starts no new session): the caller's token keeps working.
	expectStatus(t, e.do(http.MethodGet, "/api/auth/me", u.Token, nil), http.StatusOK)
	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": nil}), "name")
	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": "  "}), "name")

	// Password change needs both fields; the current password must be right.
	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"newPassword": "newpassword1"}), "currentPassword")
	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword}), "newPassword")
	wrong := expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{
		"currentPassword": "not-my-password", "newPassword": "newpassword1",
	}), "currentPassword")
	if wrong.Fields["currentPassword"] != "is incorrect" {
		t.Errorf("fields = %v", wrong.Fields)
	}
	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{
		"currentPassword": testPassword, "newPassword": "short",
	}), "newPassword")
	changed := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{
		"currentPassword": testPassword, "newPassword": "newpassword1",
	}), http.StatusOK)
	if changed.Token == "" || changed.User.Name != "Grace Hopper" {
		t.Fatalf("password change: %+v", changed)
	}

	expectError(t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{"email": u.Email, "password": testPassword}), http.StatusUnauthorized, "unauthorized")
	decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{"email": u.Email, "password": "newpassword1"}), http.StatusOK)
}

// TestPasswordChangeRevokesTokens: changing the password must lock out whoever holds an
// older token (SPEC §5 PATCH /auth/me). Only the token returned by the change (and later
// logins) keeps working, over REST and for the websocket handshake.
func TestPasswordChangeRevokesTokens(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Bob")
	e.createProject(u, "GB")
	stolen := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
		"email": u.Email, "password": testPassword,
	}), http.StatusOK).Token

	changed := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{
		"currentPassword": testPassword, "newPassword": "a-new-password",
	}), http.StatusOK)

	for _, old := range []string{u.Token, stolen} {
		for _, path := range []string{"/api/auth/me", "/api/projects"} {
			expectError(t, e.do(http.MethodGet, path, old, nil), http.StatusUnauthorized, "unauthorized")
		}
		expectError(t, e.do(http.MethodGet, "/api/projects/GB/ws?token="+old, "", nil), http.StatusUnauthorized, "unauthorized")
	}
	expectStatus(t, e.do(http.MethodGet, "/api/projects", changed.Token, nil), http.StatusOK)
	relogin := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
		"email": u.Email, "password": "a-new-password",
	}), http.StatusOK)
	expectStatus(t, e.do(http.MethodGet, "/api/auth/me", relogin.Token, nil), http.StatusOK)
}

func TestAuthRequiredAndMalformedRequests(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Linus")

	for _, path := range []string{"/api/auth/me", "/api/projects", "/api/issues", "/api/activity", "/api/users"} {
		expectError(t, e.do(http.MethodGet, path, "", nil), http.StatusUnauthorized, "unauthorized")
		expectError(t, e.do(http.MethodGet, path, "garbage.token.value", nil), http.StatusUnauthorized, "unauthorized")
	}
	expectError(t, e.do(http.MethodPost, "/api/projects", u.Token, `{"key":`), http.StatusBadRequest, "bad_request")
	expectError(t, e.do(http.MethodPost, "/api/projects", u.Token, `{"key": 5}`), http.StatusBadRequest, "bad_request")
	expectError(t, e.do(http.MethodPost, "/api/projects", u.Token, nil), http.StatusBadRequest, "bad_request")
	expectError(t, e.do(http.MethodGet, "/api/nope", u.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, "/api/comments/abc", u.Token, nil), http.StatusMethodNotAllowed, "method_not_allowed")
	expectError(t, e.do(http.MethodPatch, "/api/comments/abc", u.Token, map[string]any{"body": "x"}), http.StatusBadRequest, "bad_request")
}

func TestUserSearch(t *testing.T) {
	e := newTestEnv(t)
	alice := e.createUser("Alice Smith")
	e.createUser("Bob Jones")
	e.createUser("Carol Smithers")

	all := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users", alice.Token, nil), http.StatusOK)
	if len(all) != 3 || all[0].Name != "Alice Smith" || all[2].Name != "Carol Smithers" {
		t.Fatalf("all users: %+v", all)
	}
	smith := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?query=SMITH", alice.Token, nil), http.StatusOK)
	if len(smith) != 2 {
		t.Fatalf("smith: %+v", smith)
	}
	byEmail := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?query=bob.jones@", alice.Token, nil), http.StatusOK)
	if len(byEmail) != 1 || byEmail[0].Name != "Bob Jones" {
		t.Fatalf("by email: %+v", byEmail)
	}
	wild := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?query=%25", alice.Token, nil), http.StatusOK)
	if len(wild) != 0 {
		t.Fatalf("LIKE wildcards must be escaped: %+v", wild)
	}
	limited := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?limit=1", alice.Token, nil), http.StatusOK)
	if len(limited) != 1 {
		t.Fatalf("limit: %+v", limited)
	}
	expectError(t, e.do(http.MethodGet, "/api/users?limit=abc", alice.Token, nil), http.StatusBadRequest, "bad_request")
}
