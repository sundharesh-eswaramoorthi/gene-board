package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHasher(t *testing.T) {
	h := NewPasswordHasher(bcrypt.MinCost)
	ctx := context.Background()
	hash, err := h.Hash(ctx, "correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := h.Verify(ctx, hash, "correct horse"); err != nil || !ok {
		t.Fatalf("expected match, got ok=%v err=%v", ok, err)
	}
	if ok, err := h.Verify(ctx, hash, "wrong"); err != nil || ok {
		t.Fatalf("expected mismatch, got ok=%v err=%v", ok, err)
	}
	if _, err := h.Verify(ctx, "not-a-hash", "x"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
	if cost, _ := bcrypt.Cost([]byte(hash)); cost != bcrypt.MinCost {
		t.Fatalf("cost = %d", cost)
	}
	if (PasswordHasher{}).cost() != DefaultBcryptCost {
		t.Fatal("zero value must use the default cost")
	}
}

// TestPasswordHasherGivesUpWhenCancelled: a request whose client has gone away leaves the
// bcrypt queue instead of waiting for a slot (and then burning one) for nobody.
func TestPasswordHasherGivesUpWhenCancelled(t *testing.T) {
	h := NewPasswordHasher(bcrypt.MinCost)
	hash, err := h.Hash(context.Background(), "correct horse")
	if err != nil {
		t.Fatal(err)
	}
	// Every slot busy (a flood of sign-ins).
	var releases []func()
	for range cap(bcryptSlots) {
		release, err := acquireBcrypt(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := h.Hash(ctx, "correct horse"); !errors.Is(err, context.Canceled) {
		t.Fatalf("hash while cancelled: %v", err)
	}
	if _, err := h.Verify(ctx, hash, "correct horse"); !errors.Is(err, context.Canceled) {
		t.Fatalf("verify while cancelled: %v", err)
	}
	deadline, stop := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer stop()
	if _, err := h.Verify(deadline, hash, "correct horse"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("verify past the deadline: %v", err)
	}
	for _, release := range releases {
		release()
	}
	if ok, err := h.Verify(context.Background(), hash, "correct horse"); err != nil || !ok {
		t.Fatalf("after the queue drained: ok=%v err=%v", ok, err)
	}
}

func TestTokensRoundTrip(t *testing.T) {
	tokens := NewTokens("secret", time.Hour)
	for _, version := range []int32{0, 3} {
		tok, err := tokens.Issue(42, version)
		if err != nil {
			t.Fatal(err)
		}
		id, ver, err := tokens.Verify(tok)
		if err != nil || id != 42 || ver != version {
			t.Fatalf("Verify = %d, %d, %v; want 42, %d", id, ver, err, version)
		}
	}
	// Tokens from before versions existed (no `ver` claim) verify as version 0.
	legacy, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject: "42", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString([]byte("secret"))
	if id, ver, err := tokens.Verify(legacy); err != nil || id != 42 || ver != 0 {
		t.Fatalf("legacy token: %d, %d, %v", id, ver, err)
	}
}

// tamper flips one character of the token's signature segment.
func tamper(tok string) string {
	i := strings.LastIndexByte(tok, '.') + 1
	c := byte('A')
	if tok[i] == 'A' {
		c = 'B'
	}
	return tok[:i] + string(c) + tok[i+1:]
}

// nonCanonical returns tok with its last character swapped for one that differs only in the
// two unused low bits of a 43-character base64url HMAC-SHA256 signature: a lenient decoder
// reads the very same signature, so the variant would verify as another string for one token.
func nonCanonical(tok string) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	i := strings.IndexByte(alphabet, tok[len(tok)-1])
	return tok[:len(tok)-1] + string(alphabet[i^1])
}

func TestTokensRejects(t *testing.T) {
	tokens := NewTokens("secret", time.Hour)
	good, _ := tokens.Issue(7, 0)

	expired := NewTokens("secret", time.Hour)
	expired.now = func() time.Time { return time.Now().Add(-2 * time.Hour) }
	old, _ := expired.Issue(7, 0)

	other, _ := NewTokens("other-secret", time.Hour).Issue(7, 0)

	none := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.RegisteredClaims{Subject: "7", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))})
	noneTok, _ := none.SignedString(jwt.UnsafeAllowNoneSignatureType)

	noExp, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: "7"}).SignedString([]byte("secret"))
	badSub, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: "abc", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte("secret"))

	for name, tok := range map[string]string{
		"empty":     "",
		"garbage":   "a.b.c",
		"tampered":  tamper(good),
		"nonCanon":  nonCanonical(good),
		"expired":   old,
		"otherKey":  other,
		"algNone":   noneTok,
		"noExpiry":  noExp,
		"nonNumSub": badSub,
	} {
		if _, _, err := tokens.Verify(tok); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: expected ErrInvalidToken, got %v", name, err)
		}
	}
}
