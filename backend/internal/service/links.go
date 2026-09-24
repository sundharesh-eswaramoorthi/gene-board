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

// Link directions relative to the issue being viewed.
const (
	DirectionOutward = "outward"
	DirectionInward  = "inward"
)

// linkLabel returns the human-readable relation for a link type and direction
// ("blocks" / "is blocked by", ...).
func linkLabel(linkType, direction string) string {
	if direction == DirectionOutward {
		switch linkType {
		case dto.LinkRelates:
			return "relates to"
		default: // blocks, duplicates, clones
			return linkType
		}
	}
	switch linkType {
	case dto.LinkBlocks:
		return "is blocked by"
	case dto.LinkRelates:
		return "relates to"
	case dto.LinkDuplicates:
		return "is duplicated by"
	case dto.LinkClones:
		return "is cloned by"
	default:
		return linkType
	}
}

// issueLinks returns the links of issueID as seen from that issue, ordered by creation.
// Links whose other issue lives in a project userID cannot access are omitted.
func issueLinks(ctx context.Context, q *db.Queries, userID, issueID int64) ([]dto.IssueLink, error) {
	links, err := q.ListIssueLinks(ctx, issueID)
	if err != nil {
		return nil, fmt.Errorf("list links: %w", err)
	}
	out := []dto.IssueLink{}
	if len(links) == 0 {
		return out, nil
	}
	otherIDs := make([]int64, 0, len(links))
	for _, l := range links {
		otherIDs = append(otherIDs, otherSide(l, issueID))
	}
	others, err := issuesByID(ctx, q, otherIDs)
	if err != nil {
		return nil, err
	}
	projectIDs, err := q.ListMemberProjectIDs(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list member projects: %w", err)
	}
	accessible := make(map[int64]bool, len(projectIDs))
	for _, id := range projectIDs {
		accessible[id] = true
	}
	visible := make([]db.Issue, 0, len(others))
	for _, o := range others {
		if accessible[o.ProjectID] {
			visible = append(visible, o)
		}
	}
	refs, err := issueRefs(ctx, q, visible)
	if err != nil {
		return nil, err
	}
	for _, l := range links {
		ref, ok := refs[otherSide(l, issueID)]
		if !ok {
			continue
		}
		direction := DirectionOutward
		if l.SourceID != issueID {
			direction = DirectionInward
		}
		out = append(out, dto.IssueLink{
			ID:        l.ID,
			Type:      l.Type,
			Direction: direction,
			Label:     linkLabel(l.Type, direction),
			Issue:     ref,
			CreatedAt: dto.TS(l.CreatedAt),
		})
	}
	return out, nil
}

func otherSide(l db.IssueLink, issueID int64) int64 {
	if l.SourceID == issueID {
		return l.TargetID
	}
	return l.SourceID
}

// CreateLinkInput is the body of POST /issues/{issueKey}/links.
type CreateLinkInput struct {
	Type      string `json:"type"`
	TargetKey string `json:"targetKey"`
}

// CreateLink links issueKey (outward side) to the target issue. The caller needs member
// access to the source issue and at least viewer access to the target (which may be in
// another project). "relates" links are symmetric, so the reverse link counts as a
// duplicate.
func (s *Service) CreateLink(ctx context.Context, userID int64, issueKey string, in CreateLinkInput) (dto.IssueLink, error) {
	linkType := strings.ToLower(strings.TrimSpace(in.Type))
	targetKey := normalizeIssueKey(in.TargetKey)
	var fe httpx.FieldErrors
	checkEnum(&fe, "type", linkType, linkTypes)
	switch {
	case targetKey == "":
		fe.Add("targetKey", "is required")
	case !httpx.ValidText(targetKey):
		fe.Add("targetKey", msgNoSuchTarget)
	}
	if err := fe.Err(); err != nil {
		return dto.IssueLink{}, err
	}

	var out dto.IssueLink
	err := s.inTx(ctx, func(t *txn) error {
		src, err := s.issueByKey(ctx, t.q, userID, issueKey, RoleMember)
		if err != nil {
			return err
		}
		dst, err := s.issueByKey(ctx, t.q, userID, targetKey, RoleViewer)
		if err != nil {
			if httpx.IsCode(err, httpx.CodeNotFound) {
				return httpx.Validation("targetKey", msgNoSuchTarget)
			}
			return err
		}
		if dst.issue.ID == src.issue.ID {
			return httpx.Validation("targetKey", "must be a different issue")
		}
		// Both issues must survive until the link (and its activity row) is committed.
		if _, err := keyShareIssue(ctx, t.q, src.issue.ID); err != nil {
			return err
		}
		if _, err := keyShareIssue(ctx, t.q, dst.issue.ID); err != nil {
			if httpx.IsCode(err, httpx.CodeNotFound) {
				return httpx.Validation("targetKey", msgNoSuchTarget)
			}
			return err
		}
		if err := ensureLinkIsNew(ctx, t.q, linkType, src.issue.ID, dst.issue.ID); err != nil {
			return err
		}
		link, err := t.q.CreateIssueLink(ctx, db.CreateIssueLinkParams{
			Type: linkType, SourceID: src.issue.ID, TargetID: dst.issue.ID, CreatedBy: &userID,
		})
		if isUniqueViolation(err) {
			return errDuplicateLink
		}
		if err != nil {
			return fmt.Errorf("create link: %w", err)
		}
		desc := linkLabel(linkType, DirectionOutward) + " " + dst.issue.Key
		if err := t.logActivity(ctx, userID, issueEntry(src.issue, ActionLinkCreated).withValues("", nil, &desc)); err != nil {
			return err
		}
		refs, err := issueRefs(ctx, t.q, []db.Issue{dst.issue})
		if err != nil {
			return err
		}
		out = dto.IssueLink{
			ID: link.ID, Type: link.Type, Direction: DirectionOutward,
			Label: linkLabel(link.Type, DirectionOutward), Issue: refs[dst.issue.ID], CreatedAt: dto.TS(link.CreatedAt),
		}
		publishLinkChange(t, src.issue, dst.issue, userID)
		return nil
	})
	return out, err
}

var errDuplicateLink = httpx.Conflict("These issues are already linked this way")

var errLinkNotFound = httpx.NotFound("Link not found")

const msgNoSuchTarget = "does not match an issue you can access"

func ensureLinkIsNew(ctx context.Context, q *db.Queries, linkType string, sourceID, targetID int64) error {
	pairs := [][2]int64{{sourceID, targetID}}
	if linkType == dto.LinkRelates {
		pairs = append(pairs, [2]int64{targetID, sourceID})
	}
	for _, p := range pairs {
		exists, err := q.IssueLinkExists(ctx, db.IssueLinkExistsParams{Type: linkType, SourceID: p[0], TargetID: p[1]})
		if err != nil {
			return fmt.Errorf("check link: %w", err)
		}
		if exists {
			return errDuplicateLink
		}
	}
	return nil
}

// publishLinkChange notifies both issues' projects (once when they are the same).
func publishLinkChange(t *txn, src, dst db.Issue, actorID int64) {
	t.publish(src.ProjectID, realtime.IssueUpdated, projectKeyOf(src.Key), src.Key, actorID)
	if dst.ProjectID != src.ProjectID {
		t.publish(dst.ProjectID, realtime.IssueUpdated, projectKeyOf(dst.Key), dst.Key, actorID)
	}
}

// DeleteLink removes a link. The caller needs member access to the source issue's project;
// anyone without access to it gets 404.
func (s *Service) DeleteLink(ctx context.Context, userID, linkID int64) error {
	return s.inTx(ctx, func(t *txn) error {
		link, err := t.q.GetIssueLink(ctx, linkID)
		if isNoRows(err) {
			return errLinkNotFound
		}
		if err != nil {
			return fmt.Errorf("load link: %w", err)
		}
		src, err := s.issueByID(ctx, t.q, userID, link.SourceID, RoleMember)
		if err == nil {
			// The activity row references the source issue: keep it from being deleted.
			_, err = keyShareIssue(ctx, t.q, link.SourceID)
		}
		if err != nil {
			if httpx.IsCode(err, httpx.CodeNotFound) {
				return errLinkNotFound
			}
			return err
		}
		dst, err := t.q.GetIssueByID(ctx, link.TargetID)
		if isNoRows(err) { // deleted concurrently, and the link with it
			return errLinkNotFound
		}
		if err != nil {
			return fmt.Errorf("load link target: %w", err)
		}
		if err := t.q.DeleteIssueLink(ctx, link.ID); err != nil {
			return fmt.Errorf("delete link: %w", err)
		}
		desc := linkLabel(link.Type, DirectionOutward) + " " + dst.Key
		if err := t.logActivity(ctx, userID, issueEntry(src.issue, ActionLinkDeleted).withValues("", nil, &desc)); err != nil {
			return err
		}
		publishLinkChange(t, src.issue, dst, userID)
		return nil
	})
}
