package service

import (
	"context"
)

// RealtimeProjectID resolves the project a websocket client wants to follow (viewer role;
// 404 for non-members and unknown projects) and returns its id for Hub().Subscribe.
func (s *Service) RealtimeProjectID(ctx context.Context, userID int64, projectKey string) (int64, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, projectKey, RoleViewer)
	if err != nil {
		return 0, err
	}
	return acc.project.ID, nil
}

// CheckRealtimeAccess reports (as a nil error) whether userID may still follow the project;
// long-lived websocket connections re-check it periodically so that removed members stop
// receiving events.
func (s *Service) CheckRealtimeAccess(ctx context.Context, userID, projectID int64) error {
	_, err := s.projectByID(ctx, s.q, userID, projectID, RoleViewer)
	return err
}
