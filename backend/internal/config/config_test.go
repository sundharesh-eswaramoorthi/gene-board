package config

import (
	"net/netip"
	"slices"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func prefixes(list ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(list))
	for i, p := range list {
		out[i] = netip.MustParsePrefix(p)
	}
	return out
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != DefaultDatabaseURL || cfg.TestDatabaseURL != DefaultTestDatabaseURL {
		t.Errorf("unexpected database urls: %+v", cfg)
	}
	// Outside container mode the API listens on loopback only, so the published default
	// JWT secret cannot be exploited from the network.
	if cfg.Port != 8484 || cfg.Host != "127.0.0.1" || cfg.Addr() != "127.0.0.1:8484" || !cfg.LoopbackOnly() {
		t.Errorf("host/port = %q/%d, addr %q", cfg.Host, cfg.Port, cfg.Addr())
	}
	if cfg.LocalAddr() != "127.0.0.1:8484" {
		t.Errorf("local addr = %q", cfg.LocalAddr())
	}
	if cfg.JWTTTL != 168*time.Hour {
		t.Errorf("ttl = %s", cfg.JWTTTL)
	}
	if !cfg.UsingDefaultJWTSecret() {
		t.Error("expected default secret")
	}
	if !slices.Equal(cfg.CORSOrigins, []string{"http://localhost:5173"}) {
		t.Errorf("cors = %v", cfg.CORSOrigins)
	}
	if cfg.AuthRateLimit != DefaultAuthRateLimit || cfg.ContainerMode || cfg.JWTSecretGenerated {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	// Only loopback peers (the Vite dev proxy) may report the client address.
	if !slices.Equal(cfg.TrustedProxies, prefixes("127.0.0.0/8", "::1/128")) {
		t.Errorf("trusted proxies = %v", cfg.TrustedProxies)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"PORT":            "9000",
		"JWT_SECRET":      "s3cret",
		"JWT_TTL":         "2h",
		"CORS_ORIGINS":    " http://a.test/ , ,http://b.test",
		"TRUSTED_PROXIES": " 10.1.2.3 , ,192.168.7.9/16, ::ffff:172.18.0.5,fd00::1/8 ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9000 || cfg.JWTSecret != "s3cret" || cfg.JWTTTL != 2*time.Hour || cfg.UsingDefaultJWTSecret() {
		t.Errorf("unexpected config: %+v", cfg)
	}
	if !slices.Equal(cfg.CORSOrigins, []string{"http://a.test", "http://b.test"}) {
		t.Errorf("cors = %v", cfg.CORSOrigins)
	}
	if want := prefixes("10.1.2.3/32", "192.168.0.0/16", "172.18.0.5/32", "fd00::/8"); !slices.Equal(cfg.TrustedProxies, want) {
		t.Errorf("trusted proxies = %v, want %v", cfg.TrustedProxies, want)
	}
}

// TestHost: BIND_HOST picks the listen address. A loopback one keeps the development defaults;
// any other makes the API reachable from the network, which needs a real JWT secret.
func TestHost(t *testing.T) {
	strong := strings.Repeat("s", MinJWTSecretBytes)
	for host, addr := range map[string]string{"localhost": "localhost:8484", "::1": "[::1]:8484", "127.0.0.2": "127.0.0.2:8484"} {
		cfg, err := load(env(map[string]string{"BIND_HOST": host}))
		if err != nil {
			t.Fatalf("BIND_HOST=%s: %v", host, err)
		}
		if cfg.Addr() != addr || !cfg.LoopbackOnly() || !cfg.UsingDefaultJWTSecret() {
			t.Errorf("BIND_HOST=%s: addr %q, loopback %v", host, cfg.Addr(), cfg.LoopbackOnly())
		}
	}
	for _, c := range []struct{ host, addr, local string }{
		{"0.0.0.0", "0.0.0.0:8484", "127.0.0.1:8484"},
		{"::", "[::]:8484", "127.0.0.1:8484"},
		{"192.168.1.20", "192.168.1.20:8484", "192.168.1.20:8484"},
		{"myhost.example", "myhost.example:8484", "myhost.example:8484"},
	} {
		for _, secret := range []string{"", DefaultJWTSecret, "too-short"} {
			if _, err := load(env(map[string]string{"BIND_HOST": c.host, "JWT_SECRET": secret})); err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
				t.Errorf("BIND_HOST=%s JWT_SECRET=%q: err = %v, want a JWT_SECRET error", c.host, secret, err)
			}
		}
		cfg, err := load(env(map[string]string{"BIND_HOST": c.host, "JWT_SECRET": strong}))
		if err != nil {
			t.Fatalf("BIND_HOST=%s with a strong secret: %v", c.host, err)
		}
		if cfg.Addr() != c.addr || cfg.LocalAddr() != c.local || cfg.LoopbackOnly() || cfg.JWTSecret != strong {
			t.Errorf("BIND_HOST=%s: addr %q, local %q, loopback %v", c.host, cfg.Addr(), cfg.LocalAddr(), cfg.LoopbackOnly())
		}
	}
}

func TestLoadInvalid(t *testing.T) {
	for _, m := range []map[string]string{
		{"PORT": "abc"},
		{"PORT": "70000"},
		{"JWT_TTL": "forever"},
		{"JWT_TTL": "-1h"},
		{"AUTH_RATE_LIMIT": "-1"},
		{"AUTH_RATE_LIMIT": "lots"},
		{"GB_CONTAINER": "maybe"},
		{"TRUSTED_PROXIES": "proxy.local"},
		{"TRUSTED_PROXIES": "10.0.0.0/33"},
		{"TRUSTED_PROXIES": "none,10.0.0.1"},
		// Container mode refuses short secrets.
		{"GB_CONTAINER": "1", "JWT_SECRET": "s3cret"},
	} {
		if _, err := load(env(m)); err == nil {
			t.Errorf("expected error for %v", m)
		}
	}
}

// TestContainerModeDefaults: the container image (GB_CONTAINER=1) listens on all interfaces
// — the container's port mapping decides who connects — and trusts the private networks, from
// which the compose nginx reports the real client address.
func TestContainerModeDefaults(t *testing.T) {
	cfg, err := load(env(map[string]string{"GB_CONTAINER": "1"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "" || cfg.Addr() != ":8484" || cfg.LocalAddr() != "127.0.0.1:8484" || cfg.LoopbackOnly() {
		t.Errorf("host %q, addr %q, local %q", cfg.Host, cfg.Addr(), cfg.LocalAddr())
	}
	want := prefixes("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
	if !slices.Equal(cfg.TrustedProxies, want) {
		t.Errorf("trusted proxies = %v", cfg.TrustedProxies)
	}
	for _, peer := range []string{"172.18.0.3", "10.0.0.7", "192.168.65.1", "127.0.0.1"} {
		if !slices.ContainsFunc(cfg.TrustedProxies, func(p netip.Prefix) bool { return p.Contains(netip.MustParseAddr(peer)) }) {
			t.Errorf("%s is not trusted", peer)
		}
	}
	// Explicit settings still win; "none" trusts no peer (a container reached directly).
	cfg, err = load(env(map[string]string{"GB_CONTAINER": "1", "BIND_HOST": "127.0.0.1", "TRUSTED_PROXIES": "172.18.0.2"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr() != "127.0.0.1:8484" || !slices.Equal(cfg.TrustedProxies, prefixes("172.18.0.2/32")) || !cfg.JWTSecretGenerated {
		t.Errorf("unexpected config %+v", cfg)
	}
	cfg, err = load(env(map[string]string{"GB_CONTAINER": "1", "TRUSTED_PROXIES": " None "}))
	if err != nil || len(cfg.TrustedProxies) != 0 {
		t.Errorf("TRUSTED_PROXIES=none: %v, %v", cfg.TrustedProxies, err)
	}
}

// TestContainerModeNeverUsesTheDefaultSecret: the container image sets GB_CONTAINER=1. The
// development secret is public, so without JWT_SECRET a random one is generated per start.
func TestContainerModeNeverUsesTheDefaultSecret(t *testing.T) {
	for _, secret := range []string{"", "   ", DefaultJWTSecret} {
		cfg, err := load(env(map[string]string{"GB_CONTAINER": "1", "JWT_SECRET": secret}))
		if err != nil {
			t.Fatalf("secret %q: %v", secret, err)
		}
		if !cfg.ContainerMode || !cfg.JWTSecretGenerated || cfg.UsingDefaultJWTSecret() || len(cfg.JWTSecret) < MinJWTSecretBytes {
			t.Fatalf("secret %q: unexpected config %+v", secret, cfg)
		}
		again, _ := load(env(map[string]string{"GB_CONTAINER": "1"}))
		if again.JWTSecret == cfg.JWTSecret {
			t.Fatal("generated secrets must be random")
		}
	}
	strong := "0123456789abcdef0123456789abcdef"
	cfg, err := load(env(map[string]string{"GB_CONTAINER": "true", "JWT_SECRET": strong, "AUTH_RATE_LIMIT": "0"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.JWTSecret != strong || cfg.JWTSecretGenerated || cfg.AuthRateLimit != 0 {
		t.Fatalf("unexpected config %+v", cfg)
	}
}
