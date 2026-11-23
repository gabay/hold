package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// User represents an application user.
type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Image     string    `json:"image"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func scanUser(row interface{ Scan(dest ...any) error }) (User, error) {
	var (
		u          User
		email      sql.NullString
		createdStr string
		updatedStr string
	)
	if err := row.Scan(&u.ID, &u.Name, &email, &u.Image, &createdStr, &updatedStr); err != nil {
		return User{}, err
	}
	u.Email = email.String

	var err error
	if u.CreatedAt, err = parseTime(createdStr); err != nil {
		return User{}, fmt.Errorf("parse created_at: %w", err)
	}
	if u.UpdatedAt, err = parseTime(updatedStr); err != nil {
		return User{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return u, nil
}

// FindOrCreateUserByEmail looks up a user by email or creates one if none exists.
func (s *Store) FindOrCreateUserByEmail(ctx context.Context, email, name string) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if email != "" {
		u, err := scanUser(tx.QueryRowContext(ctx,
			`SELECT id, name, email, image, created_at, updated_at FROM users WHERE email = ?`,
			email,
		))
		if err == nil {
			if err := tx.Commit(); err != nil {
				return User{}, fmt.Errorf("commit tx: %w", err)
			}
			return u, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return User{}, fmt.Errorf("query user by email: %w", err)
		}
	}

	id, err := newID()
	if err != nil {
		return User{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	nowStr := formatTime(now)

	var emailParam sql.NullString
	if email != "" {
		emailParam = sql.NullString{String: email, Valid: true}
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, name, email, image, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)`,
		id, name, emailParam, nowStr, nowStr,
	); err != nil {
		return User{}, fmt.Errorf("insert user: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit tx: %w", err)
	}

	return User{
		ID:        id,
		Name:      name,
		Email:     email,
		Image:     "",
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// FindOrCreateOIDCUser looks up an account by (provider, providerAccountID),
// falling back to matching an existing user by email or creating a new user and account.
func (s *Store) FindOrCreateOIDCUser(ctx context.Context, provider, providerAccountID, email, name, image string) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var userID string
	err = tx.QueryRowContext(ctx,
		`SELECT user_id FROM accounts WHERE provider = ? AND provider_account_id = ?`,
		provider, providerAccountID,
	).Scan(&userID)
	if err == nil {
		u, err := scanUser(tx.QueryRowContext(ctx,
			`SELECT id, name, email, image, created_at, updated_at FROM users WHERE id = ?`,
			userID,
		))
		if err != nil {
			return User{}, fmt.Errorf("load linked user: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return User{}, fmt.Errorf("commit tx: %w", err)
		}
		return u, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return User{}, fmt.Errorf("query account: %w", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	nowStr := formatTime(now)

	var user User
	foundByEmail := false
	if email != "" {
		u, err := scanUser(tx.QueryRowContext(ctx,
			`SELECT id, name, email, image, created_at, updated_at FROM users WHERE email = ?`,
			email,
		))
		if err == nil {
			user = u
			foundByEmail = true
		} else if !errors.Is(err, sql.ErrNoRows) {
			return User{}, fmt.Errorf("query user by email: %w", err)
		}
	}

	if !foundByEmail {
		uid, err := newID()
		if err != nil {
			return User{}, err
		}
		var emailParam sql.NullString
		if email != "" {
			emailParam = sql.NullString{String: email, Valid: true}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO users (id, name, email, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			uid, name, emailParam, image, nowStr, nowStr,
		); err != nil {
			return User{}, fmt.Errorf("insert user: %w", err)
		}
		user = User{
			ID:        uid,
			Name:      name,
			Email:     email,
			Image:     image,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	accID, err := newID()
	if err != nil {
		return User{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO accounts (id, user_id, provider, provider_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		accID, user.ID, provider, providerAccountID, nowStr, nowStr,
	); err != nil {
		return User{}, fmt.Errorf("insert account: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit tx: %w", err)
	}
	return user, nil
}

// GetUserByID retrieves a user by ID, returning ErrNotFound if absent.
func (s *Store) GetUserByID(ctx context.Context, id string) (User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx,
		`SELECT id, name, email, image, created_at, updated_at FROM users WHERE id = ?`,
		id,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}
