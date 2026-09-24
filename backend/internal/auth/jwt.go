package auth

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned by Verify for any malformed, expired or forged token.
var ErrInvalidToken = errors.New("auth: invalid token")

// Tokens issues and verifies HS256 JWTs whose `sub` claim is the user id and whose `ver`
// claim is the user's token version at issue time (revocation: the service rejects tokens
// whose version is no longer the user's current one).
type Tokens struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

// NewTokens creates a token issuer/verifier.
func NewTokens(secret string, ttl time.Duration) *Tokens {
	return &Tokens{secret: []byte(secret), ttl: ttl, now: time.Now}
}

// claims are the JWT claims of an access token. Version 0 is left out, so tokens issued
// before versions existed verify as version 0.
type claims struct {
	jwt.RegisteredClaims
	Version int32 `json:"ver,omitempty"`
}

// Issue returns a signed token for userID, carrying token version version, valid for the
// configured TTL.
func (t *Tokens) Issue(userID int64, version int32) (string, error) {
	now := t.now()
	claims := claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.ttl)),
		},
		Version: version,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", fmt.Errorf("auth: sign token: %w", err)
	}
	return signed, nil
}

// Verify validates the token's signature and expiry and returns the user id from its `sub`
// claim and the token version from its `ver` claim (0 when absent).
func (t *Tokens) Verify(token string) (userID int64, version int32, err error) {
	var claims claims
	parsed, err := jwt.ParseWithClaims(token, &claims,
		func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(t.now),
	)
	if err != nil || !parsed.Valid {
		return 0, 0, ErrInvalidToken
	}
	id, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil || id <= 0 || claims.Version < 0 {
		return 0, 0, ErrInvalidToken
	}
	return id, claims.Version, nil
}
