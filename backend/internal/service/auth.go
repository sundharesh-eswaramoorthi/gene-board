package service

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/text/unicode/norm"

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

// ChangesPassword reports whether the request asks for a password change (and so has the
// current password verified).
func (in UpdateMeInput) ChangesPassword() bool {
	return in.CurrentPassword != nil || in.NewPassword != nil
}

var (
	errInvalidCredentials = httpx.Unauthorized("Invalid email or password")
	errAccountGone        = httpx.Unauthorized("Account no longer exists")
)

// ErrWrongCurrentPassword is UpdateMe's answer to a wrong currentPassword (the API counts
// these like failed logins).
var ErrWrongCurrentPassword = httpx.Validation("currentPassword", "is incorrect")

// Register creates a user account and returns a token for it.
func (s *Service) Register(ctx context.Context, in RegisterInput) (dto.AuthResponse, error) {
	email := normalizeEmail(in.Email)
	name := cleanName(in.Name)
	var fe httpx.FieldErrors
	checkEmail(&fe, "email", email)
	checkLength(&fe, "name", name, 1, maxUserName)
	checkPassword(&fe, "password", in.Password)
	if err := fe.Err(); err != nil {
		return dto.AuthResponse{}, err
	}

	hash, err := s.hasher.Hash(ctx, in.Password)
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
		_, _ = s.hasher.Verify(ctx, s.dummyHash(), in.Password)
		s.logger.InfoContext(ctx, "login failed", "reason", "unknown email")
		return dto.AuthResponse{}, errInvalidCredentials
	}
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("load user: %w", err)
	}
	ok, err := s.hasher.Verify(ctx, user.PasswordHash, in.Password)
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
		return dto.User{}, errAccountGone
	}
	if err != nil {
		return dto.User{}, fmt.Errorf("load user: %w", err)
	}
	return toUser(user), nil
}

// UpdateMe changes the name and/or password of the account token (the caller's access
// token, already checked by the auth middleware) was issued for. Changing the password
// revokes every token issued before (all sessions, including the caller's) and returns the
// account with a fresh token, which the client must switch to. Any other update returns the
// caller's own token: only the password yields a new session (the API budgets wrong current
// passwords per session).
//
// Only the changed columns are written, and a new password only replaces the one the
// current password was verified against: a concurrent PATCH /auth/me of the same account
// can neither be reverted by this one nor revert it. Of two password changes racing each
// other, the later one answers 409 (or 401 when the earlier one had already committed as it
// read the account); either way it writes nothing. A request whose token a concurrent
// password change revoked writes nothing and answers 401.
func (s *Service) UpdateMe(ctx context.Context, token string, in UpdateMeInput) (dto.AuthResponse, error) {
	userID, tokenVersion, err := s.tokens.Verify(token)
	if err != nil {
		return dto.AuthResponse{}, errInvalidToken
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if isNoRows(err) {
		return dto.AuthResponse{}, errAccountGone
	}
	if err != nil {
		return dto.AuthResponse{}, fmt.Errorf("load user: %w", err)
	}
	if user.TokenVersion != tokenVersion { // revoked since the auth middleware checked it
		return dto.AuthResponse{}, errInvalidToken
	}

	var fe httpx.FieldErrors
	var name *string // nil keeps the stored name
	if in.Name.Set {
		if in.Name.Null {
			fe.Add("name", "must not be null")
		} else {
			cleaned := cleanName(in.Name.Value)
			checkLength(&fe, "name", cleaned, 1, maxUserName)
			if cleaned != user.Name {
				name = &cleaned
			}
		}
	}
	changePassword := in.ChangesPassword()
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

	var hash *string // nil keeps the stored password
	if changePassword {
		ok, err := s.hasher.Verify(ctx, user.PasswordHash, *in.CurrentPassword)
		if err != nil {
			return dto.AuthResponse{}, err
		}
		if !ok {
			return dto.AuthResponse{}, ErrWrongCurrentPassword
		}
		newHash, err := s.hasher.Hash(ctx, *in.NewPassword)
		if err != nil {
			return dto.AuthResponse{}, err
		}
		hash = &newHash
	}
	if name == nil && hash == nil {
		return dto.AuthResponse{Token: token, User: toUser(user)}, nil
	}
	updated, err := s.q.UpdateUser(ctx, db.UpdateUserParams{
		ID: user.ID, Name: name, PasswordHash: hash,
		TokenVersion: tokenVersion, VerifiedPasswordHash: user.PasswordHash,
	})
	switch {
	case isNoRows(err) && hash != nil:
		// Another password change committed since the current password was verified (and
		// revoked the caller's token).
		return dto.AuthResponse{}, httpx.Conflict("Your password was just changed in another session. Sign in again with the new password.")
	case isNoRows(err):
		// A password change committed since the token was checked (or the account is gone).
		return dto.AuthResponse{}, errInvalidToken
	case err != nil:
		return dto.AuthResponse{}, fmt.Errorf("update user: %w", err)
	}
	if hash == nil {
		return dto.AuthResponse{Token: token, User: toUser(updated)}, nil
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
// unknown accounts. It is computed once, whatever happens to the request that needs it first.
func (s *Service) dummyHash() string {
	s.dummyOnce.Do(func() {
		s.dummy, _ = s.hasher.Hash(context.Background(), "geneboard-timing-equaliser")
	})
	return s.dummy
}

// DefaultUserSearchLimit and MaxUserSearchLimit bound GET /users.
const (
	DefaultUserSearchLimit = 20
	MaxUserSearchLimit     = 50
)

// SearchUsers finds users whose name or e-mail contains query (case-insensitive), ordered
// by name. An empty query lists the first users by name. The query is brought to NFC like
// the names and addresses it matches.
func (s *Service) SearchUsers(ctx context.Context, query string, limit int) ([]dto.UserSummary, error) {
	rows, err := s.q.SearchUsers(ctx, db.SearchUsersParams{
		Pattern:    escapeLike(norm.NFC.String(strings.TrimSpace(query))),
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
