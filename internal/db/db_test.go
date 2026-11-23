package db

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open(:memory:) error = %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	return store
}

func TestOpenFileCreatesParentDirAndWAL(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nested", "dir", "hold.db")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open(%q) error = %v", dbPath, err)
	}
	defer store.Close()

	var mode string
	if err := store.db.QueryRow(`PRAGMA journal_mode;`).Scan(&mode); err != nil {
		t.Fatalf("query journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want %q", mode, "wal")
	}
}

func TestUsersAndOIDC(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	// FindOrCreateUserByEmail creates and then finds idempotently.
	u1, err := store.FindOrCreateUserByEmail(ctx, "alice@example.com", "Alice")
	if err != nil {
		t.Fatalf("FindOrCreateUserByEmail(create) error = %v", err)
	}
	if u1.ID == "" || u1.Email != "alice@example.com" || u1.Name != "Alice" {
		t.Fatalf("unexpected user: %+v", u1)
	}

	u1Again, err := store.FindOrCreateUserByEmail(ctx, "alice@example.com", "Alice Ignored")
	if err != nil {
		t.Fatalf("FindOrCreateUserByEmail(find) error = %v", err)
	}
	if u1Again.ID != u1.ID {
		t.Errorf("idempotent lookup returned %q, want %q", u1Again.ID, u1.ID)
	}

	// GetUserByID
	got, err := store.GetUserByID(ctx, u1.ID)
	if err != nil {
		t.Fatalf("GetUserByID error = %v", err)
	}
	if got.ID != u1.ID || got.Email != u1.Email {
		t.Errorf("GetUserByID = %+v, want %+v", got, u1)
	}
	if _, err := store.GetUserByID(ctx, "nonexistent"); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetUserByID(nonexistent) err = %v, want ErrNotFound", err)
	}

	// OIDC user with matching email links to existing user.
	linked, err := store.FindOrCreateOIDCUser(ctx, "authelia", "sub-alice", "alice@example.com", "Alice OIDC", "https://img/a.png")
	if err != nil {
		t.Fatalf("FindOrCreateOIDCUser(link by email) error = %v", err)
	}
	if linked.ID != u1.ID {
		t.Errorf("linked user ID = %q, want %q", linked.ID, u1.ID)
	}

	// Subsequent OIDC login resolves via accounts table.
	linkedAgain, err := store.FindOrCreateOIDCUser(ctx, "authelia", "sub-alice", "alice@example.com", "Alice", "")
	if err != nil {
		t.Fatalf("FindOrCreateOIDCUser(repeat) error = %v", err)
	}
	if linkedAgain.ID != u1.ID {
		t.Errorf("repeat OIDC user ID = %q, want %q", linkedAgain.ID, u1.ID)
	}

	// Multiple OIDC users without email do not collide on UNIQUE(email).
	noEmail1, err := store.FindOrCreateOIDCUser(ctx, "authelia", "sub-1", "", "User One", "")
	if err != nil {
		t.Fatalf("FindOrCreateOIDCUser(no email 1) error = %v", err)
	}
	noEmail2, err := store.FindOrCreateOIDCUser(ctx, "authelia", "sub-2", "", "User Two", "")
	if err != nil {
		t.Fatalf("FindOrCreateOIDCUser(no email 2) error = %v", err)
	}
	if noEmail1.ID == noEmail2.ID {
		t.Errorf("expected distinct users for distinct OIDC subjects")
	}
}

func TestPortfoliosAndCascade(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	alice, err := store.FindOrCreateUserByEmail(ctx, "alice@example.com", "Alice")
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := store.FindOrCreateUserByEmail(ctx, "bob@example.com", "Bob")
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}

	// EnsureDefaultPortfolio creates "Portfolio" when empty, and is idempotent.
	ps, err := store.EnsureDefaultPortfolio(ctx, alice.ID)
	if err != nil {
		t.Fatalf("EnsureDefaultPortfolio error = %v", err)
	}
	if len(ps) != 1 || ps[0].Name != "Portfolio" {
		t.Fatalf("EnsureDefaultPortfolio = %+v, want 1 default Portfolio", ps)
	}
	ps2, err := store.EnsureDefaultPortfolio(ctx, alice.ID)
	if err != nil {
		t.Fatalf("EnsureDefaultPortfolio(second) error = %v", err)
	}
	if len(ps2) != 1 || ps2[0].ID != ps[0].ID {
		t.Fatalf("EnsureDefaultPortfolio(second) = %+v, want same single portfolio", ps2)
	}

	// Create second portfolio and verify ordering.
	p2, err := store.CreatePortfolio(ctx, alice.ID, "Retirement")
	if err != nil {
		t.Fatalf("CreatePortfolio error = %v", err)
	}
	listed, err := store.ListPortfolios(ctx, alice.ID)
	if err != nil {
		t.Fatalf("ListPortfolios error = %v", err)
	}
	if len(listed) != 2 || listed[0].ID != ps[0].ID || listed[1].ID != p2.ID {
		t.Fatalf("ListPortfolios = %+v, want [default, Retirement]", listed)
	}

	// Ownership isolation.
	if _, err := store.GetPortfolio(ctx, p2.ID, bob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetPortfolio(wrong user) err = %v, want ErrNotFound", err)
	}
	if err := store.RenamePortfolio(ctx, p2.ID, bob.ID, "Hacked"); !errors.Is(err, ErrNotFound) {
		t.Errorf("RenamePortfolio(wrong user) err = %v, want ErrNotFound", err)
	}
	if err := store.DeletePortfolio(ctx, p2.ID, bob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeletePortfolio(wrong user) err = %v, want ErrNotFound", err)
	}

	// Rename by owner.
	if err := store.RenamePortfolio(ctx, p2.ID, alice.ID, "IRA"); err != nil {
		t.Fatalf("RenamePortfolio error = %v", err)
	}
	got, err := store.GetPortfolio(ctx, p2.ID, alice.ID)
	if err != nil {
		t.Fatalf("GetPortfolio error = %v", err)
	}
	if got.Name != "IRA" {
		t.Errorf("Name = %q, want %q", got.Name, "IRA")
	}

	// Add transaction then delete portfolio to verify ON DELETE CASCADE.
	_, err = store.CreateTransaction(ctx, Transaction{
		PortfolioID:     p2.ID,
		Symbol:          "AAPL",
		Type:            "BUY",
		Quantity:        10,
		PricePerShare:   150,
		Currency:        "USD",
		TransactionDate: time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("CreateTransaction error = %v", err)
	}

	if err := store.DeletePortfolio(ctx, p2.ID, alice.ID); err != nil {
		t.Fatalf("DeletePortfolio error = %v", err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE portfolio_id = ?`, p2.ID).Scan(&count); err != nil {
		t.Fatalf("count cascaded transactions: %v", err)
	}
	if count != 0 {
		t.Errorf("remaining transactions after portfolio delete = %d, want 0", count)
	}
}

func TestTransactionsCRUDAndOwnership(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	alice, err := store.FindOrCreateUserByEmail(ctx, "alice@example.com", "Alice")
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := store.FindOrCreateUserByEmail(ctx, "bob@example.com", "Bob")
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	p, err := store.CreatePortfolio(ctx, alice.ID, "Main")
	if err != nil {
		t.Fatalf("create portfolio: %v", err)
	}

	// Empty portfolio: GetFirstTransactionDate returns false.
	if _, ok, err := store.GetFirstTransactionDate(ctx, p.ID); err != nil || ok {
		t.Fatalf("GetFirstTransactionDate(empty) = (%v, %v), want (_, false, nil)", ok, err)
	}

	d1 := time.Date(2024, 1, 5, 12, 0, 0, 0, time.UTC)
	d2 := time.Date(2024, 2, 10, 12, 0, 0, 0, time.UTC)
	d3 := time.Date(2024, 3, 15, 12, 0, 0, 0, time.UTC)

	tx2, err := store.CreateTransaction(ctx, Transaction{
		PortfolioID:     p.ID,
		Symbol:          "AAPL",
		Type:            "BUY",
		Quantity:        5,
		PricePerShare:   180,
		Currency:        "USD",
		TransactionDate: d2,
	})
	if err != nil {
		t.Fatalf("CreateTransaction error = %v", err)
	}

	if err := store.CreateTransactionsBatch(ctx, []Transaction{
		{
			PortfolioID:     p.ID,
			Symbol:          "VWCE.DE",
			Type:            "BUY",
			Quantity:        10,
			PricePerShare:   100,
			Currency:        "EUR",
			TransactionDate: d1,
		},
		{
			PortfolioID:     p.ID,
			Symbol:          "AAPL",
			Type:            "SELL",
			Quantity:        2,
			PricePerShare:   190,
			Currency:        "USD",
			TransactionDate: d3,
		},
	}); err != nil {
		t.Fatalf("CreateTransactionsBatch error = %v", err)
	}

	// Ordering ASC and DESC.
	ascList, err := store.ListTransactions(ctx, p.ID, true)
	if err != nil {
		t.Fatalf("ListTransactions(asc) error = %v", err)
	}
	if len(ascList) != 3 || !ascList[0].TransactionDate.Equal(d1) || !ascList[2].TransactionDate.Equal(d3) {
		t.Fatalf("ListTransactions(asc) unexpected order: %+v", ascList)
	}

	descList, err := store.ListTransactions(ctx, p.ID, false)
	if err != nil {
		t.Fatalf("ListTransactions(desc) error = %v", err)
	}
	if len(descList) != 3 || !descList[0].TransactionDate.Equal(d3) || !descList[2].TransactionDate.Equal(d1) {
		t.Fatalf("ListTransactions(desc) unexpected order: %+v", descList)
	}

	// First transaction date.
	first, ok, err := store.GetFirstTransactionDate(ctx, p.ID)
	if err != nil || !ok || !first.Equal(d1) {
		t.Fatalf("GetFirstTransactionDate = (%v, %v, %v), want (%v, true, nil)", first, ok, err, d1)
	}

	// Update ownership check.
	tx2.Quantity = 8
	if _, err := store.UpdateTransaction(ctx, bob.ID, tx2); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdateTransaction(wrong user) err = %v, want ErrNotFound", err)
	}
	updated, err := store.UpdateTransaction(ctx, alice.ID, tx2)
	if err != nil {
		t.Fatalf("UpdateTransaction error = %v", err)
	}
	if updated.Quantity != 8 || updated.CreatedAt.IsZero() {
		t.Errorf("UpdateTransaction = %+v, want quantity=8 and non-zero CreatedAt", updated)
	}

	// Delete single transaction ownership check.
	if err := store.DeleteTransaction(ctx, bob.ID, p.ID, tx2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteTransaction(wrong user) err = %v, want ErrNotFound", err)
	}
	if err := store.DeleteTransaction(ctx, alice.ID, p.ID, tx2.ID); err != nil {
		t.Fatalf("DeleteTransaction error = %v", err)
	}

	// DeleteAllTransactions ownership check & empty portfolio behavior.
	if err := store.DeleteAllTransactions(ctx, bob.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteAllTransactions(wrong user) err = %v, want ErrNotFound", err)
	}
	if err := store.DeleteAllTransactions(ctx, alice.ID, p.ID); err != nil {
		t.Fatalf("DeleteAllTransactions error = %v", err)
	}
	// Calling DeleteAllTransactions again on an empty owned portfolio should succeed.
	if err := store.DeleteAllTransactions(ctx, alice.ID, p.ID); err != nil {
		t.Fatalf("DeleteAllTransactions(empty owned) error = %v", err)
	}
}

func TestMarketCache(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	if _, ok, err := store.GetLatestStockPriceDate(ctx, "AAPL"); err != nil || ok {
		t.Fatalf("GetLatestStockPriceDate(empty) = (%v, %v), want (false, nil)", ok, err)
	}
	if _, ok, err := store.GetLatestExchangeRateDate(ctx, "EUR", "USD"); err != nil || ok {
		t.Fatalf("GetLatestExchangeRateDate(empty) = (%v, %v), want (false, nil)", ok, err)
	}

	div := 0.24
	spl := 2.0
	err := store.UpsertStockPrices(ctx, "AAPL", []StockPriceRow{
		{Date: "2024-01-02", Price: 185.0},
		{Date: "2024-01-03", Price: 186.5, Dividend: &div},
		{Date: "2024-01-04", Price: 94.0, Split: &spl},
	})
	if err != nil {
		t.Fatalf("UpsertStockPrices error = %v", err)
	}

	// Upsert conflict updates existing row.
	if err := store.UpsertStockPrices(ctx, "AAPL", []StockPriceRow{
		{Date: "2024-01-03", Price: 187.0, Dividend: &div},
	}); err != nil {
		t.Fatalf("UpsertStockPrices(update) error = %v", err)
	}

	latestStock, ok, err := store.GetLatestStockPriceDate(ctx, "AAPL")
	if err != nil || !ok || latestStock != "2024-01-04" {
		t.Fatalf("GetLatestStockPriceDate = (%q, %v, %v), want (2024-01-04, true, nil)", latestStock, ok, err)
	}

	prices, err := store.GetStockPrices(ctx, "AAPL", "2024-01-03")
	if err != nil {
		t.Fatalf("GetStockPrices error = %v", err)
	}
	if len(prices) != 2 {
		t.Fatalf("len(prices) = %d, want 2", len(prices))
	}
	if prices[0].Price != 187.0 || prices[0].Dividend == nil || *prices[0].Dividend != 0.24 || prices[0].Split != nil {
		t.Errorf("prices[0] = %+v, unexpected fields", prices[0])
	}
	if prices[1].Split == nil || *prices[1].Split != 2.0 || prices[1].Dividend != nil {
		t.Errorf("prices[1] = %+v, unexpected fields", prices[1])
	}

	// Exchange rates.
	err = store.UpsertExchangeRates(ctx, "EUR", "USD", []ExchangeRateRow{
		{Date: "2024-01-02", Rate: 1.09},
		{Date: "2024-01-03", Rate: 1.10},
	})
	if err != nil {
		t.Fatalf("UpsertExchangeRates error = %v", err)
	}
	if err := store.UpsertExchangeRates(ctx, "EUR", "USD", []ExchangeRateRow{
		{Date: "2024-01-03", Rate: 1.11},
	}); err != nil {
		t.Fatalf("UpsertExchangeRates(update) error = %v", err)
	}

	latestFX, ok, err := store.GetLatestExchangeRateDate(ctx, "EUR", "USD")
	if err != nil || !ok || latestFX != "2024-01-03" {
		t.Fatalf("GetLatestExchangeRateDate = (%q, %v, %v), want (2024-01-03, true, nil)", latestFX, ok, err)
	}

	rates, err := store.GetExchangeRates(ctx, "EUR", "USD", "2024-01-03")
	if err != nil {
		t.Fatalf("GetExchangeRates error = %v", err)
	}
	if len(rates) != 1 || rates[0].Rate != 1.11 {
		t.Fatalf("rates = %+v, want single row with rate 1.11", rates)
	}

	// ClearMarketCache clears both tables.
	if err := store.ClearMarketCache(ctx); err != nil {
		t.Fatalf("ClearMarketCache error = %v", err)
	}
	if _, ok, err := store.GetLatestStockPriceDate(ctx, "AAPL"); err != nil || ok {
		t.Errorf("stock_prices not cleared: ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.GetLatestExchangeRateDate(ctx, "EUR", "USD"); err != nil || ok {
		t.Errorf("exchange_rates not cleared: ok=%v err=%v", ok, err)
	}
}
