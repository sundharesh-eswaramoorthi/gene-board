// Package ratelimit implements a small in-memory token-bucket limiter keyed by strings
// (client addresses, e-mail addresses, sessions). It is per process: good enough for one API
// instance, and it forgets everything on restart.
package ratelimit

import (
	"math"
	"sync"
	"time"
)

// sweepEvery bounds how often idle buckets are dropped.
const sweepEvery = time.Minute

// Limiter hands out up to Burst tokens per key, refilled at PerMinute tokens per minute.
type Limiter struct {
	perSecond float64
	burst     float64
	now       func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// New returns a limiter allowing burst requests at once per key and perMinute more every
// minute. Both must be positive.
func New(perMinute, burst int) *Limiter {
	return &Limiter{
		perSecond: float64(perMinute) / 60,
		burst:     float64(burst),
		now:       time.Now,
		buckets:   make(map[string]*bucket),
	}
}

// Allow takes a token for key. When none is left it returns false and how long until the
// next token.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.refill(key)
	if b.tokens < 1 {
		return false, l.wait(b)
	}
	b.tokens--
	return true, 0
}

// Refund gives back a token Allow took for key, never beyond the burst: a budget of failed
// attempts takes its token before the attempt (so concurrent attempts cannot all pass a
// check before any is counted) and refunds it when the attempt turns out not to count.
func (l *Limiter) Refund(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.refill(key)
	b.tokens = math.Min(l.burst, b.tokens+1)
}

// Reset forgets key, restoring its full burst.
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.buckets, key)
}

// refill returns key's bucket topped up for the time elapsed; l.mu must be held.
func (l *Limiter) refill(key string) *bucket {
	now := l.now()
	l.sweep(now)
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
		return b
	}
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens = math.Min(l.burst, b.tokens+elapsed*l.perSecond)
		b.last = now
	}
	return b
}

// wait is how long until b holds a whole token again.
func (l *Limiter) wait(b *bucket) time.Duration {
	missing := 1 - b.tokens
	return time.Duration(math.Ceil(missing / l.perSecond * float64(time.Second)))
}

// sweep drops buckets that have refilled completely (they are indistinguishable from new
// ones), so the map only holds recently active keys; l.mu must be held.
func (l *Limiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < sweepEvery {
		return
	}
	l.lastSweep = now
	for key, b := range l.buckets {
		if b.tokens+now.Sub(b.last).Seconds()*l.perSecond >= l.burst {
			delete(l.buckets, key)
		}
	}
}

// Len returns the number of tracked keys (for tests and metrics).
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
