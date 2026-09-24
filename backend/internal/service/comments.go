package service

import (
	"context"
	"fmt"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// CommentInput is the body of comment create/update requests.
type CommentInput struct {
	Body string `json:"body"`
}

var errCommentNotFound = httpx.NotFound("Comment not found")

// ListComments returns an issue's comments, oldest first.
func (s *Service) ListComments(ctx context.Context, userID int64, issueKey string) ([]dto.Comment, error) {
	acc, err := s.issueByKey(ctx, s.q, userID, issueKey, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListCommentViews(ctx, acc.issue.ID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	out := make([]dto.Comment, len(rows))
	for i, r := range rows {
		out[i] = toComment(r.Comment, r.AuthorName, r.AuthorEmail)
	}
	return out, nil
}

// CreateComment adds a comment to an issue (member role).
func (s *Service) CreateComment(ctx context.Context, userID int64, issueKey string, in CommentInput) (dto.Comment, error) {
	body, err := validCommentBody(in.Body)
	if err != nil {
		return dto.Comment{}, err
	}
	var out dto.Comment
	err = s.inTx(ctx, func(t *txn) error {
		acc, err := s.issueByKey(ctx, t.q, userID, issueKey, RoleMember)
		if err != nil {
			return err
		}
		if _, err := keyShareIssue(ctx, t.q, acc.issue.ID); err != nil { // 404 if deleted meanwhile
			return err
		}
		c, err := t.q.CreateComment(ctx, db.CreateCommentParams{IssueID: acc.issue.ID, AuthorID: &userID, Body: body})
		if err != nil {
			return fmt.Errorf("create comment: %w", err)
		}
		// No stored preview: the activity lists show the comment's current text (activity.go).
		if err := t.logActivity(ctx, userID, issueEntry(acc.issue, ActionCommentCreated).withComment(c.ID)); err != nil {
			return err
		}
		t.publish(acc.project.ID, realtime.CommentChanged, acc.project.Key, acc.issue.Key, userID)
		out, err = commentView(ctx, t.q, c)
		return err
	})
	return out, err
}

// UpdateComment edits a comment's body (its author only, who must still be able to write
// in the project). An unchanged body is a no-op.
func (s *Service) UpdateComment(ctx context.Context, userID, commentID int64, in CommentInput) (dto.Comment, error) {
	body, err := validCommentBody(in.Body)
	if err != nil {
		return dto.Comment{}, err
	}
	var out dto.Comment
	err = s.inTx(ctx, func(t *txn) error {
		c, acc, err := s.commentAccess(ctx, t.q, userID, commentID)
		if err != nil {
			return err
		}
		if c.AuthorID == nil || *c.AuthorID != userID {
			return httpx.Forbidden("Only the author can edit a comment")
		}
		if err := requireRole(acc.role, RoleMember); err != nil {
			return err
		}
		if body != c.Body {
			if c, err = t.q.UpdateCommentBody(ctx, db.UpdateCommentBodyParams{ID: c.ID, Body: body}); err != nil {
				if isNoRows(err) { // deleted (or its issue deleted) since commentAccess read it
					return errCommentNotFound
				}
				return fmt.Errorf("update comment: %w", err)
			}
			t.publish(acc.project.ID, realtime.CommentChanged, acc.project.Key, acc.issue.Key, userID)
		}
		out, err = commentView(ctx, t.q, c)
		return err
	})
	return out, err
}

// DeleteComment deletes a comment (its author with member role, or a project admin).
func (s *Service) DeleteComment(ctx context.Context, userID, commentID int64) error {
	return s.inTx(ctx, func(t *txn) error {
		c, acc, err := s.commentAccess(ctx, t.q, userID, commentID)
		if err != nil {
			return err
		}
		isAuthor := c.AuthorID != nil && *c.AuthorID == userID
		switch {
		case acc.role == RoleAdmin:
		case isAuthor:
			if err := requireRole(acc.role, RoleMember); err != nil {
				return err
			}
		default:
			return httpx.Forbidden("Only the author or a project admin can delete a comment")
		}
		if err := t.q.DeleteComment(ctx, c.ID); err != nil {
			return fmt.Errorf("delete comment: %w", err)
		}
		t.publish(acc.project.ID, realtime.CommentChanged, acc.project.Key, acc.issue.Key, userID)
		return nil
	})
}

// commentAccess loads a comment and its issue for a project member (404 for anyone else).
func (s *Service) commentAccess(ctx context.Context, q *db.Queries, userID, commentID int64) (db.Comment, issueAccess, error) {
	c, err := q.GetComment(ctx, commentID)
	if isNoRows(err) {
		return db.Comment{}, issueAccess{}, errCommentNotFound
	}
	if err != nil {
		return db.Comment{}, issueAccess{}, fmt.Errorf("load comment: %w", err)
	}
	acc, err := s.issueByID(ctx, q, userID, c.IssueID, RoleViewer)
	if httpx.IsCode(err, httpx.CodeNotFound) {
		return db.Comment{}, issueAccess{}, errCommentNotFound
	}
	return c, acc, err
}

func commentView(ctx context.Context, q *db.Queries, c db.Comment) (dto.Comment, error) {
	var name, email *string
	if c.AuthorID != nil {
		u, err := q.GetUserByID(ctx, *c.AuthorID)
		if err != nil && !isNoRows(err) {
			return dto.Comment{}, fmt.Errorf("load comment author: %w", err)
		}
		if err == nil {
			name, email = &u.Name, &u.Email
		}
	}
	return toComment(c, name, email), nil
}

func validCommentBody(raw string) (string, error) {
	body := strings.TrimSpace(raw)
	var fe httpx.FieldErrors
	checkLength(&fe, "body", body, 1, maxCommentBody)
	return body, fe.Err()
}
