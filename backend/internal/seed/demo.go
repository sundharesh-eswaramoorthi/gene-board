package seed

import (
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// The demo story: the Gene Board team (Demo, Alex and Sam) builds its own tracker in the
// Scrum project GB and runs infrastructure work in the Kanban project OPS. Four weeks ago
// the team signed up; sprint 1 ran from 21 to 8 days ago and was completed a week ago,
// its unfinished work carried into sprint 2, which is active now; sprint 3 is planned.
//
// Timeline times are in the seeding process's local time zone. Markdown literals use "ˋ"
// for backticks (see md).

const (
	gb  = "GB"
	ops = "OPS"
)

// Workflow status names (the defaults every project gets).
const (
	todo       = "To Do"
	inProgress = "In Progress"
	inReview   = "In Review"
	done       = "Done"
)

func (sd *seeder) run() error {
	sd.setUp()
	sd.planSprintOne()
	sd.runSprintOne()
	sd.runSprintTwo()
	return sd.err
}

// setUp: accounts, both projects, labels and the first issues (days 28-24 ago).
func (sd *seeder) setUp() {
	sd.step(sd.at(28, 9, 0), func() { sd.register("demo", "Demo User", DemoEmail) })
	sd.step(sd.at(28, 9, 12), func() { sd.register("alex", "Alex Rivera", "alex@geneboard.dev") })
	sd.step(sd.at(28, 9, 20), func() { sd.register("sam", "Sam Patel", "sam@geneboard.dev") })

	sd.step(sd.at(28, 9, 45), func() {
		sd.createProject("demo", gb, "Gene Board", "scrum", `
The Gene Board product team: a fast, Jira-style tracker with Scrum and Kanban boards.

Sprints are two weeks long and start on the day after the review.`)
		sd.addMember("demo", gb, "alex", "member")
		sd.addMember("demo", gb, "sam", "member")
		sd.createLabels("demo", gb,
			label{"frontend", "#4BADE8"}, label{"backend", "#63BA3C"}, label{"ux", "#904EE2"},
			label{"security", "#E5493A"}, label{"performance", "#E97F33"}, label{"tech-debt", "#6B778C"})
	})

	sd.step(sd.at(27, 10, 0), func() {
		sd.create("demo", gb,
			issueSpec{ref: "board", typ: dto.IssueTypeEpic, summary: "Drag-and-drop planning board", priority: dto.PriorityHigh, dueIn: days(20), desc: `
Make planning feel instant: a board and a backlog where cards move between columns and
sprints without page reloads.

## Goals
- Columns come from the project's workflow statuses
- One shared card order for everyone (a single global rank)
- Keyboard support for every drag-and-drop action

## Out of scope
Swimlanes and custom card layouts are tracked separately.`},
			issueSpec{ref: "realtime", typ: dto.IssueTypeEpic, summary: "Realtime collaboration", priority: dto.PriorityHigh, desc: `
Everyone looking at the same board should see changes as they happen.

| Event | What refreshes |
|---|---|
| Issue created or moved | board and backlog |
| Comment added | the issue panel |
| Sprint started or completed | backlog and board header |

Websocket events are **hints**: clients refetch instead of patching local state.`},
			issueSpec{ref: "accounts", typ: dto.IssueTypeEpic, summary: "Accounts & onboarding", desc: `
A smooth first run: sign up, create a project, invite the team.

- [x] Email and password sign-up
- [ ] Invite teammates by email
- [ ] Password reset`},
		)
	})
	sd.step(sd.at(27, 11, 5), func() {
		sd.create("demo", gb,
			issueSpec{ref: "columns", typ: dto.IssueTypeStory, summary: "Render board columns from workflow statuses", parent: "board",
				priority: dto.PriorityHigh, points: 5, assignee: "alex", labels: []string{"frontend"}, desc: `
As a team member I want the board columns to match our workflow, so that the board shows
how we actually work.

### Acceptance criteria
- One column per status, ordered by position
- The column header shows the issue count
- Empty columns still accept drops`},
			issueSpec{ref: "ranks", typ: dto.IssueTypeStory, summary: "Persist card order with fractional ranks", parent: "board",
				priority: dto.PriorityHighest, points: 8, assignee: "sam", labels: []string{"backend", "performance"}, desc: `
Dragging a card between two others must not rewrite the rank of every other issue.

Use fractional indexing: the moved card gets a key strictly *between* its new neighbours:

    rank(moved) = between(rank(above), rank(below))

Ranks are compared byte-wise (ˋCOLLATE "C"ˋ), so ordering is stable across locales.`},
		)
	})
	sd.step(sd.at(27, 14, 30), func() {
		sd.create("sam", gb, issueSpec{ref: "hub", typ: dto.IssueTypeTask, summary: "Websocket hub for project events", parent: "realtime",
			priority: dto.PriorityHigh, points: 5, assignee: "sam", labels: []string{"backend"}, desc: `
Fan out project events to every subscribed browser.

- One subscription per open board or backlog
- Publishing never blocks: slow clients are dropped and reconnect
- Ping every 30 seconds so proxies keep the connection open`})
	})

	sd.step(sd.at(26, 9, 0), func() {
		sd.createProject("demo", ops, "Operations", "kanban", `
Infrastructure, on-call follow-ups and maintenance work. Pull the next card when you have
capacity; keep **In Progress** within its WIP limit.`)
		sd.addMember("demo", ops, "alex", "member")
		sd.addMember("demo", ops, "sam", "member")
		sd.createLabels("demo", ops,
			label{"infra", "#0065FF"}, label{"incident", "#E5493A"}, label{"security", "#904EE2"}, label{"maintenance", "#6B778C"})
		sd.setWipLimit("demo", ops, inProgress, 3)
	})
	sd.step(sd.at(26, 10, 15), func() {
		sd.create("alex", gb, issueSpec{ref: "login-bug", typ: dto.IssueTypeBug, summary: "Login rejects emails with surrounding spaces", parent: "accounts",
			points: 2, assignee: "alex", labels: []string{"frontend", "security"}, desc: `
**Steps to reproduce**
1. Register as ˋ jane@example.com ˋ (note the spaces)
2. Log in as ˋjane@example.comˋ

**Expected:** the login succeeds; emails are trimmed and lower-cased everywhere.

**Actual:** "Invalid email or password".`})
	})
	sd.step(sd.at(26, 11, 0), func() {
		sd.create("demo", gb,
			issueSpec{ref: "invite", typ: dto.IssueTypeStory, summary: "Invite teammates by email", parent: "accounts",
				points: 3, assignee: "demo", labels: []string{"backend"}, desc: `
Project admins can add an existing user by email and choose their role:

| Role | Can |
|---|---|
| Viewer | read everything |
| Member | create and edit issues, run sprints |
| Admin | manage members, columns and labels |`},
			issueSpec{ref: "keyboard", typ: dto.IssueTypeTask, summary: "Keyboard shortcuts for moving cards", parent: "board",
				priority: dto.PriorityLow, points: 3, assignee: "alex", labels: []string{"frontend", "ux"}, desc: `
Move the focused card without a mouse:

| Keys | Action |
|---|---|
| ˋSpaceˋ | pick up / drop |
| ˋ←ˋ ˋ→ˋ | previous / next column |
| ˋ↑ˋ ˋ↓ˋ | move within the column |
| ˋEscˋ | cancel |`},
		)
	})

	sd.step(sd.at(25, 10, 0), func() {
		sd.create("demo", ops,
			issueSpec{ref: "reliability", typ: dto.IssueTypeEpic, summary: "Reliability hardening", priority: dto.PriorityHigh, dueIn: days(30), desc: `
Reduce pages and shorten recovery after the September incidents.

**Targets:** 99.9% API availability, restore from backup in under 30 minutes.`},
			issueSpec{ref: "db-creds", typ: dto.IssueTypeTask, summary: "Rotate production database credentials", parent: "reliability",
				priority: dto.PriorityHigh, points: 3, assignee: "sam", labels: []string{"security"}, desc: `
Credentials have not been rotated since launch.

1. Create the new role with the same grants
2. Roll the API deployment with the new secret
3. Revoke the old role after 24 hours`},
			issueSpec{ref: "k8s", typ: dto.IssueTypeTask, summary: "Upgrade the staging cluster to Kubernetes 1.34",
				points: 5, assignee: "alex", labels: []string{"infra"}, desc: `
Staging runs two minor versions behind production. Upgrade the control plane first, then
the node pools one at a time.`},
			issueSpec{ref: "uptime", typ: dto.IssueTypeTask, summary: "Uptime alerts for the public API",
				priority: dto.PriorityHigh, points: 2, assignee: "demo", labels: []string{"infra"}, desc: `
Alert the on-call channel when ˋGET /api/healthˋ fails from two regions for 2 minutes.`},
		)
	})
	sd.step(sd.at(25, 10, 30), func() {
		sd.create("sam", ops, issueSpec{ref: "backup", typ: dto.IssueTypeBug, summary: "Nightly backup job timed out", parent: "reliability",
			priority: dto.PriorityHighest, assignee: "sam", labels: []string{"incident"}, desc: `
The nightly ˋpg_dumpˋ job was killed after 2 hours; last night has **no backup**.`})
	})
	sd.step(sd.at(25, 15, 0), func() {
		sd.create("demo", ops,
			issueSpec{ref: "tls", typ: dto.IssueTypeTask, summary: "Renew TLS certificates", priority: dto.PriorityHighest, points: 1,
				assignee: "demo", labels: []string{"security"}, dueIn: days(4), desc: `
The wildcard certificate expires soon. Switch to automatic renewal while we are at it.`},
			issueSpec{ref: "runbook", typ: dto.IssueTypeTask, summary: "Write the database failover runbook", parent: "reliability",
				points: 3, assignee: "alex", desc: `
Document the manual failover step by step, including how to verify replication lag
before promoting the replica.`},
			issueSpec{ref: "artifacts", typ: dto.IssueTypeTask, summary: "Archive CI artifacts older than 90 days",
				priority: dto.PriorityLow, points: 1, labels: []string{"maintenance"}, desc: `
Artifact storage grows by ~40 GB a month. Move old artifacts to cold storage.`},
			issueSpec{ref: "vault", typ: dto.IssueTypeTask, summary: "Move application secrets to a managed vault",
				points: 5, assignee: "sam", labels: []string{"security", "infra"}, desc: `
Replace the secrets in environment files with references to the vault. Start with the API.`},
		)
	})
}

// planSprintOne creates and fills sprint 1 (days 24-21 ago).
func (sd *seeder) planSprintOne() {
	sd.step(sd.at(24, 15, 0), func() {
		sd.createSprint("demo", gb, "s1", "")
		sd.moveToSprint("demo", "s1", "columns", "ranks", "hub", "login-bug", "invite", "keyboard")
		sd.rankAbove("demo", "login-bug", "columns") // bugs first
	})
	sd.step(sd.at(22, 9, 5), func() { sd.move("sam", "backup", inProgress) })
	sd.step(sd.at(21, 9, 30), func() {
		sd.startSprint("demo", "s1", -21, -8, "A usable drag-and-drop board with a shared card order")
	})
	sd.step(sd.at(21, 10, 0), func() {
		sd.move("alex", "columns", inProgress)
		sd.move("alex", "login-bug", inProgress)
	})
	sd.step(sd.at(21, 12, 10), func() {
		sd.move("sam", "backup", done)
		sd.comment("sam", "backup", `
Root cause: the backup volume was full, so ˋpg_dumpˋ stalled instead of failing.

- Freed space and re-ran the backup manually (took 38 minutes)
- Added a disk usage alert on the backup volume

Further follow-ups are tracked in `+sd.key("reliability")+`.`)
	})
}

// runSprintOne plays sprint 1 through to its completion (days 20-7 ago).
func (sd *seeder) runSprintOne() {
	sd.step(sd.at(20, 11, 0), func() { sd.move("sam", "ranks", inProgress) })
	sd.step(sd.at(18, 16, 0), func() { sd.move("alex", "login-bug", inReview) })
	sd.step(sd.at(17, 10, 30), func() {
		sd.move("alex", "login-bug", done)
		sd.comment("alex", "login-bug", `
Fixed: registration and login now share the same email normalisation (trim + lower-case).
Added a regression test for both endpoints.`)
	})
	sd.step(sd.at(16, 14, 0), func() {
		sd.move("alex", "columns", inReview)
		sd.move("sam", "hub", inProgress)
	})
	sd.step(sd.at(15, 10, 0), func() { sd.move("alex", "k8s", inProgress) })
	sd.step(sd.at(15, 11, 0), func() { sd.move("demo", "columns", done) })
	sd.step(sd.at(13, 9, 45), func() { sd.move("demo", "invite", inProgress) })
	sd.step(sd.at(13, 15, 20), func() {
		sd.comment("sam", "ranks", `
Ranks only grow by a character when you insert between two *adjacent* keys, so they stay
short even after thousands of moves. The fuzz test in ˋinternal/rankˋ covers repeated
insertion at the same spot.`)
	})
	sd.step(sd.at(13, 16, 5), func() {
		sd.comment("demo", "ranks", "Nice. Do ties (the same rank written by manual SQL) still sort deterministically?")
	})
	sd.step(sd.at(13, 16, 30), func() {
		sd.comment("sam", "ranks", "Yes, every list breaks ties by issue id.")
	})
	sd.step(sd.at(12, 10, 0), func() {
		sd.move("sam", "db-creds", inProgress)
		sd.move("sam", "ranks", inReview)
	})
	sd.step(sd.at(11, 10, 0), func() { sd.move("demo", "ranks", done) })
	sd.step(sd.at(10, 14, 0), func() { sd.move("sam", "hub", done) })
	sd.step(sd.at(10, 15, 0), func() {
		sd.create("demo", gb,
			issueSpec{ref: "live", typ: dto.IssueTypeStory, summary: "Live-update the board when teammates move cards", parent: "realtime",
				priority: dto.PriorityHighest, points: 8, assignee: "sam", labels: []string{"frontend", "backend"}, dueIn: days(6), desc: `
When someone moves a card, every open board of the project updates within a second.

### Notes
- Subscribe on mount, unsubscribe on unmount
- Debounce refetches (~300 ms) so a burst of events causes one request
- Reconnect with exponential backoff after network drops`},
			issueSpec{ref: "wip", typ: dto.IssueTypeStory, summary: "Show WIP limits in column headers", parent: "board",
				points: 3, assignee: "demo", labels: []string{"frontend", "ux"}, desc: `
Show ˋcount / limitˋ in the column header and highlight the column when the limit is
exceeded. Limits are advisory: never block a drop.`},
		)
	})
	sd.step(sd.at(10, 15, 30), func() {
		sd.create("alex", gb, issueSpec{ref: "flicker", typ: dto.IssueTypeBug, summary: "Card flickers when dropped into an empty column", parent: "board",
			priority: dto.PriorityHigh, points: 2, assignee: "alex", labels: []string{"frontend"}, desc: `
Dropping a card into an empty column shows it in the old column for a split second before
it jumps to the new one.

Probably the optimistic update is overwritten by a board refetch that started before the
move. Happens in Chrome and Firefox.`})
	})
	sd.step(sd.at(10, 16, 0), func() {
		sd.create("sam", gb, issueSpec{ref: "rate-limit", typ: dto.IssueTypeTask, summary: "Rate-limit the login endpoint", parent: "accounts",
			priority: dto.PriorityHigh, points: 3, assignee: "sam", labels: []string{"backend", "security"}, desc: `
Slow down credential stuffing:

- 5 failed attempts per minute per email
- 20 attempts per minute per IP address
- Answer ˋ429 Too Many Requestsˋ with a ˋRetry-Afterˋ header`})
	})
	sd.step(sd.at(10, 16, 30), func() { sd.link("sam", "hub", dto.LinkBlocks, "live") })
	sd.step(sd.at(9, 14, 0), func() { sd.move("demo", "uptime", inProgress) })

	// Sprint review: "invite" and "keyboard" are unfinished and carry over into sprint 2.
	sd.step(sd.at(7, 16, 0), func() { sd.completeSprintIntoNew("demo", "s1", "s2") })
	sd.step(sd.at(7, 16, 20), func() {
		sd.moveToSprint("demo", "s2", "live", "flicker", "wip", "rate-limit")
		sd.rankAbove("demo", "live", "invite") // the sprint's main story goes first
	})
}

// runSprintTwo starts sprint 2, plans sprint 3 and plays the last week up to today.
func (sd *seeder) runSprintTwo() {
	sd.step(sd.at(6, 8, 15), func() {
		sd.create("sam", ops, issueSpec{ref: "disk", typ: dto.IssueTypeBug, summary: "Disk usage alert on the log volume", parent: "reliability",
			priority: dto.PriorityHigh, points: 2, assignee: "sam", labels: []string{"incident", "infra"}, desc: `
The log volume on ˋapi-2ˋ reached 91%. Logs are not rotated when the service restarts.`})
	})
	sd.step(sd.at(6, 9, 30), func() {
		sd.startSprint("demo", "s2", -6, 8, "Realtime board updates for the whole team")
	})
	sd.step(sd.at(6, 10, 0), func() {
		sd.create("sam", gb,
			issueSpec{ref: "live-subscribe", typ: dto.IssueTypeSubtask, summary: "Subscribe to the project channel on board mount", parent: "live", assignee: "sam"},
			issueSpec{ref: "live-debounce", typ: dto.IssueTypeSubtask, summary: "Debounce cache invalidation", parent: "live", assignee: "sam"},
		)
		sd.create("alex", gb, issueSpec{ref: "live-reconnect", typ: dto.IssueTypeSubtask, summary: "Reconnect with exponential backoff",
			parent: "live", assignee: "alex", desc: "Start at 1 s, double up to 30 s, add jitter."})
	})
	sd.step(sd.at(5, 10, 0), func() {
		sd.move("sam", "live", inProgress)
		sd.move("sam", "live-subscribe", inProgress)
		sd.move("alex", "keyboard", inProgress)
		sd.move("sam", "rate-limit", inProgress)
	})
	sd.step(sd.at(5, 11, 0), func() { sd.move("alex", "k8s", inReview) })
	sd.step(sd.at(4, 10, 0), func() { sd.move("sam", "disk", inProgress) })
	sd.step(sd.at(4, 11, 30), func() {
		sd.move("alex", "flicker", inProgress)
		sd.comment("alex", "flicker", `
Reproduced reliably with network throttling ("Fast 3G"):

1. Drag a card into the empty **In Review** column
2. The card jumps back for ~200 ms, then lands

The in-flight board query resolves *after* the optimistic update. Cancelling queries before
the optimistic update fixes it.`)
	})
	sd.step(sd.at(4, 15, 0), func() {
		sd.move("sam", "live-subscribe", done)
		sd.move("sam", "live-debounce", inProgress)
	})

	sd.step(sd.at(3, 10, 0), func() { sd.createSprint("demo", gb, "s3", "Account recovery and sprint reporting") })
	sd.step(sd.at(3, 10, 30), func() {
		sd.create("demo", gb,
			issueSpec{ref: "reset", typ: dto.IssueTypeStory, summary: "Password reset via email link", parent: "accounts", sprint: "s3",
				priority: dto.PriorityHigh, points: 5, assignee: "demo", labels: []string{"backend", "security"}, desc: `
As a user who forgot my password I want to reset it from the login page.

- The link is valid for **30 minutes** and works once
- Always answer "If the account exists, we sent you an email" (no account enumeration)`},
			issueSpec{ref: "burndown", typ: dto.IssueTypeStory, summary: "Sprint burndown chart", sprint: "s3",
				points: 5, labels: []string{"frontend"}, desc: `
Chart the remaining story points per day of the active sprint, with an ideal line from the
sprint's start date to its end date.`},
		)
		sd.create("sam", gb, issueSpec{ref: "ci-pg", typ: dto.IssueTypeTask, summary: "Run CI against PostgreSQL 17", sprint: "s3",
			priority: dto.PriorityLow, points: 2, assignee: "sam", labels: []string{"tech-debt"}, desc: `
CI still runs the integration tests on PostgreSQL 16. Match production:

    services:
      postgres:
        image: postgres:17-alpine`})
	})
	sd.step(sd.at(3, 11, 0), func() {
		sd.create("alex", gb, issueSpec{ref: "reset-email", typ: dto.IssueTypeSubtask, summary: "Design the reset email template", parent: "reset", assignee: "alex"})
		sd.create("sam", gb, issueSpec{ref: "reset-token", typ: dto.IssueTypeSubtask, summary: "Single-use, expiring reset tokens", parent: "reset", assignee: "sam"})
	})
	sd.step(sd.at(3, 14, 0), func() { sd.move("demo", "invite", inReview) })
	sd.step(sd.at(3, 16, 0), func() { sd.move("demo", "uptime", done) })

	sd.step(sd.at(2, 9, 0), func() { sd.move("sam", "vault", inProgress) })
	sd.step(sd.at(2, 11, 0), func() { sd.move("sam", "rate-limit", done) })
	sd.step(sd.at(2, 14, 0), func() { sd.move("alex", "flicker", inReview) })
	sd.step(sd.at(2, 16, 0), func() {
		sd.comment("demo", "live", "Tried it with two browsers side by side: cards move on the other screen almost instantly. Great work!")
	})
	sd.step(sd.at(2, 16, 40), func() {
		sd.comment("sam", "live", "Thanks! Left to do: the debounce and "+sd.key("live-reconnect")+" (reconnect with backoff).")
	})

	sd.step(sd.at(1, 9, 30), func() {
		sd.create("alex", gb, issueSpec{ref: "contrast", typ: dto.IssueTypeBug, summary: "Label chips have low contrast in dark mode",
			priority: dto.PriorityLow, points: 1, labels: []string{"ux", "frontend"}, desc: `
Light label colours (e.g. yellow) are hard to read on the dark surface. Pick the text colour
from the label colour's luminance.`})
	})
	sd.step(sd.at(1, 10, 0), func() {
		sd.create("sam", gb,
			issueSpec{ref: "csv", typ: dto.IssueTypeStory, summary: "Export search results to CSV", priority: dto.PriorityLowest, points: 3, desc: `
Add an **Export** button to the issues page that downloads the current search (all pages)
as CSV.`},
			issueSpec{ref: "api-docs", typ: dto.IssueTypeTask, summary: "Document the REST API with examples",
				priority: dto.PriorityLow, points: 2, assignee: "demo", labels: []string{"tech-debt"}, desc: `
One page per resource with a ˋcurlˋ example for each endpoint, generated from the spec.`},
		)
	})
	sd.step(sd.at(1, 11, 0), func() {
		sd.create("demo", gb, issueSpec{ref: "bulk", typ: dto.IssueTypeStory, summary: "Bulk edit issues from the search page", points: 8, desc: `
Select several issues in the search results and change status, assignee, sprint or labels
in one go.`})
	})
	sd.step(sd.at(1, 14, 0), func() {
		sd.patch("demo", "wip", service.UpdateIssueInput{
			Priority: httpx.Some(dto.PriorityHigh),
			DueDate:  httpx.Some(*sd.date(4)),
		})
	})
	sd.step(sd.at(1, 15, 0), func() { sd.link("demo", "reset", dto.LinkRelates, "invite") })
	sd.step(sd.at(1, 16, 30), func() {
		sd.patch("demo", "bulk", service.UpdateIssueInput{
			StoryPoints: httpx.Some(13.0),
			LabelIDs:    httpx.Some([]int64{sd.labels[gb]["frontend"], sd.labels[gb]["ux"]}),
		})
	})
	sd.step(sd.at(1, 17, 0), func() {
		sd.comment("sam", "disk", "Log rotation now also runs on restart. Watching the volume for a day before closing this.")
	})

	sd.step(sd.hoursAgo(4.5), func() { sd.move("sam", "live-debounce", inReview) })
	sd.step(sd.hoursAgo(3), func() {
		sd.comment("alex", "invite", "Reviewed: two small comments on the role picker, otherwise good to go.")
	})
	sd.step(sd.hoursAgo(1.5), func() {
		sd.patch("alex", "flicker", service.UpdateIssueInput{AssigneeID: httpx.Some(sd.user("demo"))})
		sd.comment("alex", "flicker", "Handing the review over to Demo, I am out tomorrow.")
	})
}
