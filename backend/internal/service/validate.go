package service

import (
	"fmt"
	"net/mail"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"geneboard/internal/dto"
	"geneboard/internal/httpx"
)

var (
	projectKeyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)
	hexColorPattern   = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

// Field limits.
const (
	maxUserName       = 100
	minPassword       = 8
	maxPasswordBytes  = 72 // bcrypt input limit
	maxEmail          = 254
	maxProjectName    = 80
	maxStatusName     = 40
	maxLabelName      = 40
	maxSummary        = 255
	maxIssueDesc      = 32767 // characters (Jira's limit); keeps list payloads bounded
	maxProjectDesc    = 4000
	maxSprintName     = 80
	maxSprintGoal     = 1000
	maxCommentBody    = 10000
	maxWipLimit       = 9999
	maxStoryPoints    = 1000
	defaultLabelColor = "#6B778C"
	commentPreviewLen = 200
)

// Allowed enum values.
var (
	issueTypes       = []string{dto.IssueTypeEpic, dto.IssueTypeStory, dto.IssueTypeTask, dto.IssueTypeBug, dto.IssueTypeSubtask}
	standardTypes    = []string{dto.IssueTypeStory, dto.IssueTypeTask, dto.IssueTypeBug}
	priorities       = []string{dto.PriorityHighest, dto.PriorityHigh, dto.PriorityMedium, dto.PriorityLow, dto.PriorityLowest}
	statusCategories = []string{dto.CategoryTodo, dto.CategoryInProgress, dto.CategoryDone}
	projectTypes     = []string{dto.ProjectTypeScrum, dto.ProjectTypeKanban}
	linkTypes        = []string{dto.LinkBlocks, dto.LinkRelates, dto.LinkDuplicates, dto.LinkClones}
	sprintStates     = []string{dto.SprintPlanned, dto.SprintActive, dto.SprintCompleted}
	projectRoles     = []string{string(RoleAdmin), string(RoleMember), string(RoleViewer)}
)

// isStandardType reports whether t is story, task or bug.
func isStandardType(t string) bool { return slices.Contains(standardTypes, t) }

func oneOf(values []string) string { return "must be one of " + strings.Join(values, ", ") }

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// checkLength validates a (trimmed) string's length in characters. Text PostgreSQL cannot
// store (NUL characters) is rejected too, so every free-text field is checked through here.
func checkLength(fe *httpx.FieldErrors, field, value string, minLen, maxLen int) {
	n := runeLen(value)
	switch {
	case !httpx.ValidText(value):
		fe.Add(field, msgInvalidText)
	case minLen > 0 && n == 0:
		fe.Add(field, "is required")
	case n < minLen:
		fe.Add(field, fmt.Sprintf("must be at least %d characters", minLen))
	case n > maxLen:
		fe.Add(field, fmt.Sprintf("must be at most %d characters", maxLen))
	}
}

// msgInvalidText reports text with NUL characters (JSON "\u0000"), which cannot be stored.
const msgInvalidText = "must not contain NUL characters"

// checkEnum validates that value is one of values.
func checkEnum(fe *httpx.FieldErrors, field, value string, values []string) {
	if !slices.Contains(values, value) {
		fe.Add(field, oneOf(values))
	}
}

// checkPassword validates a new password. Passwords are never trimmed.
func checkPassword(fe *httpx.FieldErrors, field, password string) {
	switch {
	case password == "":
		fe.Add(field, "is required")
	case runeLen(password) < minPassword:
		fe.Add(field, fmt.Sprintf("must be at least %d characters", minPassword))
	case len(password) > maxPasswordBytes:
		fe.Add(field, fmt.Sprintf("must be at most %d bytes", maxPasswordBytes))
	}
}

// checkEmail validates a normalised e-mail address.
func checkEmail(fe *httpx.FieldErrors, field, email string) {
	switch {
	case email == "":
		fe.Add(field, "is required")
	case !httpx.ValidText(email) || !validEmail(email):
		fe.Add(field, "must be a valid email address")
	}
}

// normalizeEmail trims and lower-cases an e-mail address.
func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// validEmail accepts plain "local@domain.tld" addresses.
func validEmail(email string) bool {
	if len(email) > maxEmail {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || addr.Name != "" {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	domain := email[at+1:]
	return at > 0 && strings.Contains(domain, ".") && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}

// escapeLike escapes LIKE/ILIKE wildcards so user input matches literally.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// truncateRunes shortens s to at most n characters.
func truncateRunes(s string, n int) string {
	if runeLen(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// dedupeIDs returns the distinct ids in ascending order (never nil).
func dedupeIDs(ids []int64) []int64 {
	out := slices.Clone(ids)
	if out == nil {
		out = []int64{}
	}
	slices.Sort(out)
	return slices.Compact(out)
}
