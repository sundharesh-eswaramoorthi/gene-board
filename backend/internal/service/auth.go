package service

import (
	"context"
	"fmt"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
)

// RegisterInput is the body of POST /auth/register.
type RegisterInput struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

// LoginInput is the body of POST /auth/login.
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// UpdateMeInput is the body of PATCH /auth/me. Changing the password needs both
// currentPassword and newPassword.
type UpdateMeInput struct {
	Name            httpx.Optional[string] `json:"name,omitzero"`
	CurrentPassword *string                `json:"currentPassword"`
	NewPassword     *string                `json:"newPassword"`
}

var errInvalidCredentials = httpx.Unauthorized("Invalid email or password")

// Register creates a user account and returns a token for it.
func (s *Service) Register(ctx context.Context, in RegisterInput) (dto.AuthResponse, error) {
	email := normalizeEmail(in.Email)
	name := strings.TrimSpace(in.Name)
	var fe httpx.FieldErrors
	checkEmail(&fe, "email", email)
	checkLength(&fe, "name", name, 1, maxUserName)
	checkPassword(&fe, "password", in.Password)
	if err := fe.Err(); err != nil {
		return dto.AuthResponse{}, err
	}

	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return dto.AuthResponse{}, err
	}
	user, err := s.q.CreateUser(ctx, db.CreateUserParams{Email: email, Name: name, PasswordHash: hash})
	if isUniqueViolation(err) {
		return dto.AuthResponse{}, httpx.Conflict("An account with this email already exists")
	}
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("create user: %w", err)
	}
	return s.authResponse(user)
}

// Login verifies credentials and returns a fresh token.
func (s *Service) Login(ctx context.Context, in LoginInput) (dto.AuthResponse, error) {
	email := normalizeEmail(in.Email)
	if email == "" || in.Password == "" || !httpx.ValidText(email) { // no account has such an e-mail
		return dto.AuthResponse{}, errInvalidCredentials
	}
	user, err := s.q.GetUserByEmail(ctx, email)
	if isNoRows(err) {
		// Burn comparable CPU time so response timing does not reveal unknown e-mails.
		_, _ = s.hasher.Verify(s.dummyHash(), in.Password)
		s.logger.InfoContext(ctx, "login failed", "reason", "unknown email")
		return dto.AuthResponse{}, errInvalidCredentials
	}
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("load user: %w", err)
	}
	ok, err := s.hasher.Verify(user.PasswordHash, in.Password)
	if err != nil {
		return dto.AuthResponse{}, err
	}
	if !ok {
		s.logger.InfoContext(ctx, "login failed", "reason", "wrong password", "user_id", user.ID)
		return dto.AuthResponse{}, errInvalidCredentials
	}
	return s.authResponse(user)
}

// Me returns the caller's account. A token for a deleted user yields 401.
func (s *Service) Me(ctx context.Context, userID int64) (dto.User, error) {
	user, err := s.q.GetUserByID(ctx, userID)
	if isNoRows(err) {
		return dto.User{}, httpx.Unauthorized("Account no longer exists")
	}
	if err != nil {
		return dto.User{}, fmt.Errorf("load user: %w", err)
	}
	return toUser(user), nil
}

// UpdateMe changes the caller's name and/or password and returns the account with a fresh
// token. Changing the password revokes every token issued before (all sessions, including
// the caller's), so the client must switch to the returned token.
func (s *Service) UpdateMe(ctx context.Context, userID int64, in UpdateMeInput) (dto.AuthResponse, error) {
	user, err := s.q.GetUserByID(ctx, userID)
	if isNoRows(err) {
		return dto.AuthResponse{}, httpx.Unauthorized("Account no longer exists")
	}
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("load user: %w", err)
	}

	var fe httpx.FieldErrors
	name := user.Name
	if in.Name.Set {
		if in.Name.Null {
			fe.Add("name", "must not be null")
		} else {
			name = strings.TrimSpace(in.Name.Value)
			checkLength(&fe, "name", name, 1, maxUserName)
		}
	}
	changePassword := in.CurrentPassword != nil || in.NewPassword != nil
	if changePassword {
		if in.CurrentPassword == nil || *in.CurrentPassword == "" {
			fe.Add("currentPassword", "is required to change the password")
		}
		if in.NewPassword == nil {
			fe.Add("newPassword", "is required")
		} else {
			checkPassword(&fe, "newPassword", *in.NewPassword)
		}
	}
	if err := fe.Err(); err != nil {
		return dto.AuthResponse{}, err
	}

	hash := user.PasswordHash
	if changePassword {
		ok, err := s.hasher.Verify(user.PasswordHash, *in.CurrentPassword)
		if err != nil {
			return dto.AuthResponse{}, err
		}
		if !ok {
			return dto.AuthResponse{}, httpx.Validation("currentPassword", "is incorrect")
		}
		if hash, err = s.hasher.Hash(*in.NewPassword); err != nil {
			return dto.AuthResponse{}, err
		}
	}
	if name == user.Name && !changePassword {
		return s.authResponse(user)
	}
	updated, err := s.q.UpdateUser(ctx, db.UpdateUserParams{ID: user.ID, Name: name, PasswordHash: hash, RevokeTokens: changePassword})
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("update user: %w", err)
	}
	return s.authResponse(updated)
}

func (s *Service) authResponse(user db.User) (dto.AuthResponse, error) {
	token, err := s.tokens.Issue(user.ID, user.TokenVersion)
	if err != nil {
		return dto.AuthResponse{}, err
	}
	return dto.AuthResponse{Token: token, User: toUser(user)}, nil
}

// dummyHash is a bcrypt hash (at the configured cost) used to equalise login timing for
// unknown accounts.
func (s *Service) dummyHash() string {
	s.dummyOnce.Do(func() {
		s.dummy, _ = s.hasher.Hash("geneboard-timing-equaliser")
	})
	return s.dummy
}

// DefaultUserSearchLimit and MaxUserSearchLimit bound GET /users.
const (
	DefaultUserSearchLimit = 20
	MaxUserSearchLimit     = 50
)

// SearchUsers finds users whose name or e-mail contains query (case-insensitive), ordered
// by name. An empty query lists the first users by name.
func (s *Service) SearchUsers(ctx context.Context, query string, limit int) ([]dto.UserSummary, error) {
	rows, err := s.q.SearchUsers(ctx, db.SearchUsersParams{
		Pattern:    escapeLike(strings.TrimSpace(query)),
		MaxResults: int32(clampLimit(limit, DefaultUserSearchLimit, MaxUserSearchLimit)),
	})
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	out := make([]dto.UserSummary, len(rows))
	for i, u := range rows {
		out[i] = toUserSummary(u)
	}
	return out, nil
}
