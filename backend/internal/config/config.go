// Package config loads the server configuration from environment variables (SPEC §1).
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

// Defaults for every supported environment variable.
const (
	DefaultDatabaseURL     = "postgres://geneboard:geneboard@localhost:5442/geneboard?sslmode=disable"
	DefaultTestDatabaseURL = "postgres://geneboard:geneboard@localhost:5442/geneboard_test?sslmode=disable"
	DefaultHost            = "127.0.0.1" // container mode: "" (all interfaces)
	DefaultPort            = 8484
	DefaultJWTSecret       = "dev-insecure-secret-change-me"
	DefaultJWTTTL          = 168 * time.Hour
	DefaultCORSOrigins     = "http://localhost:5173"
	DefaultAuthRateLimit   = 20
	// DefaultTrustedProxies is loopback, where the Vite dev proxy runs. Container mode also
	// trusts the private networks, from which the compose nginx reaches the API.
	DefaultTrustedProxies          = "127.0.0.0/8,::1/128"
	DefaultContainerTrustedProxies = DefaultTrustedProxies + ",10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
)

// MinJWTSecretBytes is the shortest JWT_SECRET accepted when the API can be reached from
// other machines: in container mode, or when BIND_HOST is not a loopback address.
const MinJWTSecretBytes = 32

// Config is the fully resolved server configuration.
type Config struct {
	DatabaseURL     string
	TestDatabaseURL string
	// Host is the address the server listens on (BIND_HOST): 127.0.0.1 by default, so a
	// server run from source is not reachable from the network; "" (all interfaces) in
	// container mode, where the container's port mapping decides who can connect.
	Host        string
	Port        int
	JWTSecret   string
	JWTTTL      time.Duration
	CORSOrigins []string
	// AuthRateLimit is how many POST /auth/login and /auth/register requests (and password
	// changes) one client address may make per minute (AUTH_RATE_LIMIT; 0 turns auth
	// throttling off).
	AuthRateLimit int
	// TrustedProxies are the peers whose X-Real-IP / X-Forwarded-For headers are believed to
	// name the real client (TRUSTED_PROXIES): the reverse proxies in front of the API. The
	// container-mode default trusts every private network (the compose nginx connects from
	// one): a container that clients on the LAN reach directly must set TRUSTED_PROXIES=none.
	TrustedProxies []netip.Prefix
	// ContainerMode is set by the container image (GB_CONTAINER=1). There the published
	// development JWT secret is never used: without JWT_SECRET a random one is generated
	// (JWTSecretGenerated), and an explicit one must be at least 32 bytes long.
	ContainerMode      bool
	JWTSecretGenerated bool
}

// UsingDefaultJWTSecret reports whether the insecure development secret is in use.
func (c Config) UsingDefaultJWTSecret() bool { return c.JWTSecret == DefaultJWTSecret }

// Addr is the listen address for the HTTP server.
func (c Config) Addr() string { return net.JoinHostPort(c.Host, strconv.Itoa(c.Port)) }

// LocalAddr is the address a client on this machine reaches the server at (the container
// health probe): Addr, with 127.0.0.1 when the server listens on all interfaces.
func (c Config) LocalAddr() string {
	host := c.Host
	if ip, err := netip.ParseAddr(host); host == "" || (err == nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, strconv.Itoa(c.Port))
}

// LoopbackOnly reports whether the server listens on a loopback address only (BIND_HOST
// is localhost or a loopback IP), so other machines cannot reach it.
func (c Config) LoopbackOnly() bool {
	if strings.EqualFold(c.Host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(c.Host)
	return err == nil && ip.IsLoopback()
}

// Load reads the configuration from the process environment.
func Load() (Config, error) { return load(os.LookupEnv) }

// load is Load with an injectable environment lookup (for tests).
func load(lookup func(string) (string, bool)) (Config, error) {
	get := func(name, def string) string {
		if v, ok := lookup(name); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return def
	}

	cfg := Config{
		DatabaseURL:     get("DATABASE_URL", DefaultDatabaseURL),
		TestDatabaseURL: get("TEST_DATABASE_URL", DefaultTestDatabaseURL),
		JWTSecret:       get("JWT_SECRET", DefaultJWTSecret),
	}

	switch v := strings.ToLower(get("GB_CONTAINER", "")); v {
	case "", "0", "false", "no":
	case "1", "true", "yes":
		cfg.ContainerMode = true
	default:
		return Config{}, fmt.Errorf("config: GB_CONTAINER must be 1 or 0, got %q", v)
	}

	host, trustedProxies := DefaultHost, DefaultTrustedProxies
	if cfg.ContainerMode {
		host, trustedProxies = "", DefaultContainerTrustedProxies
	}
	cfg.Host = get("BIND_HOST", host)

	port, err := strconv.Atoi(get("PORT", strconv.Itoa(DefaultPort)))
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("config: PORT must be a TCP port number, got %q", get("PORT", ""))
	}
	cfg.Port = port

	ttl, err := time.ParseDuration(get("JWT_TTL", DefaultJWTTTL.String()))
	if err != nil || ttl <= 0 {
		return Config{}, fmt.Errorf("config: JWT_TTL must be a positive Go duration (e.g. 168h), got %q", get("JWT_TTL", ""))
	}
	cfg.JWTTTL = ttl

	for origin := range strings.SplitSeq(get("CORS_ORIGINS", DefaultCORSOrigins), ",") {
		if origin = strings.TrimRight(strings.TrimSpace(origin), "/"); origin != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, origin)
		}
	}

	limit, err := strconv.Atoi(get("AUTH_RATE_LIMIT", strconv.Itoa(DefaultAuthRateLimit)))
	if err != nil || limit < 0 {
		return Config{}, fmt.Errorf("config: AUTH_RATE_LIMIT must be a whole number >= 0 (0 disables), got %q", get("AUTH_RATE_LIMIT", ""))
	}
	cfg.AuthRateLimit = limit

	if cfg.TrustedProxies, err = parsePrefixes(get("TRUSTED_PROXIES", trustedProxies)); err != nil {
		return Config{}, fmt.Errorf("config: TRUSTED_PROXIES must be comma-separated IP addresses or CIDR prefixes (or none): %w", err)
	}

	switch {
	case cfg.ContainerMode:
		switch {
		case cfg.UsingDefaultJWTSecret():
			// The default is published in the repository: anyone could forge tokens with it.
			secret, err := randomSecret()
			if err != nil {
				return Config{}, err
			}
			cfg.JWTSecret, cfg.JWTSecretGenerated = secret, true
		case len(cfg.JWTSecret) < MinJWTSecretBytes:
			return Config{}, fmt.Errorf("config: JWT_SECRET must be at least %d characters long (e.g. `openssl rand -hex 32`)", MinJWTSecretBytes)
		}
	case !cfg.LoopbackOnly():
		// Reachable from other machines, which must not be able to forge sign-ins.
		if cfg.UsingDefaultJWTSecret() || len(cfg.JWTSecret) < MinJWTSecretBytes {
			return Config{}, fmt.Errorf("config: BIND_HOST=%s makes the API reachable from the network: set JWT_SECRET to at least %d characters (e.g. `openssl rand -hex 32`), or use BIND_HOST=127.0.0.1", cfg.Host, MinJWTSecretBytes)
		}
	}
	return cfg, nil
}

// parsePrefixes parses a comma-separated list of IP addresses and CIDR prefixes (a bare
// address stands for itself). "none" is the empty list (an empty value means the default).
func parsePrefixes(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	if strings.EqualFold(strings.TrimSpace(list), "none") {
		return out, nil
	}
	for item := range strings.SplitSeq(list, ",") {
		if item = strings.TrimSpace(item); item == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(item); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		ip, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("%q is neither", item)
		}
		ip = ip.WithZone("").Unmap()
		out = append(out, netip.PrefixFrom(ip, ip.BitLen()))
	}
	return out, nil
}

// randomSecret returns 32 random bytes, hex-encoded.
func randomSecret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("config: generate JWT secret: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
