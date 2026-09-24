package ratelimit

import (
	"testing"
	"time"
)

// fakeClock returns a limiter whose clock the test advances by hand.
func fakeClock(perMinute, burst int) (*Limiter, *time.Time) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	l := New(perMinute, burst)
	l.now = func() time.Time { return now }
	return l, &now
}

func TestAllowSpendsTheBurstThenRefills(t *testing.T) {
	l, now := fakeClock(6, 3) // one token every 10s
	for i := range 3 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d refused within the burst", i)
		}
	}
	ok, wait := l.Allow("a")
	if ok || wait != 10*time.Second {
		t.Fatalf("4th request: ok=%v wait=%s, want refused for 10s", ok, wait)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("keys must not share a bucket")
	}
	*now = now.Add(5 * time.Second)
	if ok, wait := l.Allow("a"); ok || wait != 5*time.Second {
		t.Fatalf("after 5s: ok=%v wait=%s", ok, wait)
	}
	*now = now.Add(5 * time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("a token must be back after 10s")
	}
}

func TestRefundAndReset(t *testing.T) {
	l, _ := fakeClock(1, 2)
	l.Allow("x")
	l.Refund("x")
	l.Refund("x") // never beyond the burst
	for i := range 2 {
		if ok, _ := l.Allow("x"); !ok {
			t.Fatalf("request %d refused after the refund", i)
		}
	}
	if ok, wait := l.Allow("x"); ok || wait != time.Minute {
		t.Fatalf("3rd request: ok=%v wait=%s, want refused for 1m", ok, wait)
	}
	l.Refund("x")
	if ok, _ := l.Allow("x"); !ok {
		t.Fatal("a refunded token must be usable")
	}
	l.Reset("x")
	for i := range 2 {
		if ok, _ := l.Allow("x"); !ok {
			t.Fatalf("request %d refused: reset restores the burst", i)
		}
	}
}

func TestIdleBucketsAreSwept(t *testing.T) {
	l, now := fakeClock(60, 5)
	for _, k := range []string{"a", "b", "c"} {
		l.Allow(k)
	}
	if l.Len() != 3 {
		t.Fatalf("len = %d", l.Len())
	}
	*now = now.Add(2 * time.Minute)
	l.Allow("d") // triggers a sweep: a, b and c refilled completely
	if l.Len() != 1 {
		t.Fatalf("len after sweep = %d, want 1", l.Len())
	}
}
