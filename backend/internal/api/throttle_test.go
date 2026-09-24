package api

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

// TestClientAddr: only a trusted proxy may name the client (X-Real-IP, else the last
// X-Forwarded-For hop, the one the proxy appended); anyone else is keyed by its own address.
func TestClientAddr(t *testing.T) {
	// The container-mode default: loopback plus the private networks (compose nginx).
	compose := append([]netip.Prefix{netip.MustParsePrefix("172.16.0.0/12")}, loopbackProxies...)
	for _, c := range []struct {
		name, peer, realIP, xff string
		trusted                 []netip.Prefix
		want                    string
	}{
		{"direct client", "203.0.113.7:4000", "", "", loopbackProxies, "203.0.113.7"},
		{"direct client naming another", "203.0.113.7:4000", "198.51.100.1", "198.51.100.2", loopbackProxies, "203.0.113.7"},
		{"LAN host outside TRUSTED_PROXIES", "192.168.1.20:4000", "198.51.100.1", "", loopbackProxies, "192.168.1.20"},
		{"nothing trusted", "127.0.0.1:4000", "198.51.100.1", "", nil, "127.0.0.1"},
		{"loopback proxy, X-Real-IP", "127.0.0.1:4000", " 198.51.100.1 ", "198.51.100.2", loopbackProxies, "198.51.100.1"},
		{"loopback proxy, last X-Forwarded-For hop", "[::1]:4000", "", "10.9.9.9, 198.51.100.2", loopbackProxies, "198.51.100.2"},
		{"loopback proxy without headers", "[::ffff:127.0.0.1]:4000", "", "", loopbackProxies, "127.0.0.1"},
		{"loopback proxy, garbage headers", "127.0.0.1:4000", "nope", "also-nope", loopbackProxies, "127.0.0.1"},
		{"compose nginx", "172.18.0.3:4000", "198.51.100.1", "", compose, "198.51.100.1"},
		{"mapped client address", "172.18.0.3:4000", "::ffff:198.51.100.1", "", compose, "198.51.100.1"},
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = c.peer
		if c.realIP != "" {
			req.Header.Set("X-Real-IP", c.realIP)
		}
		if c.xff != "" {
			req.Header.Set("X-Forwarded-For", c.xff)
		}
		if got := clientAddr(req, c.trusted); got != c.want {
			t.Errorf("%s: clientAddr = %q, want %q", c.name, got, c.want)
		}
	}
}
