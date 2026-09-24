// Package dto defines the JSON resource shapes of the API, mirroring SPEC §4 exactly:
// camelCase names, nullable values rendered as null (never omitted), empty lists rendered
// as [] (callers must not leave slices nil), timestamps as RFC 3339 UTC (Timestamp) and
// dates as YYYY-MM-DD (Date).
//
// The service layer produces these values and the api layer serialises them unchanged.
package dto

// Enumerations (string values used on the wire and in the database).
const (
	IssueTypeEpic    = "epic"
	IssueTypeStory   = "story"
	IssueTypeTask    = "task"
	IssueTypeBug     = "bug"
	IssueTypeSubtask = "subtask"

	PriorityHighest = "highest"
	PriorityHigh    = "high"
	PriorityMedium  = "medium"
	PriorityLow     = "low"
	PriorityLowest  = "lowest"

	CategoryTodo       = "todo"
	CategoryInProgress = "in_progress"
	CategoryDone       = "done"

	ProjectTypeScrum  = "scrum"
	ProjectTypeKanban = "kanban"

	SprintPlanned   = "planned"
	SprintActive    = "active"
	SprintCompleted = "completed"

	LinkBlocks     = "blocks"
	LinkRelates    = "relates"
	LinkDuplicates = "duplicates"
	LinkClones     = "clones"
)

// User is the full user resource (only ever returned for the caller).
type User struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt Timestamp `json:"createdAt"`
}

// UserSummary is the compact user reference embedded in other resources.
type UserSummary struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// AuthResponse is returned by register and login.
type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

// Project is a project as seen by the calling user.
type Project struct {
	ID          int64        `json:"id"`
	Key         string       `json:"key"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Type        string       `json:"type"`
	Lead        *UserSummary `json:"lead"`
	MyRole      string       `json:"myRole"`
	IssueCount  int64        `json:"issueCount"`
	CreatedAt   Timestamp    `json:"createdAt"`
	UpdatedAt   Timestamp    `json:"updatedAt"`
}

// Member is a project membership.
type Member struct {
	User     UserSummary `json:"user"`
	Role     string      `json:"role"`
	JoinedAt Timestamp   `json:"joinedAt"`
}

// Status is a workflow status / board column.
type Status struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Position int    `json:"position"`
	WipLimit *int   `json:"wipLimit"`
}

// Label is a project label; Color is "#RRGGBB".
type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Sprint is a Scrum sprint with its issue statistics.
type Sprint struct {
	ID          int64      `json:"id"`
	ProjectID   int64      `json:"projectId"`
	Name        string     `json:"name"`
	Goal        string     `json:"goal"`
	State       string     `json:"state"`
	StartDate   *Date      `json:"startDate"`
	EndDate     *Date      `json:"endDate"`
	CompletedAt *Timestamp `json:"completedAt"`
	IssueCount  int64      `json:"issueCount"`  // non-subtask, non-epic issues in the sprint
	PointsTotal float64    `json:"pointsTotal"` // sum of their storyPoints (null -> 0)
	PointsDone  float64    `json:"pointsDone"`  // same, restricted to done-category statuses
	CreatedAt   Timestamp  `json:"createdAt"`
	UpdatedAt   Timestamp  `json:"updatedAt"`
}

// SprintRef is the compact sprint reference embedded in Issue.
type SprintRef struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

// IssueRef is a compact issue reference (parents, links).
type IssueRef struct {
	ID       int64  `json:"id"`
	Key      string `json:"key"`
	Summary  string `json:"summary"`
	Type     string `json:"type"`
	Status   Status `json:"status"`
	Priority string `json:"priority"`
}

// Issue is the full issue resource used in lists, boards and backlogs.
type Issue struct {
	ID           int64        `json:"id"`
	Key          string       `json:"key"`
	ProjectID    int64        `json:"projectId"`
	ProjectKey   string       `json:"projectKey"`
	Type         string       `json:"type"`
	Summary      string       `json:"summary"`
	Description  string       `json:"description"`
	Status       Status       `json:"status"`
	Priority     string       `json:"priority"`
	Assignee     *UserSummary `json:"assignee"`
	Reporter     *UserSummary `json:"reporter"`
	Parent       *IssueRef    `json:"parent"`
	Sprint       *SprintRef   `json:"sprint"`
	Labels       []Label      `json:"labels"` // sorted by name
	StoryPoints  *float64     `json:"storyPoints"`
	DueDate      *Date        `json:"dueDate"`
	Rank         string       `json:"rank"`
	SubtaskCount int64        `json:"subtaskCount"`
	ResolvedAt   *Timestamp   `json:"resolvedAt"`
	CreatedAt    Timestamp    `json:"createdAt"`
	UpdatedAt    Timestamp    `json:"updatedAt"`
}

// IssueLink is a link as seen from one of its two issues.
type IssueLink struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"`
	Direction string    `json:"direction"` // "outward" | "inward"
	Label     string    `json:"label"`
	Issue     IssueRef  `json:"issue"` // the other issue
	CreatedAt Timestamp `json:"createdAt"`
}

// IssueDetail is an Issue with its children and links.
type IssueDetail struct {
	Issue
	Children []Issue     `json:"children"` // ordered by rank
	Links    []IssueLink `json:"links"`    // ordered by createdAt
}

// Comment is an issue comment.
type Comment struct {
	ID        int64        `json:"id"`
	IssueID   int64        `json:"issueId"`
	Author    *UserSummary `json:"author"`
	Body      string       `json:"body"`
	CreatedAt Timestamp    `json:"createdAt"`
	UpdatedAt Timestamp    `json:"updatedAt"`
	Edited    bool         `json:"edited"`
}

// Activity is one activity-log entry.
type Activity struct {
	ID         int64        `json:"id"`
	ProjectID  int64        `json:"projectId"`
	ProjectKey string       `json:"projectKey"`
	IssueID    *int64       `json:"issueId"`
	IssueKey   *string      `json:"issueKey"`
	Actor      *UserSummary `json:"actor"`
	Action     string       `json:"action"`
	Field      *string      `json:"field"`
	OldValue   *string      `json:"oldValue"`
	NewValue   *string      `json:"newValue"`
	CreatedAt  Timestamp    `json:"createdAt"`
}

// EpicProgress summarises an epic's children by status category.
type EpicProgress struct {
	Epic        Issue   `json:"epic"`
	Total       int64   `json:"total"`
	Done        int64   `json:"done"`
	InProgress  int64   `json:"inProgress"`
	PointsTotal float64 `json:"pointsTotal"`
	PointsDone  float64 `json:"pointsDone"`
}

// Page is a paginated list.
type Page[T any] struct {
	Items  []T   `json:"items"`
	Total  int64 `json:"total"`
	Limit  int   `json:"limit"`
	Offset int   `json:"offset"`
}

// CompleteSprintResult is the response of POST /sprints/{id}/complete. The counts cover
// the sprint's standard issues (like Sprint.IssueCount); subtasks follow their parents.
type CompleteSprintResult struct {
	Sprint              Sprint  `json:"sprint"`
	CompletedIssueCount int64   `json:"completedIssueCount"` // done issues kept in the completed sprint
	MovedIssueCount     int64   `json:"movedIssueCount"`     // open issues moved to the target
	TargetSprint        *Sprint `json:"targetSprint"`        // null when the target is the backlog
}

// Board is the response of GET /projects/{key}/board. Issues are in rank order; the
// client groups them into columns by status id.
type Board struct {
	Project  Project  `json:"project"`
	Statuses []Status `json:"statuses"` // columns, by position
	Sprint   *Sprint  `json:"sprint"`   // the active sprint (Scrum); always null for Kanban
	Issues   []Issue  `json:"issues"`
}

// BacklogSprint is one sprint section of the backlog page.
type BacklogSprint struct {
	Sprint Sprint  `json:"sprint"`
	Issues []Issue `json:"issues"` // standard issues in rank order
}

// Backlog is the response of GET /projects/{key}/backlog.
type Backlog struct {
	Sprints []BacklogSprint `json:"sprints"` // the active sprint first, then planned sprints by id
	Backlog []Issue         `json:"backlog"` // standard issues not in an active or planned sprint, by rank
}
