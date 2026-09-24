package api

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"geneboard/internal/dto"
)

// linkHistory renders the link rows of an activity list as "action: newValue", newest first.
func linkHistory(rows []dto.Activity) []string {
	var out []string
	for _, a := range rows {
		if a.Action == "link.created" || a.Action == "link.deleted" {
			out = append(out, a.Action+": "+deref(a.NewValue))
		}
	}
	return out
}

// TestLinkHistoryHidesInaccessibleProjects: a link to an issue in a project the reader is not
// a member of is hidden from them, and so is that issue's key in the link's history (issue
// history, project activity and the feed), until they join the project.
func TestLinkHistoryHidesInaccessibleProjects(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	member := e.createUser("Member")
	e.createProject(owner, "GB")
	e.createProject(owner, "SEC")
	e.addMember(owner, "GB", member, "member")
	a := e.newIssue(owner, "GB", "task", "A", nil)
	b := e.newIssue(owner, "GB", "task", "B", nil)
	secret := e.newIssue(owner, "SEC", "task", "Secret", nil)

	linksPath := "/api/issues/" + a.Key + "/links"
	cross := decodeAs[dto.IssueLink](t, e.do(http.MethodPost, linksPath, owner.Token,
		map[string]any{"type": "blocks", "targetKey": secret.Key}), http.StatusCreated)
	decodeAs[dto.IssueLink](t, e.do(http.MethodPost, linksPath, owner.Token,
		map[string]any{"type": "relates", "targetKey": b.Key}), http.StatusCreated)
	// Members of the source project may remove the link (SPEC §5), seen or not.
	expectStatus(t, e.do(http.MethodDelete, "/api/issue-links/"+itoa(cross.ID), member.Token, nil), http.StatusNoContent)

	visible := []string{"link.deleted: blocks SEC-1", "link.created: relates to GB-2", "link.created: blocks SEC-1"}
	hidden := []string{
		"link.deleted: blocks an issue in another project",
		"link.created: relates to GB-2",
		"link.created: blocks an issue in another project",
	}
	expectHistory := func(u testUser, want []string) {
		t.Helper()
		feed := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/activity?limit=200", u.Token, nil), http.StatusOK)
		for where, rows := range map[string][]dto.Activity{
			"issue history":    e.issueActivity(u, a.Key),
			"project activity": e.projectActivity(u, "GB"),
			"feed":             feed,
		} {
			if got := linkHistory(rows); !slices.Equal(got, want) {
				t.Fatalf("%s's %s = %q, want %q", u.Name, where, got, want)
			}
		}
	}
	expectHistory(owner, visible)
	expectHistory(member, hidden)

	e.addMember(owner, "SEC", member, "viewer")
	expectHistory(member, visible)
}

// TestCommentHistoryShowsCurrentText: comment.created rows preview the comment's current
// text, so text edited out of a comment, or deleted with the comment or its issue, cannot be
// read in the history any more (nor stays stored in the activity log).
func TestCommentHistoryShowsCurrentText(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	viewer := e.createUser("Viewer")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", viewer, "viewer")
	issue := e.newIssue(admin, "GB", "task", "Discuss", nil)
	gone := e.newIssue(admin, "GB", "task", "Gone", nil)
	comment := func(issueKey, body string) dto.Comment {
		t.Helper()
		return decodeAs[dto.Comment](t, e.do(http.MethodPost, "/api/issues/"+issueKey+"/comments", admin.Token,
			map[string]any{"body": body}), http.StatusCreated)
	}
	// previews returns the comment.created previews of rows, newest first.
	previews := func(rows []dto.Activity) []string {
		t.Helper()
		var out []string
		for _, a := range activitiesFor(rows, "comment.created", "") {
			out = append(out, deref(a.NewValue))
		}
		return out
	}

	leaked := comment(issue.Key, "oops, the prod password is hunter2")
	long := strings.Repeat("é", 250)
	comment(issue.Key, long)
	if got := previews(e.issueActivity(viewer, issue.Key)); !slices.Equal(got, []string{long[:400], "oops, the prod password is hunter2"}) {
		t.Fatalf("previews = %q", got)
	}

	leakedPath := "/api/comments/" + itoa(leaked.ID)
	decodeAs[dto.Comment](t, e.do(http.MethodPatch, leakedPath, admin.Token, map[string]any{"body": "[redacted]"}), http.StatusOK)
	if got := previews(e.issueActivity(viewer, issue.Key)); !slices.Equal(got, []string{long[:400], "[redacted]"}) {
		t.Fatalf("previews after the edit = %q", got)
	}
	expectStatus(t, e.do(http.MethodDelete, leakedPath, admin.Token, nil), http.StatusNoContent)
	if got := previews(e.issueActivity(viewer, issue.Key)); !slices.Equal(got, []string{long[:400], "<nil>"}) {
		t.Fatalf("previews after the delete = %q", got)
	}

	comment(gone.Key, "a secret on an issue about to be deleted")
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+gone.Key, admin.Token, nil), http.StatusNoContent)
	feed := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/activity?limit=200", viewer.Token, nil), http.StatusOK)
	for where, rows := range map[string][]dto.Activity{"project activity": e.projectActivity(viewer, "GB"), "feed": feed} {
		if got := previews(rows); !slices.Equal(got, []string{"<nil>", long[:400], "<nil>"}) {
			t.Fatalf("%s previews = %q", where, got)
		}
	}
	var stored int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FROM activities WHERE new_value LIKE '%secret%' OR new_value LIKE '%hunter2%'`).Scan(&stored); err != nil || stored != 0 {
		t.Fatalf("activity rows storing comment text: %d (%v)", stored, err)
	}
}

// TestNamesSortWithTheirBaseLetter: name-ordered lists (members, the user directory, labels,
// an issue's labels and their history, issue search by summary) sort accented names with
// their base letter, as the UI does, not after "Z" (code-point order).
func TestNamesSortWithTheirBaseLetter(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	e.createProject(owner, "GB")
	for i, name := range []string{"Zoe Adams", "Émile Martin", "Ángel Ruiz", "bob Smith"} {
		res := decodeAs[dto.AuthResponse](t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
			"email": "user" + itoa(int64(i)) + "@example.test", "name": name, "password": testPassword,
		}), http.StatusCreated)
		e.addMember(owner, "GB", testUser{ID: res.User.ID, Name: name, Email: res.User.Email}, "member")
	}
	wantPeople := []string{"Ángel Ruiz", "bob Smith", "Émile Martin", "Owner", "Zoe Adams"}

	var members []string
	for _, m := range decodeAs[[]dto.Member](t, e.do(http.MethodGet, "/api/projects/GB/members", owner.Token, nil), http.StatusOK) {
		members = append(members, m.User.Name)
	}
	if !slices.Equal(members, wantPeople) {
		t.Fatalf("members = %q, want %q", members, wantPeople)
	}
	var users []string
	for _, u := range decodeAs[[]dto.UserSummary](t, e.do(http.MethodGet, "/api/users?limit=50", owner.Token, nil), http.StatusOK) {
		users = append(users, u.Name)
	}
	if !slices.Equal(users, wantPeople) {
		t.Fatalf("users = %q, want %q", users, wantPeople)
	}

	var labelIDs []int64
	for _, name := range []string{"Zeta", "Öffentlich", "alpha", "Ärger"} {
		labelIDs = append(labelIDs, e.createLabel(owner, "GB", name).ID)
	}
	wantLabels := []string{"alpha", "Ärger", "Öffentlich", "Zeta"}
	labelNames := func(labels []dto.Label) []string {
		names := make([]string, len(labels))
		for i, l := range labels {
			names[i] = l.Name
		}
		return names
	}
	projectLabels := decodeAs[[]dto.Label](t, e.do(http.MethodGet, "/api/projects/GB/labels", owner.Token, nil), http.StatusOK)
	if got := labelNames(projectLabels); !slices.Equal(got, wantLabels) {
		t.Fatalf("project labels = %q, want %q", got, wantLabels)
	}
	issue := e.newIssue(owner, "GB", "task", "Zebra crossing", nil)
	if got := labelNames(e.patchIssue(owner, issue.Key, map[string]any{"labelIds": labelIDs}).Labels); !slices.Equal(got, wantLabels) {
		t.Fatalf("issue labels = %q, want %q", got, wantLabels)
	}
	var changes []string
	for _, a := range activitiesFor(e.issueActivity(owner, issue.Key), "issue.updated", "labels") {
		changes = append(changes, deref(a.NewValue))
	}
	if want := []string{strings.Join(wantLabels, ", ")}; !slices.Equal(changes, want) {
		t.Fatalf("labels activity = %q, want %q", changes, want)
	}

	e.newIssue(owner, "GB", "task", "Éditer le profil", nil)
	e.newIssue(owner, "GB", "task", "apple pie", nil)
	var summaries []string
	for _, is := range e.searchIssues(owner, "project=GB&sort=summary").Items {
		summaries = append(summaries, is.Summary)
	}
	if want := []string{"apple pie", "Éditer le profil", "Zebra crossing"}; !slices.Equal(summaries, want) {
		t.Fatalf("issues by summary = %q, want %q", summaries, want)
	}

	for key, name := range map[string]string{"ZU": "Zulu Ops", "EV": "Élan Vital", "AT": "atlas"} {
		expectStatus(t, e.do(http.MethodPost, "/api/projects", owner.Token, map[string]any{"key": key, "name": name}), http.StatusCreated)
	}
	var projects []string
	for _, p := range decodeAs[[]dto.Project](t, e.do(http.MethodGet, "/api/projects", owner.Token, nil), http.StatusOK) {
		projects = append(projects, p.Name)
	}
	if want := []string{"atlas", "Élan Vital", "GB Project", "Zulu Ops"}; !slices.Equal(projects, want) {
		t.Fatalf("projects = %q, want %q", projects, want)
	}
}
