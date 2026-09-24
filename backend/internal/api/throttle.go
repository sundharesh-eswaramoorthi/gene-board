package api

import (
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"geneboard/internal/httpx"
	"geneboard/internal/ratelimit"
)

// Failed logins allowed per account (e-mail address) before it is throttled, and the
// refill rate afterwards. A successful login clears the account's failures.
const (
	accountFailureBurst      = 10
	accountFailuresPerMinute = 1
)

// authThrottle limits the public, bcrypt-heavy endpoints POST /auth/login and
// /auth/register against password guessing and CPU floods: each client address gets a
// budget of requests per minute, and each account a budget of failed logins. Over budget
// the endpoints answer 429 rate_limited with a Retry-After header. A nil throttle (or one
// built with a zero limit) lets everything through.
type authThrottle struct {
	perClient *ratelimit.Limiter
	failures  *ratelimit.Limiter
}

// newAuthThrottle returns a throttle allowing perMinute requests per client address per
// minute (burst of the same size); 0 disables throttling.
func newAuthThrottle(perMinute int) *authThrottle {
	if perMinute <= 0 {
		return nil
	}
	return &authThrottle{
		perClient: ratelimit.New(perMinute, perMinute),
		failures:  ratelimit.New(accountFailuresPerMinute, accountFailureBurst),
	}
}

// allowClient spends one request of the caller's address budget.
func (a *authThrottle) allowClient(w http.ResponseWriter, r *http.Request) error {
	if a == nil {
		return nil
	}
	if ok, wait := a.perClient.Allow(clientAddr(r)); !ok {
		return tooMany(w, "Too many sign-in attempts from your network.", wait)
	}
	return nil
}

// allowAccount refuses logins to an account with too many recent failures.
func (a *authThrottle) allowAccount(w http.ResponseWriter, account string) error {
	if a == nil || account == "" {
		return nil
	}
	if ok, wait := a.failures.Check(account); !ok {
		return tooMany(w, "Too many failed sign-in attempts for this account.", wait)
	}
	return nil
}

// loginFailed records a failed login for account.
func (a *authThrottle) loginFailed(account string) {
	if a != nil && account != "" {
		a.failures.Take(account)
	}
}

// loginSucceeded clears account's failures.
func (a *authThrottle) loginSucceeded(account string) {
	if a != nil && account != "" {
		a.failures.Reset(account)
	}
}

func tooMany(w http.ResponseWriter, message string, wait time.Duration) error {
	w.Header().Set("Retry-After", strconv.Itoa(max(1, int(wait.Round(time.Second)/time.Second))))
	return httpx.TooManyRequests(message, wait)
}

// clientAddr is the address a request came from. When the direct peer is on the loopback
// interface or a private network — where the reverse proxies in front of the API run (the
// compose nginx, the Vite dev proxy) — the address the proxy reports in X-Real-IP (or as
// the last X-Forwarded-For hop, the one the proxy appended) is used. Public peers cannot
// choose their key with those headers.
func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !peer.IsLoopback() && !peer.IsPrivate() {
		return peer.String()
	}
	if a, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
		return a.Unmap().String()
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		hops := strings.Split(xff, ",")
		if a, err := netip.ParseAddr(strings.TrimSpace(hops[len(hops)-1])); err == nil {
			return a.Unmap().String()
		}
	}
	return peer.String()
}
