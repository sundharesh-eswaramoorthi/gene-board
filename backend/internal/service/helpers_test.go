package service

import (
	"net/url"
	"slices"
	"testing"
	"time"

	"geneboard/internal/httpx"
)

func TestParseIssueSearch(t *testing.T) {
	v, _ := url.ParseQuery("project=gb&q=+crash+&type=bug,Task&type=&statusId=3, 4&assigneeId=me,none,7&reporterId=me" +
		"&sprintId=active,none,9&epicId=5&resolved=FALSE&sort=updated&limit=500&offset=10&labelId=1&priority=HIGH")
	s, err := ParseIssueSearch(v)
	if err != nil {
		t.Fatal(err)
	}
	if s.ProjectKey != "GB" || s.Text != "crash" || !slices.Equal(s.Types, []string{"bug", "task"}) ||
		!slices.Equal(s.StatusIDs, []int64{3, 4}) || !s.AssigneeMe || !s.AssigneeNone || !slices.Equal(s.AssigneeIDs, []int64{7}) ||
		!s.ReporterMe || !s.SprintActive || !s.SprintNone || !slices.Equal(s.SprintIDs, []int64{9}) ||
		s.ParentID == nil || *s.ParentID != 5 || s.Resolved == nil || *s.Resolved || s.Sort != "updated" || !s.Descending ||
		s.Limit != MaxIssueSearchLimit || s.Offset != 10 || !slices.Equal(s.Priorities, []string{"high"}) {
		t.Fatalf("parsed: %+v", s)
	}

	def, err := ParseIssueSearch(url.Values{})
	if err != nil || def.Sort != "rank" || def.Descending || def.Limit != DefaultIssueSearchLimit || def.Offset != 0 {
		t.Fatalf("defaults: %+v %v", def, err)
	}
	if asc, _ := ParseIssueSearch(url.Values{"sort": {"created"}, "order": {"asc"}}); asc.Descending {
		t.Fatal("explicit order must win")
	}

	for _, q := range []string{"type=x", "statusId=0", "assigneeId=abc", "sort=nope", "order=sideways", "limit=0", "offset=-2", "resolved=1", "parentId=-3"} {
		v, _ := url.ParseQuery(q)
		if _, err := ParseIssueSearch(v); !httpx.IsCode(err, httpx.CodeBadRequest) {
			t.Errorf("%s: want bad_request, got %v", q, err)
		}
	}
}

func TestLinkLabels(t *testing.T) {
	cases := map[[2]string]string{
		{"blocks", DirectionOutward}:     "blocks",
		{"blocks", DirectionInward}:      "is blocked by",
		{"relates", DirectionOutward}:    "relates to",
		{"relates", DirectionInward}:     "relates to",
		{"duplicates", DirectionOutward}: "duplicates",
		{"duplicates", DirectionInward}:  "is duplicated by",
		{"clones", DirectionOutward}:     "clones",
		{"clones", DirectionInward}:      "is cloned by",
	}
	for in, want := range cases {
		if got := linkLabel(in[0], in[1]); got != want {
			t.Errorf("linkLabel(%s, %s) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestResolvedAtFor(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	earlier := now.Add(-time.Hour)
	if got := resolvedAtFor(nil, "todo", "done", now); got == nil || !got.Equal(now) {
		t.Fatal("entering done sets now")
	}
	if got := resolvedAtFor(&earlier, "done", "done", now); got == nil || !got.Equal(earlier) {
		t.Fatal("done -> done keeps the original resolution time")
	}
	if got := resolvedAtFor(&earlier, "done", "in_progress", now); got != nil {
		t.Fatal("leaving done clears")
	}
	if got := resolvedAtFor(nil, "todo", "in_progress", now); got != nil {
		t.Fatal("non-done stays unresolved")
	}
}

func TestSmallHelpers(t *testing.T) {
	if projectKeyOf("GB-12") != "GB" || projectKeyOf("AB1-7") != "AB1" {
		t.Fatal("projectKeyOf")
	}
	if escapeLike(`50%_off\`) != `50\%\_off\\` {
		t.Fatalf("escapeLike = %q", escapeLike(`50%_off\`))
	}
	for email, ok := range map[string]bool{
		"a@b.co": true, "first.last@sub.example.test": true, "no-at-sign": false, "a@b": false,
		"Name <a@b.co>": false, "a@b.": false, "@b.co": false, "a b@c.co": false,
	} {
		if validEmail(email) != ok {
			t.Errorf("validEmail(%q) != %v", email, ok)
		}
	}
	if got := dedupeIDs([]int64{3, 1, 3, 2}); !slices.Equal(got, []int64{1, 2, 3}) {
		t.Fatalf("dedupeIDs = %v", got)
	}
	if got := dedupeIDs(nil); got == nil || len(got) != 0 {
		t.Fatal("dedupeIDs(nil) must be empty, non-nil")
	}
	if r, ok := parseRole(" Admin "); !ok || r != RoleAdmin {
		t.Fatal("parseRole")
	}
	if _, ok := parseRole("owner"); ok {
		t.Fatal("parseRole accepted owner")
	}
	if !RoleAdmin.AtLeast(RoleMember) || RoleViewer.AtLeast(RoleMember) || Role("x").AtLeast(Role("y")) {
		t.Fatal("AtLeast")
	}
}
