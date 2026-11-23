package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Transaction represents a BUY or SELL transaction within a portfolio.
type Transaction struct {
	ID              string    `json:"id"`
	PortfolioID     string    `json:"portfolioId"`
	Symbol          string    `json:"symbol"`
	Type            string    `json:"type"`
	Quantity        float64   `json:"quantity"`
	PricePerShare   float64   `json:"pricePerShare"`
	Currency        string    `json:"currency"`
	TransactionDate time.Time `json:"transactionDate"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

func scanTransaction(row interface{ Scan(dest ...any) error }) (Transaction, error) {
	var (
		t          Transaction
		txDateStr  string
		createdStr string
		updatedStr string
	)
	if err := row.Scan(
		&t.ID, &t.PortfolioID, &t.Symbol, &t.Type,
		&t.Quantity, &t.PricePerShare, &t.Currency,
		&txDateStr, &createdStr, &updatedStr,
	); err != nil {
		return Transaction{}, err
	}
	var err error
	if t.TransactionDate, err = parseTime(txDateStr); err != nil {
		return Transaction{}, fmt.Errorf("parse transaction_date: %w", err)
	}
	if t.CreatedAt, err = parseTime(createdStr); err != nil {
		return Transaction{}, fmt.Errorf("parse created_at: %w", err)
	}
	if t.UpdatedAt, err = parseTime(updatedStr); err != nil {
		return Transaction{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return t, nil
}

// ListTransactions returns all transactions for portfolioID ordered by transaction_date ASC or DESC.
func (s *Store) ListTransactions(ctx context.Context, portfolioID string, asc bool) ([]Transaction, error) {
	order := "DESC"
	if asc {
		order = "ASC"
	}
	query := fmt.Sprintf(
		`SELECT id, portfolio_id, symbol, type, quantity, price_per_share, currency, transaction_date, created_at, updated_at
		 FROM transactions
		 WHERE portfolio_id = ?
		 ORDER BY transaction_date %s, created_at %s`,
		order, order,
	)
	rows, err := s.db.QueryContext(ctx, query, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	txs := []Transaction{}
	for rows.Next() {
		t, err := scanTransaction(rows)
		if err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		txs = append(txs, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate transactions: %w", err)
	}
	return txs, nil
}

// GetFirstTransactionDate returns the earliest transaction_date for portfolioID.
func (s *Store) GetFirstTransactionDate(ctx context.Context, portfolioID string) (time.Time, bool, error) {
	var dateStr string
	err := s.db.QueryRowContext(ctx,
		`SELECT transaction_date FROM transactions WHERE portfolio_id = ? ORDER BY transaction_date ASC LIMIT 1`,
		portfolioID,
	).Scan(&dateStr)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("get first transaction date: %w", err)
	}
	t, err := parseTime(dateStr)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("parse transaction_date: %w", err)
	}
	return t, true, nil
}

// CreateTransaction inserts a single transaction and returns the stored record.
func (s *Store) CreateTransaction(ctx context.Context, tx Transaction) (Transaction, error) {
	if tx.ID == "" {
		id, err := newID()
		if err != nil {
			return Transaction{}, err
		}
		tx.ID = id
	}
	now := time.Now().UTC().Truncate(time.Second)
	if tx.TransactionDate.IsZero() {
		tx.TransactionDate = now
	} else {
		tx.TransactionDate = tx.TransactionDate.UTC().Truncate(time.Second)
	}
	tx.CreatedAt = now
	tx.UpdatedAt = now

	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO transactions (id, portfolio_id, symbol, type, quantity, price_per_share, currency, transaction_date, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		tx.ID, tx.PortfolioID, tx.Symbol, tx.Type,
		tx.Quantity, tx.PricePerShare, tx.Currency,
		formatTime(tx.TransactionDate), formatTime(tx.CreatedAt), formatTime(tx.UpdatedAt),
	); err != nil {
		return Transaction{}, fmt.Errorf("create transaction: %w", err)
	}
	return tx, nil
}

// CreateTransactionsBatch inserts multiple transactions within a single database transaction.
func (s *Store) CreateTransactionsBatch(ctx context.Context, txs []Transaction) error {
	if len(txs) == 0 {
		return nil
	}

	dbTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = dbTx.Rollback() }()

	stmt, err := dbTx.PrepareContext(ctx,
		`INSERT INTO transactions (id, portfolio_id, symbol, type, quantity, price_per_share, currency, transaction_date, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	now := time.Now().UTC().Truncate(time.Second)
	nowStr := formatTime(now)

	for _, item := range txs {
		id := item.ID
		if id == "" {
			id, err = newID()
			if err != nil {
				return err
			}
		}
		txDate := item.TransactionDate
		if txDate.IsZero() {
			txDate = now
		} else {
			txDate = txDate.UTC().Truncate(time.Second)
		}
		if _, err := stmt.ExecContext(ctx,
			id, item.PortfolioID, item.Symbol, item.Type,
			item.Quantity, item.PricePerShare, item.Currency,
			formatTime(txDate), nowStr, nowStr,
		); err != nil {
			return fmt.Errorf("insert transaction in batch: %w", err)
		}
	}

	if err := dbTx.Commit(); err != nil {
		return fmt.Errorf("commit batch: %w", err)
	}
	return nil
}

// UpdateTransaction updates an existing transaction after verifying portfolio ownership by userID.
func (s *Store) UpdateTransaction(ctx context.Context, userID string, tx Transaction) (Transaction, error) {
	now := time.Now().UTC().Truncate(time.Second)
	if tx.TransactionDate.IsZero() {
		tx.TransactionDate = now
	} else {
		tx.TransactionDate = tx.TransactionDate.UTC().Truncate(time.Second)
	}
	tx.UpdatedAt = now

	var createdStr string
	err := s.db.QueryRowContext(ctx,
		`UPDATE transactions
		 SET symbol = ?, type = ?, quantity = ?, price_per_share = ?, currency = ?, transaction_date = ?, updated_at = ?
		 WHERE id = ? AND portfolio_id = ?
		   AND EXISTS (SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?)
		 RETURNING created_at`,
		tx.Symbol, tx.Type, tx.Quantity, tx.PricePerShare, tx.Currency,
		formatTime(tx.TransactionDate), formatTime(tx.UpdatedAt),
		tx.ID, tx.PortfolioID, tx.PortfolioID, userID,
	).Scan(&createdStr)
	if errors.Is(err, sql.ErrNoRows) {
		return Transaction{}, ErrNotFound
	}
	if err != nil {
		return Transaction{}, fmt.Errorf("update transaction: %w", err)
	}
	if tx.CreatedAt, err = parseTime(createdStr); err != nil {
		return Transaction{}, fmt.Errorf("parse created_at: %w", err)
	}
	return tx, nil
}

// DeleteTransaction deletes a single transaction after verifying portfolio ownership by userID.
func (s *Store) DeleteTransaction(ctx context.Context, userID, portfolioID, txID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM transactions
		 WHERE id = ? AND portfolio_id = ?
		   AND EXISTS (SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?)`,
		txID, portfolioID, portfolioID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
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

// DeleteAllTransactions deletes all transactions in portfolioID after verifying ownership by userID.
func (s *Store) DeleteAllTransactions(ctx context.Context, userID, portfolioID string) error {
	dbTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = dbTx.Rollback() }()

	var exists int
	err = dbTx.QueryRowContext(ctx,
		`SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?`,
		portfolioID, userID,
	).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("verify portfolio ownership: %w", err)
	}

	if _, err := dbTx.ExecContext(ctx,
		`DELETE FROM transactions WHERE portfolio_id = ?`,
		portfolioID,
	); err != nil {
		return fmt.Errorf("delete all transactions: %w", err)
	}

	if err := dbTx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
