package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Portfolio represents a user-owned investment portfolio.
type Portfolio struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	UserID    string    `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func scanPortfolio(row interface{ Scan(dest ...any) error }) (Portfolio, error) {
	var (
		p          Portfolio
		createdStr string
		updatedStr string
	)
	if err := row.Scan(&p.ID, &p.Name, &p.UserID, &createdStr, &updatedStr); err != nil {
		return Portfolio{}, err
	}
	var err error
	if p.CreatedAt, err = parseTime(createdStr); err != nil {
		return Portfolio{}, fmt.Errorf("parse created_at: %w", err)
	}
	if p.UpdatedAt, err = parseTime(updatedStr); err != nil {
		return Portfolio{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return p, nil
}

// ListPortfolios returns all portfolios owned by userID, ordered by created_at ASC.
func (s *Store) ListPortfolios(ctx context.Context, userID string) ([]Portfolio, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, user_id, created_at, updated_at FROM portfolios WHERE user_id = ? ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list portfolios: %w", err)
	}
	defer rows.Close()

	portfolios := []Portfolio{}
	for rows.Next() {
		p, err := scanPortfolio(rows)
		if err != nil {
			return nil, fmt.Errorf("scan portfolio: %w", err)
		}
		portfolios = append(portfolios, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate portfolios: %w", err)
	}
	return portfolios, nil
}

// EnsureDefaultPortfolio returns the user's portfolios, creating a default "Portfolio" if none exist.
func (s *Store) EnsureDefaultPortfolio(ctx context.Context, userID string) ([]Portfolio, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx,
		`SELECT id, name, user_id, created_at, updated_at FROM portfolios WHERE user_id = ? ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list portfolios: %w", err)
	}

	portfolios := []Portfolio{}
	for rows.Next() {
		p, err := scanPortfolio(rows)
		if err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan portfolio: %w", err)
		}
		portfolios = append(portfolios, p)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate portfolios: %w", err)
	}
	_ = rows.Close()

	if len(portfolios) == 0 {
		id, err := newID()
		if err != nil {
			return nil, err
		}
		now := time.Now().UTC().Truncate(time.Second)
		nowStr := formatTime(now)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO portfolios (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			id, "Portfolio", userID, nowStr, nowStr,
		); err != nil {
			return nil, fmt.Errorf("insert default portfolio: %w", err)
		}
		portfolios = append(portfolios, Portfolio{
			ID:        id,
			Name:      "Portfolio",
			UserID:    userID,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}
	return portfolios, nil
}

// GetPortfolio fetches a single portfolio owned by userID, returning ErrNotFound if missing or unowned.
func (s *Store) GetPortfolio(ctx context.Context, portfolioID, userID string) (Portfolio, error) {
	p, err := scanPortfolio(s.db.QueryRowContext(ctx,
		`SELECT id, name, user_id, created_at, updated_at FROM portfolios WHERE id = ? AND user_id = ?`,
		portfolioID, userID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return Portfolio{}, ErrNotFound
	}
	if err != nil {
		return Portfolio{}, fmt.Errorf("get portfolio: %w", err)
	}
	return p, nil
}

// CreatePortfolio creates a new portfolio for userID.
func (s *Store) CreatePortfolio(ctx context.Context, userID, name string) (Portfolio, error) {
	id, err := newID()
	if err != nil {
		return Portfolio{}, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	nowStr := formatTime(now)

	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO portfolios (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, userID, nowStr, nowStr,
	); err != nil {
		return Portfolio{}, fmt.Errorf("create portfolio: %w", err)
	}

	return Portfolio{
		ID:        id,
		Name:      name,
		UserID:    userID,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// RenamePortfolio updates the name of a portfolio owned by userID, returning ErrNotFound if missing or unowned.
func (s *Store) RenamePortfolio(ctx context.Context, portfolioID, userID, name string) error {
	nowStr := formatTime(time.Now().UTC().Truncate(time.Second))
	res, err := s.db.ExecContext(ctx,
		`UPDATE portfolios SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		name, nowStr, portfolioID, userID,
	)
	if err != nil {
		return fmt.Errorf("rename portfolio: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePortfolio deletes a portfolio owned by userID, returning ErrNotFound if missing or unowned.
func (s *Store) DeletePortfolio(ctx context.Context, portfolioID, userID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM portfolios WHERE id = ? AND user_id = ?`,
		portfolioID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete portfolio: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
