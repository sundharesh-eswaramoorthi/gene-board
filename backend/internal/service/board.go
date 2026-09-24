package service

import (
	"context"
	"fmt"

	"geneboard/internal/db"
	"geneboard/internal/dto"
)

// KanbanDoneRetentionDays is how long resolved issues stay on a Kanban board (SPEC §2
// Boards): done-category issues resolved longer ago than this are hidden.
const KanbanDoneRetentionDays = 14

// Board returns a project's board (SPEC §2 Boards). Scrum: every non-epic issue of the
// active sprint (sprint null and no issues when none is active). Kanban: every non-epic
// issue except those resolved more than KanbanDoneRetentionDays ago. Issues are in rank
// order; clients group them into columns by status.
func (s *Service) Board(ctx context.Context, userID int64, projectKey string) (dto.Board, error) {
	var out dto.Board
	err := s.inReadTx(ctx, func(q *db.Queries) error {
		acc, err := s.projectByKey(ctx, q, userID, projectKey, RoleViewer)
		if err != nil {
			return err
		}
		p := acc.project
		if out.Project, err = projectView(ctx, q, userID, p.ID); err != nil {
			return err
		}
		statuses, err := q.ListStatuses(ctx, p.ID)
		if err != nil {
			return fmt.Errorf("list statuses: %w", err)
		}
		out.Statuses = toStatuses(statuses)

		var rows []db.Issue
		if p.Type == dto.ProjectTypeKanban {
			rows, err = q.ListKanbanBoardIssues(ctx, db.ListKanbanBoardIssuesParams{
				ProjectID: p.ID, DoneRetentionDays: KanbanDoneRetentionDays,
			})
			if err != nil {
				return fmt.Errorf("list kanban board issues: %w", err)
			}
		} else {
			active, err := q.GetActiveSprint(ctx, p.ID)
			switch {
			case isNoRows(err):
				out.Issues = []dto.Issue{}
				return nil
			case err != nil:
				return fmt.Errorf("load active sprint: %w", err)
			}
			sprint, err := sprintView(ctx, q, active)
			if err != nil {
				return err
			}
			out.Sprint = &sprint
			if rows, err = q.ListSprintBoardIssues(ctx, active.ID); err != nil {
				return fmt.Errorf("list sprint board issues: %w", err)
			}
		}
		out.Issues, err = hydrateIssues(ctx, q, rows)
		return err
	})
	return out, err
}

// Backlog returns the backlog page (SPEC §5): the active and planned sprints (active
// first, planned by id) with their standard issues, and the backlog. Epics and subtasks
// are never listed; everything is in rank order. Open issues left in a completed sprint
// (e.g. reopened after the sprint closed) appear in the backlog, as in Jira.
func (s *Service) Backlog(ctx context.Context, userID int64, projectKey string) (dto.Backlog, error) {
	out := dto.Backlog{Sprints: []dto.BacklogSprint{}, Backlog: []dto.Issue{}}
	err := s.inReadTx(ctx, func(q *db.Queries) error {
		acc, err := s.projectByKey(ctx, q, userID, projectKey, RoleViewer)
		if err != nil {
			return err
		}
		p := acc.project
		sprintRows, err := q.ListProjectSprints(ctx, db.ListProjectSprintsParams{
			ProjectID: p.ID, States: []string{dto.SprintActive, dto.SprintPlanned},
		})
		if err != nil {
			return fmt.Errorf("list sprints: %w", err)
		}
		sprints, err := sprintViews(ctx, q, sprintRows)
		if err != nil {
			return err
		}
		section := make(map[int64]int, len(sprints)) // sprint id -> index in out.Sprints
		for i, sp := range sprints {
			out.Sprints = append(out.Sprints, dto.BacklogSprint{Sprint: sp, Issues: []dto.Issue{}})
			section[sp.ID] = i
		}

		rows, err := q.ListBacklogIssues(ctx, p.ID)
		if err != nil {
			return fmt.Errorf("list backlog issues: %w", err)
		}
		issues, err := hydrateIssues(ctx, q, rows)
		if err != nil {
			return err
		}
		for _, is := range issues { // already in rank order
			if is.Sprint != nil {
				if i, ok := section[is.Sprint.ID]; ok {
					out.Sprints[i].Issues = append(out.Sprints[i].Issues, is)
					continue
				}
			}
			out.Backlog = append(out.Backlog, is)
		}
		return nil
	})
	return out, err
}

// Epics returns the project's epics in rank order with the progress of their child issues
// (stories, tasks and bugs; subtasks are not counted) by status category.
func (s *Service) Epics(ctx context.Context, userID int64, projectKey string) ([]dto.EpicProgress, error) {
	var out []dto.EpicProgress
	err := s.inReadTx(ctx, func(q *db.Queries) error {
		acc, err := s.projectByKey(ctx, q, userID, projectKey, RoleViewer)
		if err != nil {
			return err
		}
		rows, err := q.ListProjectEpics(ctx, acc.project.ID)
		if err != nil {
			return fmt.Errorf("list epics: %w", err)
		}
		epics, err := hydrateIssues(ctx, q, rows)
		if err != nil {
			return err
		}
		out = make([]dto.EpicProgress, len(epics))
		if len(epics) == 0 {
			return nil
		}
		ids := make([]int64, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		progress, err := q.ListEpicProgress(ctx, ids)
		if err != nil {
			return fmt.Errorf("load epic progress: %w", err)
		}
		byEpic := make(map[int64]db.ListEpicProgressRow, len(progress))
		for _, pr := range progress {
			byEpic[pr.EpicID] = pr
		}
		for i, epic := range epics {
			pr := byEpic[epic.ID]
			out[i] = dto.EpicProgress{
				Epic:        epic,
				Total:       pr.Total,
				Done:        pr.Done,
				InProgress:  pr.InProgress,
				PointsTotal: pr.PointsTotal,
				PointsDone:  pr.PointsDone,
			}
		}
		return nil
	})
	return out, err
}
