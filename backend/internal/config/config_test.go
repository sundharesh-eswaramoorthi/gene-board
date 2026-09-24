package config

import (
	"slices"
	"testing"
	"time"
)

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != DefaultDatabaseURL || cfg.TestDatabaseURL != DefaultTestDatabaseURL {
		t.Errorf("unexpected database urls: %+v", cfg)
	}
	if cfg.Port != 8484 || cfg.Addr() != ":8484" {
		t.Errorf("port = %d", cfg.Port)
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
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"PORT":         "9000",
		"JWT_SECRET":   "s3cret",
		"JWT_TTL":      "2h",
		"CORS_ORIGINS": " http://a.test/ , ,http://b.test",
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
		// Container mode refuses short secrets.
		{"GB_CONTAINER": "1", "JWT_SECRET": "s3cret"},
	} {
		if _, err := load(env(m)); err == nil {
			t.Errorf("expected error for %v", m)
		}
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
		if !cfg.ContainerMode || !cfg.JWTSecretGenerated || cfg.UsingDefaultJWTSecret() || len(cfg.JWTSecret) < MinContainerJWTSecretBytes {
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
