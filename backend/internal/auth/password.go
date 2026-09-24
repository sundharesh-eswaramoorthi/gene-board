// Package auth implements password hashing (bcrypt) and JWT access tokens (HS256).
package auth

import (
	"context"
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

// acquireBcrypt waits for a bcrypt slot and returns its release function. It gives up with
// ctx's error when ctx ends first: a request whose client has gone away must not keep its
// place in the queue ahead of live sign-ins.
func acquireBcrypt(ctx context.Context) (func(), error) {
	select {
	case bcryptSlots <- struct{}{}:
		return func() { <-bcryptSlots }, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("auth: wait for bcrypt: %w", ctx.Err())
	}
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

// Hash returns the bcrypt hash of password. It fails with ctx's error if ctx ends while it
// waits for a bcrypt slot.
func (h PasswordHasher) Hash(ctx context.Context, password string) (string, error) {
	release, err := acquireBcrypt(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	b, err := bcrypt.GenerateFromPassword([]byte(password), h.cost())
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(b), nil
}

// Verify reports whether password matches hash. A malformed hash is an error; a simple
// mismatch returns (false, nil). It fails with ctx's error if ctx ends while it waits for a
// bcrypt slot.
func (h PasswordHasher) Verify(ctx context.Context, hash, password string) (bool, error) {
	release, err := acquireBcrypt(ctx)
	if err != nil {
		return false, err
	}
	defer release()
	err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, bcrypt.ErrMismatchedHashAndPassword):
		return false, nil
	default:
		return false, fmt.Errorf("auth: verify password: %w", err)
	}
}
