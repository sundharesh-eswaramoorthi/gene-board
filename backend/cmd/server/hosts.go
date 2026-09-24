package main

import (
	"net"
	"net/http"
	"net/netip"
	"strings"

	"geneboard/internal/httpx"
)

// loopbackHostsOnly refuses (403) requests addressed to anything but a loopback host:
// localhost or a loopback IP, any port. serve wraps the router in it while the server signs
// sessions with the published development JWT secret. Listening on 127.0.0.1 keeps other
// machines out; this keeps out web pages that point their own host name at 127.0.0.1 (DNS
// rebinding) to send tokens forged with that secret from the developer's browser. The Vite
// dev proxy addresses the API as 127.0.0.1 (changeOrigin), whatever host the page uses.
func loopbackHostsOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(r.Host) {
			httpx.WriteError(w, r, httpx.Forbidden("This development server only answers requests addressed to localhost or 127.0.0.1"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLoopbackHost reports whether host (a Host header: a name or an IP, with an optional
// port) names this machine's loopback interface.
func isLoopbackHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(strings.TrimSuffix(strings.TrimPrefix(host, "["), "]"))
	return err == nil && ip.Unmap().IsLoopback()
}
