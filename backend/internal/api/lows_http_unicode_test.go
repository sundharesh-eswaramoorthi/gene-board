package api

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"geneboard/internal/dto"
)

// TestEmailsAreNormalisedToNFC: an address with a decomposed accent (NFD) is the same
// address as its precomposed form (NFC) for registration, sign-in, adding members and the
// user search, and addresses with invisible characters — which would look exactly like
// another account's — are refused.
func TestEmailsAreNormalisedToNFC(t *testing.T) {
	e := newTestEnv(t)
	const nfc, nfd = "jos\u00e9@example.test", "jose\u0301@example.test"
	jose := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": nfc, "name": "Jos\u00e9", "password": testPassword,
	}), http.StatusCreated)

	expectError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": nfd, "name": "Impostor", "password": testPassword,
	}), http.StatusConflict, "conflict")
	for _, email := range []string{nfd, "JOSE\u0301@EXAMPLE.TEST", "JOS\u00c9@example.test"} {
		res := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{
			"email": email, "password": testPassword,
		}), http.StatusOK)
		if res.User.ID != jose.User.ID {
			t.Fatalf("login as %+q: user %d, want %d", email, res.User.ID, jose.User.ID)
		}
	}

	for _, email := range []string{
		"mimic\u200b@example.test", // zero-width space
		"mimic@exam\u200dple.test", // zero-width joiner
		"\ufeffmimic@example.test", // BOM (not trimmed like spaces are)
		"mi\u00a0mic@example.test", // no-break space
		"mimic\u202e@example.test", // right-to-left override
		"mimic\u2060@example.test", // word joiner
	} {
		expectFieldError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
			"email": email, "name": "Mimic", "password": testPassword,
		}), "email")
	}

	owner := e.createUser("Owner")
	e.createProject(owner, "GB")
	member := decodeAs[dto.Member](t, e.do(http.MethodPost, "/api/projects/GB/members", owner.Token, map[string]any{
		"email": nfd, "role": "member",
	}), http.StatusCreated)
	if member.User.ID != jose.User.ID {
		t.Fatalf("added user %d, want %d", member.User.ID, jose.User.ID)
	}

	found := decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?query="+url.QueryEscape("jose\u0301"), owner.Token, nil), http.StatusOK)
	if len(found) != 1 || found[0].ID != jose.User.ID {
		t.Fatalf("search for the decomposed name: %+v", found)
	}
}

// TestNamesNeedAVisibleCharacter: names are brought to NFC and stripped of the white space
// and invisible characters around them, and a name (or any other required text) made only
// of invisible characters is "required", not a blank name in every list and activity row.
// Emoji sequences, which end in variation selectors or tag characters, stay intact.
func TestNamesNeedAVisibleCharacter(t *testing.T) {
	e := newTestEnv(t)
	for _, name := range []string{"\u200b", "\ufeff\u2060 \u200d", "\u3164", "\u0301", "\u202e\u200e"} {
		res := expectFieldError(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
			"email": "blank@example.test", "name": name, "password": testPassword,
		}), "name")
		if res.Fields["name"] != "is required" {
			t.Fatalf("name %+q: %+v", name, res)
		}
	}
	u := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "rene@example.test", "name": " \u200bRene\u0301\u200d\ufeff ", "password": testPassword,
	}), http.StatusCreated)
	if u.User.Name != "Ren\u00e9" {
		t.Fatalf("stored name %+q, want %+q", u.User.Name, "Ren\u00e9")
	}

	expectFieldError(t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": "\u200b\u200b"}), "name")
	for _, name := range []string{
		"Ren\u00e9 \u2764\ufe0f", // heart + emoji presentation selector
		"Ren\u00e9 \U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F", // flag of Scotland (tag sequence)
		"Ren\u00e9 \U0001F469\u200d\U0001F4BB",                                             // woman technologist (ZWJ sequence)
	} {
		res := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": name}), http.StatusOK)
		if res.User.Name != name {
			t.Fatalf("stored name %+q, want %+q", res.User.Name, name)
		}
	}

	// Other required text goes through the same check.
	owner := e.createUser("Owner")
	e.createProject(owner, "GB")
	is := e.newIssue(owner, "GB", "task", "Task", nil)
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/labels", owner.Token, map[string]any{"name": "\u200b"}), "name")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/statuses", owner.Token, map[string]any{"name": "\ufeff\u200b", "category": "todo"}), "name")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects", owner.Token, map[string]any{"key": "BLANK", "name": "\u2060"}), "name")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/issues", owner.Token, map[string]any{"type": "task", "summary": "\u200b"}), "summary")
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+is.Key+"/comments", owner.Token, map[string]any{"body": "\u200b\n\u200b"}), "body")
}

// TestNamesAreNormalisedEverywhere: project, sprint, column and label names are cleaned like
// user names (service.cleanName), so a name that differs from another only by an invisible
// character or by how an accent is encoded is a duplicate (409), and one made only of
// invisible characters counts as blank.
func TestNamesAreNormalisedEverywhere(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")

	e.createLabel(u, "GB", "Caf\u00e9")
	for _, name := range []string{"Cafe\u0301", "caf\u00e9\u200b", "\ufeffCAF\u00c9"} {
		expectError(t, e.do(http.MethodPost, "/api/projects/GB/labels", u.Token, map[string]any{"name": name}), http.StatusConflict, "conflict")
	}
	other := e.createLabel(u, "GB", "Other")
	expectError(t, e.do(http.MethodPatch, "/api/projects/GB/labels/"+itoa(other.ID), u.Token, map[string]any{"name": "Cafe\u0301"}),
		http.StatusConflict, "conflict")

	expectError(t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token, map[string]any{"name": "Done\u200b", "category": "done"}),
		http.StatusConflict, "conflict")
	col := decodeAs[dto.Status](t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token,
		map[string]any{"name": "\u200bRe\u0301view", "category": "in_progress"}), http.StatusCreated)
	if col.Name != "R\u00e9view" {
		t.Fatalf("column name %+q", col.Name)
	}
	expectError(t, e.do(http.MethodPatch, "/api/projects/GB/statuses/"+itoa(col.ID), u.Token, map[string]any{"name": "To Do\u2060"}),
		http.StatusConflict, "conflict")

	p := decodeAs[dto.Project](t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{"key": "CAFE", "name": "\u200bCafe\u0301\u200b"}), http.StatusCreated)
	if p.Name != "Caf\u00e9" {
		t.Fatalf("project name %+q", p.Name)
	}
	p = decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/CAFE", u.Token, map[string]any{"name": "Cafe\u0301 2\ufeff"}), http.StatusOK)
	if p.Name != "Caf\u00e9 2" {
		t.Fatalf("renamed project %+q", p.Name)
	}

	sp := e.createSprint(u, "GB", map[string]any{"name": "\u200b"})
	if sp.Name != "GB Sprint 1" {
		t.Fatalf("an invisible sprint name was kept: %+q", sp.Name)
	}
	// Combining marks and emoji tags survive cleanName, but alone they show nothing either.
	for i, name := range []string{"\u0301", "\U000E0067\U000E007F"} {
		got := e.createSprint(u, "GB", map[string]any{"name": name})
		if want := fmt.Sprintf("GB Sprint %d", i+2); got.Name != want {
			t.Fatalf("sprint name %+q stored as %+q, want %q", name, got.Name, want)
		}
	}
	sp = decodeAs[dto.Sprint](t, e.do(http.MethodPatch, sprintPath(sp.ID, ""), u.Token, map[string]any{"name": "Sprint\u200b"}), http.StatusOK)
	if sp.Name != "Sprint" {
		t.Fatalf("renamed sprint %+q", sp.Name)
	}
}

// TestLoginThrottleSharesEveryAddressSpelling: every spelling that signs in to an account
// (case, precomposed or decomposed accents) counts toward that account's failure budget, so
// alternating them gives no extra password guesses.
func TestLoginThrottleSharesEveryAddressSpelling(t *testing.T) {
	e := newTestEnv(t)
	expectStatus(t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": "jos\u00e9@example.test", "name": "Jos\u00e9", "password": testPassword,
	}), http.StatusCreated)
	h := NewRouter(Deps{Service: e.svc, Logger: discardLogger, AuthRateLimit: 1000})
	spellings := []string{"jos\u00e9@example.test", "jose\u0301@example.test", "JOSE\u0301@example.test"}
	for i := range accountFailureBurst {
		body := fmt.Sprintf(`{"email":%q,"password":"wrong-password"}`, spellings[i%len(spellings)])
		if rec := authRequest(h, "/api/auth/login", fmt.Sprintf("203.0.113.%d:1", i+1), "", body); rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	for _, email := range spellings {
		body := fmt.Sprintf(`{"email":%q,"password":%q}`, email, testPassword)
		if rec := authRequest(h, "/api/auth/login", "203.0.113.99:1", "", body); rec.Code != http.StatusTooManyRequests {
			t.Fatalf("%+q after %d failures: %d %s", email, accountFailureBurst, rec.Code, rec.Body)
		}
	}
}
