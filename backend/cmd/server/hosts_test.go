package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestLoopbackHostsOnly: with the published development secret, a page that rebinds its
// own host name to 127.0.0.1 must not reach the API (it could send forged tokens); requests
// addressed to a loopback host — the Vite proxy, curl, the e2e suite — are served.
func TestLoopbackHostsOnly(t *testing.T) {
	h := loopbackHostsOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for host, want := range map[string]int{
		"127.0.0.1:8484":               http.StatusNoContent,
		"127.0.0.1":                    http.StatusNoContent,
		"127.0.0.2:8484":               http.StatusNoContent,
		"localhost:8484":               http.StatusNoContent,
		"LocalHost":                    http.StatusNoContent,
		"[::1]:8484":                   http.StatusNoContent,
		"[::1]":                        http.StatusNoContent,
		"rebind.attacker.example:8484": http.StatusForbidden,
		"attacker.example":             http.StatusForbidden,
		"localhost.attacker.example":   http.StatusForbidden,
		"192.168.1.20:8484":            http.StatusForbidden,
		"0.0.0.0:8484":                 http.StatusForbidden,
		"":                             http.StatusForbidden,
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q: status %d, want %d", host, rec.Code, want)
		}
		if want == http.StatusForbidden && !strings.Contains(rec.Body.String(), `"forbidden"`) {
			t.Errorf("Host %q: body %s, want the forbidden envelope", host, rec.Body)
		}
	}
}
