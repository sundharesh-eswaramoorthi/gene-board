package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"geneboard/internal/httpx"
	"geneboard/internal/ratelimit"
	"geneboard/internal/service"
)

// Failed logins allowed per account (e-mail address) before it is throttled, and the
// refill rate afterwards. A successful login clears the account's failures. Password
// changes with a wrong current password have a budget of the same size per session.
const (
	accountFailureBurst      = 10
	accountFailuresPerMinute = 1
)

// authThrottle limits the bcrypt-heavy endpoints — POST /auth/login and /auth/register, and
// PATCH /auth/me when it changes the password — against password guessing and CPU floods:
// each client address gets a budget of requests per minute, each account a budget of
// failed logins, and each session a budget of wrong current passwords. Over budget the
// endpoints answer 429 rate_limited with a Retry-After header. A nil throttle (or one built
// with a zero limit) lets everything through.
//
// A failure budget is spent before the password is checked and refunded when the attempt
// turns out not to count, so concurrent guesses cannot all pass before any is counted.
type authThrottle struct {
	perClient        *ratelimit.Limiter
	failures         *ratelimit.Limiter // keyed by e-mail address
	passwordFailures *ratelimit.Limiter // keyed by session (sessionKey)
	trustedProxies   []netip.Prefix
}

// newAuthThrottle returns a throttle allowing perMinute requests per client address per
// minute (burst of the same size); 0 disables throttling. Requests from trustedProxies
// are attributed to the client the proxy reports (see clientAddr).
func newAuthThrottle(perMinute int, trustedProxies []netip.Prefix) *authThrottle {
	if perMinute <= 0 {
		return nil
	}
	return &authThrottle{
		perClient:        ratelimit.New(perMinute, perMinute),
		failures:         ratelimit.New(accountFailuresPerMinute, accountFailureBurst),
		passwordFailures: ratelimit.New(accountFailuresPerMinute, accountFailureBurst),
		trustedProxies:   trustedProxies,
	}
}

// allowClient spends one request of the caller's address budget.
func (a *authThrottle) allowClient(w http.ResponseWriter, r *http.Request) error {
	if a == nil {
		return nil
	}
	if ok, wait := a.perClient.Allow(clientAddr(r, a.trustedProxies)); !ok {
		return tooMany(w, "Too many sign-in attempts from your network.", wait)
	}
	return nil
}

// allowAccount reserves one failed login of account's budget, and refuses the login when
// none is left. loginDone settles the reservation.
func (a *authThrottle) allowAccount(w http.ResponseWriter, account string) error {
	if a == nil || account == "" {
		return nil
	}
	if ok, wait := a.failures.Allow(account); !ok {
		return tooMany(w, "Too many failed sign-in attempts for this account.", wait)
	}
	return nil
}

// loginDone settles the failed login allowAccount reserved, given the login's outcome: a
// failed login keeps it spent, a successful one clears the account's failures, and any
// other error (nothing was checked) gives it back.
func (a *authThrottle) loginDone(account string, err error) {
	if a != nil && account != "" {
		settle(a.failures, account, err, httpx.IsCode(err, httpx.CodeUnauthorized))
	}
}

// allowPasswordChange guards a password change, which verifies the current password like a
// login: it spends one request of the caller's address budget (shared with sign-ins), and
// reserves one wrong current password of the session's budget, refusing the change when
// none is left — so a stolen session cannot be used to guess the account's password. The
// budget is per session, not per user: whoever holds a stolen token can exhaust it, but
// the owner can still sign in again and change the password from the new session, which
// revokes the stolen one. passwordChangeDone settles the reservation.
func (a *authThrottle) allowPasswordChange(w http.ResponseWriter, r *http.Request, session string) error {
	if a == nil {
		return nil
	}
	if ok, wait := a.perClient.Allow(clientAddr(r, a.trustedProxies)); !ok {
		return tooMany(w, "Too many attempts from your network.", wait)
	}
	if ok, wait := a.passwordFailures.Allow(session); !ok {
		return tooMany(w, "Too many wrong current passwords in this session. Sign in again to change your password, or try later.", wait)
	}
	return nil
}

// passwordChangeDone settles the wrong current password allowPasswordChange reserved,
// given the change's outcome: a wrong current password keeps it spent, a successful change
// clears the session's failures, and any other error gives it back.
func (a *authThrottle) passwordChangeDone(session string, err error) {
	if a != nil {
		settle(a.passwordFailures, session, err, errors.Is(err, service.ErrWrongCurrentPassword))
	}
}

// settle resolves a failure reserved in l for key: success (err == nil) clears key's
// failures, a failure keeps the reservation, and any other error refunds it.
func settle(l *ratelimit.Limiter, key string, err error, failed bool) {
	switch {
	case err == nil:
		l.Reset(key)
	case !failed:
		l.Refund(key)
	}
}

// sessionKey identifies the session a request's access token belongs to: a fingerprint of
// the token itself. Only a sign-in or a password change (both need the password) yields a
// new token, so a session cannot renew its budget.
func sessionKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:16])
}

func tooMany(w http.ResponseWriter, message string, wait time.Duration) error {
	w.Header().Set("Retry-After", strconv.Itoa(max(1, int(wait.Round(time.Second)/time.Second))))
	return httpx.TooManyRequests(message, wait)
}

// clientAddr is the address a request came from. When the direct peer is a trusted proxy
// (TRUSTED_PROXIES: loopback, where the Vite dev proxy runs, and in container mode also the
// private networks the compose nginx connects from), the address the proxy reports in
// X-Real-IP (or as the last X-Forwarded-For hop, the one the proxy appended) is used. Other
// peers cannot choose their key with those headers.
func clientAddr(r *http.Request, trustedProxies []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !trusted(peer, trustedProxies) {
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

// trusted reports whether addr lies in one of prefixes.
func trusted(addr netip.Addr, prefixes []netip.Prefix) bool {
	for _, p := range prefixes {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
