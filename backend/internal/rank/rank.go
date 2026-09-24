// Package rank implements fractional indexing: rank keys are strings over the alphabet
// 0-9a-z that sort byte-wise (the issues.rank column uses COLLATE "C"), and a new key can
// always be generated strictly between any two existing keys.
//
// A key is read as a base-36 fraction 0.d1d2d3…; because no valid key ends in '0', distinct
// keys always denote distinct fractions, so byte-wise order equals numeric order.
//
// Between chooses keys so that the common operations stay short:
//   - both bounds given: the classic midpoint (key length grows by ~1 char per 5 insertions
//     into the same gap, which is inherent to fractional indexing);
//   - only a lower bound (append at the end): an increment within "length classes"
//     (a run of c leading 'z's is followed by c+1 significant digits), so n consecutive
//     appends produce keys of length O(log n);
//   - only an upper bound (insert at the start): the mirror image using leading '0's.
package rank

import (
	"errors"
	"fmt"
	"strings"
)

const (
	alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	base     = len(alphabet)
	minDigit = '0'
	maxDigit = 'z'
)

// First is the key produced for an empty list: Between("", "").
const First = "i"

var (
	// ErrInvalidKey reports a malformed rank key.
	ErrInvalidKey = errors.New("rank: invalid key")
	// ErrOutOfOrder reports prev >= next.
	ErrOutOfOrder = errors.New("rank: prev must sort before next")
)

// Valid reports whether key is a well-formed rank key: non-empty, only 0-9a-z, and not
// ending in '0'.
func Valid(key string) bool {
	if key == "" || key[len(key)-1] == minDigit {
		return false
	}
	for i := 0; i < len(key); i++ {
		if digit(key[i]) < 0 {
			return false
		}
	}
	return true
}

// Between returns a key k with prev < k < next. An empty prev means "no lower bound" and an
// empty next means "no upper bound". Both non-empty arguments must be valid keys and
// prev must be less than next.
func Between(prev, next string) (string, error) {
	if prev != "" && !Valid(prev) {
		return "", fmt.Errorf("%w: %q", ErrInvalidKey, prev)
	}
	if next != "" && !Valid(next) {
		return "", fmt.Errorf("%w: %q", ErrInvalidKey, next)
	}
	switch {
	case prev == "" && next == "":
		return First, nil
	case next == "":
		return after(prev), nil
	case prev == "":
		return before(next), nil
	case prev >= next:
		return "", fmt.Errorf("%w: %q >= %q", ErrOutOfOrder, prev, next)
	default:
		return midpoint(prev, next), nil
	}
}

// after returns a short key greater than a (a valid key).
//
// Let c be the number of leading 'z's in a and D the next c+1 digits (padded with '0').
// The result is "z"*c + (D+1) with trailing zeros removed. D's first digit is never 'z',
// so the increment cannot overflow; when it turns into 'z' the key enters the next class.
func after(a string) string {
	c := leadingRun(a, maxDigit)
	d := window(a, c, c+1)
	for i := len(d) - 1; i >= 0; i-- { // add one with carry
		if d[i] != maxDigit {
			d[i] = alphabet[digit(d[i])+1]
			break
		}
		d[i] = minDigit
	}
	return strings.Repeat(string(maxDigit), c) + trimZeros(string(d))
}

// before returns a short key less than b (a valid key).
//
// Let c be the number of leading '0's in b and D the next c+1 digits (padded with '0');
// D's first digit is non-zero. The result is "0"*c + (D-1). If the decrement would make the
// first digit '0', the key moves to the top of the next class: "0"*(c+1) + "z"*(c+2).
func before(b string) string {
	c := leadingRun(b, minDigit)
	d := window(b, c, c+1)
	for i := len(d) - 1; i >= 0; i-- { // subtract one with borrow
		if d[i] != minDigit {
			d[i] = alphabet[digit(d[i])-1]
			break
		}
		d[i] = maxDigit
	}
	if d[0] == minDigit {
		return strings.Repeat(string(minDigit), c+1) + strings.Repeat(string(maxDigit), c+2)
	}
	return strings.Repeat(string(minDigit), c) + trimZeros(string(d))
}

// midpoint returns a key strictly between a and b, where a == "" stands for 0 and b == ""
// stands for 1. Preconditions: a < b and neither ends in '0'.
func midpoint(a, b string) string {
	if b != "" {
		// Skip the common prefix, reading a as if padded with '0's.
		n := 0
		for n < len(b) && charAt(a, n) == b[n] {
			n++
		}
		if n > 0 {
			return b[:n] + midpoint(suffix(a, n), b[n:])
		}
	}
	da, db := 0, base
	if a != "" {
		da = digit(a[0])
	}
	if b != "" {
		db = digit(b[0])
	}
	if db-da > 1 {
		return string(alphabet[(da+db)/2])
	}
	// The first digits are consecutive.
	if len(b) > 1 {
		// b's first digit alone is > a and, as b has a non-zero tail, < b.
		return b[:1]
	}
	return string(alphabet[da]) + midpoint(suffix(a, 1), "")
}

// digit returns the value of c in the alphabet, or -1.
func digit(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'z':
		return int(c-'a') + 10
	default:
		return -1
	}
}

func charAt(s string, i int) byte {
	if i < len(s) {
		return s[i]
	}
	return minDigit
}

func suffix(s string, i int) string {
	if i >= len(s) {
		return ""
	}
	return s[i:]
}

func leadingRun(s string, c byte) int {
	n := 0
	for n < len(s) && s[n] == c {
		n++
	}
	return n
}

// window returns s[from:from+n] as a mutable byte slice, padded with '0'.
func window(s string, from, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = charAt(s, from+i)
	}
	return out
}

func trimZeros(s string) string { return strings.TrimRight(s, string(minDigit)) }
