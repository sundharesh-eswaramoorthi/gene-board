package service

import (
	"testing"

	"geneboard/internal/httpx"
)

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Caf\u00e9  ":               "Caf\u00e9",
		"Cafe\u0301":                  "Caf\u00e9", // NFD -> NFC
		"Caf\u00e9\u200b":             "Caf\u00e9", // zero-width space
		"\ufeff\u2060Caf\u00e9\u200e": "Caf\u00e9", // BOM, word joiner, left-to-right mark
		"\u3164Caf\u00e9\u00ad":       "Caf\u00e9", // Hangul filler, soft hyphen
		"\u200b\u200d":                "",
		"a\u200bb":                    "a\u200bb", // only the ends are trimmed
		// Emoji sequences keep their variation selectors, joiners and tags.
		"Love \u2764\ufe0f":          "Love \u2764\ufe0f",
		"\U0001F469\u200d\U0001F4BB": "\U0001F469\u200d\U0001F4BB",
		"Go \U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F": "Go \U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%+q) = %+q, want %+q", in, got, want)
		}
	}
}

func TestCheckLengthNeedsAVisibleCharacter(t *testing.T) {
	for value, required := range map[string]bool{
		"":              false,
		"\u200b":        false,
		"\u3164\u115f":  false, // Hangul fillers
		"\u0301\ufe0f":  false, // combining marks alone
		"\U000E0067":    false, // a tag character alone
		"x":             true,
		"\u2764\ufe0f":  true,
		"\u0600":        true, // Arabic number sign
		"\ue000":        true, // private use (icon fonts)
		"\u200b.\u200b": true,
	} {
		var fe httpx.FieldErrors
		checkLength(&fe, "name", value, 1, 40)
		if got := fe.Err() == nil; got != required {
			t.Errorf("checkLength(%+q) accepted = %v, want %v", value, got, required)
		}
	}
}

func TestEmailNormalisation(t *testing.T) {
	if got := normalizeEmail("  JOSE\u0301@Example.TEST "); got != "jos\u00e9@example.test" {
		t.Errorf("normalizeEmail = %+q", got)
	}
	for email, valid := range map[string]bool{
		"jos\u00e9@example.test":       true,
		"a.b+c@example.test":           true,
		"mimic\u200b@example.test":     false,
		"mimic@exam\u200dple.test":     false,
		"\ufeffmimic@example.test":     false,
		"mi\u00a0mic@example.test":     false,
		"mimic\u202e@example.test":     false,
		"mimic\ufe0f@example.test":     false,
		"mimic\U000E0041@example.test": false,
		"mimic\u0001@example.test":     false,
	} {
		if got := validEmail(email); got != valid {
			t.Errorf("validEmail(%+q) = %v, want %v", email, got, valid)
		}
	}
}
