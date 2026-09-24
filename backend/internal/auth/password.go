// Package auth implements password hashing (bcrypt) and JWT access tokens (HS256).
package auth

import (
	"errors"
	"fmt"
	"runtime"

	"golang.org/x/crypto/bcrypt"
)

// DefaultBcryptCost is the production bcrypt work factor.
const DefaultBcryptCost = 12

// MaxPasswordBytes is bcrypt's input limit; longer passwords are rejected by validation.
const MaxPasswordBytes = 72

// bcryptSlots caps how many bcrypt computations run at once (about 200ms of CPU each at
// the default cost). A flood of logins or registrations then queues here instead of
// occupying every CPU, so other requests stay responsive.
var bcryptSlots = make(chan struct{}, max(1, runtime.GOMAXPROCS(0)/2))

func acquireBcrypt() func() {
	bcryptSlots <- struct{}{}
	return func() { <-bcryptSlots }
}

// PasswordHasher hashes and verifies passwords with bcrypt.
// The zero value uses DefaultBcryptCost; tests use bcrypt.MinCost for speed.
type PasswordHasher struct {
	Cost int
}

// NewPasswordHasher returns a hasher with the given cost (0 = DefaultBcryptCost).
func NewPasswordHasher(cost int) PasswordHasher { return PasswordHasher{Cost: cost} }

func (h PasswordHasher) cost() int {
	if h.Cost == 0 {
		return DefaultBcryptCost
	}
	return h.Cost
}

// Hash returns the bcrypt hash of password.
func (h PasswordHasher) Hash(password string) (string, error) {
	defer acquireBcrypt()()
	b, err := bcrypt.GenerateFromPassword([]byte(password), h.cost())
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(b), nil
}

// Verify reports whether password matches hash. A malformed hash is an error; a simple
// mismatch returns (false, nil).
func (h PasswordHasher) Verify(hash, password string) (bool, error) {
	defer acquireBcrypt()()
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, bcrypt.ErrMismatchedHashAndPassword):
		return false, nil
	default:
		return false, fmt.Errorf("auth: verify password: %w", err)
	}
}
