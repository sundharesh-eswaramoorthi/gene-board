package rank

import (
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
)

// mustBetween calls Between and verifies the full contract.
func mustBetween(t testing.TB, prev, next string) string {
	t.Helper()
	k, err := Between(prev, next)
	if err != nil {
		t.Fatalf("Between(%q, %q): %v", prev, next, err)
	}
	if !Valid(k) {
		t.Fatalf("Between(%q, %q) = %q: invalid key", prev, next, k)
	}
	if strings.HasSuffix(k, "0") {
		t.Fatalf("Between(%q, %q) = %q ends in '0'", prev, next, k)
	}
	if prev != "" && !(prev < k) {
		t.Fatalf("Between(%q, %q) = %q: not greater than prev", prev, next, k)
	}
	if next != "" && !(k < next) {
		t.Fatalf("Between(%q, %q) = %q: not less than next", prev, next, k)
	}
	return k
}

func TestValid(t *testing.T) {
	for _, k := range []string{"1", "i", "z", "0i", "00001", "zzz", "a0b", "9"} {
		if !Valid(k) {
			t.Errorf("Valid(%q) = false", k)
		}
	}
	for _, k := range []string{"", "0", "00", "10", "A", "a-b", "é", "a b", "i\x00", "Z"} {
		if Valid(k) {
			t.Errorf("Valid(%q) = true", k)
		}
	}
}

func TestBetweenTable(t *testing.T) {
	cases := []struct{ prev, next, want string }{
		{"", "", "i"},
		{"a", "c", "b"},
		{"a", "b", "ai"},
		{"1", "2", "1i"},
		{"0i", "1", "0r"},
		{"1", "101", "100i"},
		{"", "1", "0zz"},
		{"y", "", "z"},
		{"z", "", "z01"},
		{"i", "", "j"},
		{"", "i", "h"},
		{"az", "b", "azi"},
		{"a1", "a2", "a1i"},
		{"zz", "", "zz001"},
		{"0zz", "", "1"},
	}
	for _, c := range cases {
		got := mustBetween(t, c.prev, c.next)
		if got != c.want {
			t.Errorf("Between(%q, %q) = %q, want %q", c.prev, c.next, got, c.want)
		}
	}
}

func TestBetweenInvalidInput(t *testing.T) {
	invalid := []struct{ prev, next string }{
		{"A", ""}, {"", "B"}, {"10", ""}, {"", "0"}, {"a-", "b"}, {"a", "b0"}, {"é", ""},
	}
	for _, c := range invalid {
		if _, err := Between(c.prev, c.next); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Between(%q, %q): want ErrInvalidKey, got %v", c.prev, c.next, err)
		}
	}
	order := []struct{ prev, next string }{{"b", "a"}, {"a", "a"}, {"z", "y"}, {"a1", "a"}}
	for _, c := range order {
		if _, err := Between(c.prev, c.next); !errors.Is(err, ErrOutOfOrder) {
			t.Errorf("Between(%q, %q): want ErrOutOfOrder, got %v", c.prev, c.next, err)
		}
	}
}

func TestBounds(t *testing.T) {
	// Keys at the extremes of the key space.
	mustBetween(t, "", "00000000001")
	mustBetween(t, "zzzzzzzzzz", "")
	mustBetween(t, "zzzzzzzzzy", "zzzzzzzzzz")
	mustBetween(t, "0000000001", "0000000002")
	mustBetween(t, "1", "10000000001")
	mustBetween(t, "yzzzzzzzzz", "z")
	mustBetween(t, "", "z")
	mustBetween(t, "1", "")
	mustBetween(t, "", strings.Repeat("0", 500)+"1")
	mustBetween(t, strings.Repeat("z", 500), "")
}

func TestRepeatedAppendStaysShort(t *testing.T) {
	last := ""
	maxLen := 0
	for range 5000 {
		last = mustBetween(t, last, "")
		maxLen = max(maxLen, len(last))
	}
	// 5000 appends fit in classes 0..2 (lengths 1, 3, 5).
	if maxLen > 5 {
		t.Fatalf("appending 5000 keys produced a key of length %d", maxLen)
	}
}

func TestRepeatedPrependStaysShort(t *testing.T) {
	first := ""
	maxLen := 0
	for range 5000 {
		first = mustBetween(t, "", first)
		maxLen = max(maxLen, len(first))
	}
	if maxLen > 7 {
		t.Fatalf("prepending 5000 keys produced a key of length %d", maxLen)
	}
}

func TestRepeatedInsertionSameGap(t *testing.T) {
	// Always insert directly after a fixed key (the gap shrinks towards `lo`).
	// Each new key must be below the previous one, i.e. the sequence is strictly decreasing.
	lo, hi := "a", "b"
	cur := hi
	for range 1000 {
		cur = mustBetween(t, lo, cur)
	}
	// Always insert directly before a fixed key: strictly increasing sequence.
	cur = lo
	for range 1000 {
		cur = mustBetween(t, cur, hi)
	}
	// The same, with no bound on the far side.
	cur = ""
	for range 1000 {
		cur = mustBetween(t, "m", cur)
	}
	cur = ""
	for range 1000 {
		cur = mustBetween(t, cur, "m")
	}
}

func TestAlternatingGap(t *testing.T) {
	lo, hi := "", ""
	for i := range 2000 {
		k := mustBetween(t, lo, hi)
		if i%2 == 0 {
			lo = k
		} else {
			hi = k
		}
	}
}

// TestRandomInsertions performs thousands of insertions at random positions of an ordered
// list and checks that the list stays strictly ordered with valid, unique keys.
func TestRandomInsertions(t *testing.T) {
	for seed := range uint64(5) {
		rng := rand.New(rand.NewPCG(seed, 0x9e3779b97f4a7c15))
		var keys []string
		for op := range 4000 {
			pos := rng.IntN(len(keys) + 1)
			// Bias some operations towards the ends and one hot spot, like real boards.
			switch r := rng.IntN(10); {
			case r == 0:
				pos = 0
			case r == 1:
				pos = len(keys)
			case r == 2 && len(keys) > 0:
				pos = len(keys) / 2
			}
			prev, next := "", ""
			if pos > 0 {
				prev = keys[pos-1]
			}
			if pos < len(keys) {
				next = keys[pos]
			}
			k := mustBetween(t, prev, next)
			keys = slices.Insert(keys, pos, k)
			if op%500 == 0 {
				assertStrictlySorted(t, keys)
			}
		}
		assertStrictlySorted(t, keys)
	}
}

func assertStrictlySorted(t *testing.T, keys []string) {
	t.Helper()
	for i := 1; i < len(keys); i++ {
		if !(keys[i-1] < keys[i]) {
			t.Fatalf("keys not strictly ordered at %d: %q !< %q", i, keys[i-1], keys[i])
		}
	}
}

// FuzzBetween checks the contract for arbitrary valid key pairs. `go test` runs the seed
// corpus; run `go test -fuzz=FuzzBetween ./internal/rank` for open-ended fuzzing.
func FuzzBetween(f *testing.F) {
	for _, s := range [][2]string{{"", ""}, {"a", "b"}, {"1", "101"}, {"", "1"}, {"zz", ""}, {"0001", "0002"}, {"hzzz", "i"}} {
		f.Add(s[0], s[1])
	}
	f.Fuzz(func(t *testing.T, a, b string) {
		if (a != "" && !Valid(a)) || (b != "" && !Valid(b)) {
			if _, err := Between(a, b); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("Between(%q, %q): want ErrInvalidKey, got %v", a, b, err)
			}
			return
		}
		if a != "" && b != "" && a >= b {
			a, b = b, a
			if a == b {
				return
			}
		}
		mustBetween(t, a, b)
	})
}
