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

func TestTakeCheckAndReset(t *testing.T) {
	l, now := fakeClock(1, 2)
	l.Take("x")
	l.Take("x")
	if ok, _ := l.Check("x"); ok {
		t.Fatal("no token left after two failures")
	}
	l.Take("x") // goes negative: the wait grows
	if _, wait := l.Check("x"); wait != 2*time.Minute {
		t.Fatalf("wait = %s, want 2m", wait)
	}
	*now = now.Add(2 * time.Minute)
	if ok, _ := l.Check("x"); !ok {
		t.Fatal("token expected after the wait")
	}
	l.Take("x")
	l.Reset("x")
	if ok, _ := l.Check("x"); !ok {
		t.Fatal("reset restores the burst")
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
