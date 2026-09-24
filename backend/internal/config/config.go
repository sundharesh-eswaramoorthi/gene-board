// Package config loads the server configuration from environment variables (SPEC §1).
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Defaults for every supported environment variable.
const (
	DefaultDatabaseURL     = "postgres://geneboard:geneboard@localhost:5442/geneboard?sslmode=disable"
	DefaultTestDatabaseURL = "postgres://geneboard:geneboard@localhost:5442/geneboard_test?sslmode=disable"
	DefaultPort            = 8484
	DefaultJWTSecret       = "dev-insecure-secret-change-me"
	DefaultJWTTTL          = 168 * time.Hour
	DefaultCORSOrigins     = "http://localhost:5173"
	DefaultAuthRateLimit   = 20
)

// MinContainerJWTSecretBytes is the shortest JWT_SECRET accepted in container mode.
const MinContainerJWTSecretBytes = 32

// Config is the fully resolved server configuration.
type Config struct {
	DatabaseURL     string
	TestDatabaseURL string
	Port            int
	JWTSecret       string
	JWTTTL          time.Duration
	CORSOrigins     []string
	// AuthRateLimit is how many POST /auth/login and /auth/register requests one client
	// address may make per minute (AUTH_RATE_LIMIT; 0 turns auth throttling off).
	AuthRateLimit int
	// ContainerMode is set by the container image (GB_CONTAINER=1). There the published
	// development JWT secret is never used: without JWT_SECRET a random one is generated
	// (JWTSecretGenerated), and an explicit one must be at least 32 bytes long.
	ContainerMode      bool
	JWTSecretGenerated bool
}

// UsingDefaultJWTSecret reports whether the insecure development secret is in use.
func (c Config) UsingDefaultJWTSecret() bool { return c.JWTSecret == DefaultJWTSecret }

// Addr is the listen address for the HTTP server.
func (c Config) Addr() string { return fmt.Sprintf(":%d", c.Port) }

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

	switch v := strings.ToLower(get("GB_CONTAINER", "")); v {
	case "", "0", "false", "no":
	case "1", "true", "yes":
		cfg.ContainerMode = true
	default:
		return Config{}, fmt.Errorf("config: GB_CONTAINER must be 1 or 0, got %q", v)
	}
	if cfg.ContainerMode {
		switch {
		case cfg.UsingDefaultJWTSecret():
			// The default is published in the repository: anyone could forge tokens with it.
			secret, err := randomSecret()
			if err != nil {
				return Config{}, err
			}
			cfg.JWTSecret, cfg.JWTSecretGenerated = secret, true
		case len(cfg.JWTSecret) < MinContainerJWTSecretBytes:
			return Config{}, fmt.Errorf("config: JWT_SECRET must be at least %d characters long (e.g. `openssl rand -hex 32`)", MinContainerJWTSecretBytes)
		}
	}
	return cfg, nil
}

// randomSecret returns 32 random bytes, hex-encoded.
func randomSecret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("config: generate JWT secret: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
