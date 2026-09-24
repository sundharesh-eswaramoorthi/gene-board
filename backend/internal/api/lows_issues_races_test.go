package api

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"geneboard/internal/dto"
)

// Writes check the caller's access before they wait for the project lock. Whatever another
// change holding that lock did meanwhile — demote or remove the caller, switch the project
// to Kanban, delete the project — must be seen once the lock is acquired: these tests queue
// requests behind such a change (staged in a side transaction, see concurrency_test.go) and
// check they are refused as if they had arrived after it.

// pendingRequest is a request started while a side transaction holds the project lock.
type pendingRequest struct {
	method, path, token string
	body                any
}

// behindProjectChange locks the project row in a side transaction, applies change there,
// starts reqs one after the other (each passes its access checks, then queues on the lock),
// commits the change and returns the responses in order.
func (e *testEnv) behindProjectChange(projectKey string, change func(tx pgx.Tx), reqs ...pendingRequest) []*testResponse {
	e.t.Helper()
	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM projects WHERE key = $1 FOR NO KEY UPDATE`, projectKey)
	change(tx)
	pending := make([]<-chan *testResponse, len(reqs))
	for i, r := range reqs {
		pending[i] = e.async(r.method, r.path, r.token, r.body)
		e.waitForLockWaiters(i + 1)
	}
	e.sideCommit(tx)
	out := make([]*testResponse, len(reqs))
	for i, ch := range pending {
		out[i] = <-ch
	}
	return out
}

// An admin's requests already in flight when another admin demotes them to viewer cannot
// undo the demotion, manage members or delete the project.
func TestInFlightRequestsOfADemotedAdminAreRefused(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	dave := e.createUser("Dave")
	mia := e.createUser("Mia")
	p := e.createProject(owner, "GB")
	e.addMember(owner, "GB", dave, "admin")
	e.addMember(owner, "GB", mia, "admin")
	demoteDave := func(tx pgx.Tx) {
		e.sideExec(tx, `UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2`, p.ID, dave.ID)
	}
	members := "/api/projects/GB/members/"

	res := e.behindProjectChange("GB", demoteDave,
		pendingRequest{http.MethodPatch, members + itoa(dave.ID), dave.Token, map[string]any{"role": "admin"}},
		pendingRequest{http.MethodPatch, members + itoa(mia.ID), dave.Token, map[string]any{"role": "viewer"}},
	)
	expectError(t, res[0], http.StatusForbidden, "forbidden")
	expectError(t, res[1], http.StatusForbidden, "forbidden")

	e.exec(`UPDATE project_members SET role = 'admin' WHERE project_id = $1 AND user_id = $2`, p.ID, dave.ID)
	res = e.behindProjectChange("GB", demoteDave,
		pendingRequest{http.MethodDelete, "/api/projects/GB", dave.Token, nil},
		pendingRequest{http.MethodPost, "/api/projects/GB/members", dave.Token, map[string]any{"email": e.createUser("Nia").Email}},
	)
	expectError(t, res[0], http.StatusForbidden, "forbidden")
	expectError(t, res[1], http.StatusForbidden, "forbidden")

	e.exec(`UPDATE project_members SET role = 'admin' WHERE project_id = $1 AND user_id = $2`, p.ID, dave.ID)
	res = e.behindProjectChange("GB", demoteDave,
		pendingRequest{http.MethodDelete, members + itoa(mia.ID), dave.Token, nil},
		pendingRequest{http.MethodPost, "/api/projects/GB/statuses", dave.Token, map[string]any{"name": "QA", "category": "in_progress"}},
	)
	expectError(t, res[0], http.StatusForbidden, "forbidden")
	expectError(t, res[1], http.StatusForbidden, "forbidden")

	roles := map[int64]string{}
	for _, m := range decodeAs[[]dto.Member](t, e.do(http.MethodGet, "/api/projects/GB/members", owner.Token, nil), http.StatusOK) {
		roles[m.User.ID] = m.Role
	}
	if roles[dave.ID] != "viewer" || roles[mia.ID] != "admin" || len(roles) != 3 {
		t.Fatalf("members after the races: %v", roles)
	}
	if n := len(e.statuses(owner, "GB")); n != 4 {
		t.Fatalf("%d statuses, want the 4 defaults", n)
	}
}

// A member removed while their requests wait can no longer create or edit issues.
func TestInFlightRequestsOfARemovedMemberAreRefused(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	mia := e.createUser("Mia")
	p := e.createProject(owner, "GB")
	e.addMember(owner, "GB", mia, "member")
	x := e.newIssue(owner, "GB", "task", "X", nil)

	res := e.behindProjectChange("GB", func(tx pgx.Tx) {
		e.sideExec(tx, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, p.ID, mia.ID)
	},
		pendingRequest{http.MethodPost, "/api/projects/GB/issues", mia.Token, map[string]any{"type": "task", "summary": "Late"}},
		pendingRequest{http.MethodPatch, "/api/issues/" + x.Key, mia.Token, map[string]any{"summary": "Late edit"}},
	)
	expectError(t, res[0], http.StatusNotFound, "not_found")
	expectError(t, res[1], http.StatusNotFound, "not_found")
	if got := e.getIssue(owner, x.Key); got.Summary != "X" {
		t.Fatalf("summary = %q", got.Summary)
	}
	if n := len(e.searchIssues(owner, "project=GB").Items); n != 1 {
		t.Fatalf("%d issues, want 1", n)
	}
}

// Sprint requests racing a switch to Kanban see the new type (SPEC §3: 400 for Kanban).
func TestInFlightSprintRequestsSeeASwitchToKanban(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	active := e.createSprint(u, "GB", nil)
	planned := e.createSprint(u, "GB", nil)
	e.startSprint(u, active.ID, "2026-09-01", "2026-09-14")
	toKanban := func(tx pgx.Tx) { e.sideExec(tx, `UPDATE projects SET type = 'kanban' WHERE key = 'GB'`) }

	res := e.behindProjectChange("GB", toKanban,
		pendingRequest{http.MethodPost, "/api/projects/GB/sprints", u.Token, map[string]any{}},
		pendingRequest{http.MethodPost, sprintPath(planned.ID, "/start"), u.Token, map[string]any{}},
	)
	expectError(t, res[0], http.StatusBadRequest, "validation_error")
	expectError(t, res[1], http.StatusBadRequest, "validation_error")

	e.exec(`UPDATE projects SET type = 'scrum' WHERE key = 'GB'`)
	res = e.behindProjectChange("GB", toKanban,
		pendingRequest{http.MethodPost, sprintPath(active.ID, "/complete"), u.Token, map[string]any{"target": "new"}},
		pendingRequest{http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{"type": "task", "summary": "Late", "sprintId": planned.ID}},
	)
	expectError(t, res[0], http.StatusBadRequest, "validation_error")
	expectFieldError(t, res[1], "sprintId")

	sprints := e.listSprints(u, "GB", "")
	if len(sprints) != 2 || sprints[0].State != "active" || sprints[1].State != "planned" {
		t.Fatalf("sprints after the races: %+v", sprints)
	}
}

// Writes waiting while the project is deleted answer 404, not a 500 ("project has no
// statuses") or a misleading validation error.
func TestInFlightWritesToADeletedProjectAreNotFound(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	e.createProject(u, "GC")
	todo := e.statusNamed(u, "GB", "To Do")
	deleteProject := func(key string) func(tx pgx.Tx) {
		return func(tx pgx.Tx) { e.sideExec(tx, `DELETE FROM projects WHERE key = $1`, key) }
	}

	res := e.behindProjectChange("GB", deleteProject("GB"),
		pendingRequest{http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{"type": "task", "summary": "Late"}},
		pendingRequest{http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{"type": "task", "summary": "Late", "statusId": todo.ID}},
	)
	expectError(t, res[0], http.StatusNotFound, "not_found")
	expectError(t, res[1], http.StatusNotFound, "not_found")

	res = e.behindProjectChange("GC", deleteProject("GC"),
		pendingRequest{http.MethodPost, "/api/projects/GC/sprints", u.Token, map[string]any{}},
		pendingRequest{http.MethodPost, "/api/projects/GC/statuses", u.Token, map[string]any{"name": "QA", "category": "in_progress"}},
	)
	expectError(t, res[0], http.StatusNotFound, "not_found")
	expectError(t, res[1], http.StatusNotFound, "not_found")
}
