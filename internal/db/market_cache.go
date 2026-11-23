package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// StockPriceRow represents a cached daily close price and optional corporate action events.
type StockPriceRow struct {
	Symbol   string   `json:"symbol"`
	Date     string   `json:"date"`
	Price    float64  `json:"price"`
	Dividend *float64 `json:"dividend,omitempty"`
	Split    *float64 `json:"split,omitempty"`
}

// ExchangeRateRow represents a cached daily exchange rate between two currencies.
type ExchangeRateRow struct {
	BaseCurrency   string  `json:"baseCurrency"`
	TargetCurrency string  `json:"targetCurrency"`
	Date           string  `json:"date"`
	Rate           float64 `json:"rate"`
}

// GetStockPrices returns cached prices for symbol on or after fromDate (YYYY-MM-DD), ordered by date ASC.
func (s *Store) GetStockPrices(ctx context.Context, symbol, fromDate string) ([]StockPriceRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT symbol, date, price, dividend, split
		 FROM stock_prices
		 WHERE symbol = ? AND date >= ?
		 ORDER BY date ASC`,
		symbol, fromDate,
	)
	if err != nil {
		return nil, fmt.Errorf("get stock prices: %w", err)
	}
	defer rows.Close()

	out := []StockPriceRow{}
	for rows.Next() {
		var (
			r        StockPriceRow
			dividend sql.NullFloat64
			split    sql.NullFloat64
		)
		if err := rows.Scan(&r.Symbol, &r.Date, &r.Price, &dividend, &split); err != nil {
			return nil, fmt.Errorf("scan stock price: %w", err)
		}
		if dividend.Valid {
			v := dividend.Float64
			r.Dividend = &v
		}
		if split.Valid {
			v := split.Float64
			r.Split = &v
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stock prices: %w", err)
	}
	return out, nil
}

// GetLatestStockPriceDate returns the most recent cached date (YYYY-MM-DD) for symbol.
func (s *Store) GetLatestStockPriceDate(ctx context.Context, symbol string) (string, bool, error) {
	var date string
	err := s.db.QueryRowContext(ctx,
		`SELECT date FROM stock_prices WHERE symbol = ? ORDER BY date DESC LIMIT 1`,
		symbol,
	).Scan(&date)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get latest stock price date: %w", err)
	}
	return date, true, nil
}

// UpsertStockPrices inserts or updates daily stock prices for symbol in a single transaction.
func (s *Store) UpsertStockPrices(ctx context.Context, symbol string, rows []StockPriceRow) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO stock_prices (symbol, date, price, dividend, split)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(symbol, date) DO UPDATE SET
		   price = excluded.price,
		   dividend = excluded.dividend,
		   split = excluded.split`,
	)
	if err != nil {
		return fmt.Errorf("prepare upsert stock prices: %w", err)
	}
	defer stmt.Close()

	for _, r := range rows {
		var div, spl sql.NullFloat64
		if r.Dividend != nil {
			div = sql.NullFloat64{Float64: *r.Dividend, Valid: true}
		}
		if r.Split != nil {
			spl = sql.NullFloat64{Float64: *r.Split, Valid: true}
		}
		if _, err := stmt.ExecContext(ctx, symbol, r.Date, r.Price, div, spl); err != nil {
			return fmt.Errorf("upsert stock price (%s %s): %w", symbol, r.Date, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit stock prices: %w", err)
	}
	return nil
}

// GetExchangeRates returns cached rates for (base, target) on or after fromDate (YYYY-MM-DD), ordered by date ASC.
func (s *Store) GetExchangeRates(ctx context.Context, base, target, fromDate string) ([]ExchangeRateRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT base_currency, target_currency, date, rate
		 FROM exchange_rates
		 WHERE base_currency = ? AND target_currency = ? AND date >= ?
		 ORDER BY date ASC`,
		base, target, fromDate,
	)
	if err != nil {
		return nil, fmt.Errorf("get exchange rates: %w", err)
	}
	defer rows.Close()

	out := []ExchangeRateRow{}
	for rows.Next() {
		var r ExchangeRateRow
		if err := rows.Scan(&r.BaseCurrency, &r.TargetCurrency, &r.Date, &r.Rate); err != nil {
			return nil, fmt.Errorf("scan exchange rate: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate exchange rates: %w", err)
	}
	return out, nil
}

// GetLatestExchangeRateDate returns the most recent cached date (YYYY-MM-DD) for (base, target).
func (s *Store) GetLatestExchangeRateDate(ctx context.Context, base, target string) (string, bool, error) {
	var date string
	err := s.db.QueryRowContext(ctx,
		`SELECT date FROM exchange_rates WHERE base_currency = ? AND target_currency = ? ORDER BY date DESC LIMIT 1`,
		base, target,
	).Scan(&date)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get latest exchange rate date: %w", err)
	}
	return date, true, nil
}

// UpsertExchangeRates inserts or updates daily exchange rates for (base, target) in a single transaction.
func (s *Store) UpsertExchangeRates(ctx context.Context, base, target string, rows []ExchangeRateRow) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO exchange_rates (base_currency, target_currency, date, rate)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(base_currency, target_currency, date) DO UPDATE SET
		   rate = excluded.rate`,
	)
	if err != nil {
		return fmt.Errorf("prepare upsert exchange rates: %w", err)
	}
	defer stmt.Close()

	for _, r := range rows {
		if _, err := stmt.ExecContext(ctx, base, target, r.Date, r.Rate); err != nil {
			return fmt.Errorf("upsert exchange rate (%s/%s %s): %w", base, target, r.Date, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit exchange rates: %w", err)
	}
	return nil
}

// ClearMarketCache removes all cached stock prices and exchange rates.
func (s *Store) ClearMarketCache(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM stock_prices`); err != nil {
		return fmt.Errorf("clear stock_prices: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM exchange_rates`); err != nil {
		return fmt.Errorf("clear exchange_rates: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear market cache: %w", err)
	}
	return nil
}
