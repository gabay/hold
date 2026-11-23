package portfolio

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
)

func openTestStore(t *testing.T) *db.Store {
	t.Helper()
	s, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func approxEqual(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

func TestAssetDataCalculator(t *testing.T) {
	baseDate := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	day1 := finance.AddDays(baseDate, 1)
	day3 := finance.AddDays(baseDate, 3)
	day5 := finance.AddDays(baseDate, 5)
	day7 := finance.AddDays(baseDate, 7)

	t.Run("buys and sells", func(t *testing.T) {
		txs := []db.Transaction{
			{Symbol: "AAPL", Type: "BUY", Quantity: 10, PricePerShare: 100, TransactionDate: baseDate},
			{Symbol: "AAPL", Type: "SELL", Quantity: 3, PricePerShare: 120, TransactionDate: day1},
		}
		calc := NewAssetDataCalculator(txs, &finance.AssetInfo{Symbol: "AAPL"})
		if q := calc.GetQuantity(day1); q != 7 {
			t.Fatalf("expected quantity 7, got %v", q)
		}
		if c := calc.GetCost(day1); c != 640 {
			t.Fatalf("expected cost 640, got %v", c)
		}
	})

	t.Run("splits before dividends and transactions on same day", func(t *testing.T) {
		txs := []db.Transaction{
			{Symbol: "AAPL", Type: "BUY", Quantity: 10, PricePerShare: 100, TransactionDate: baseDate},
			{Symbol: "AAPL", Type: "BUY", Quantity: 5, PricePerShare: 50, TransactionDate: day5},
		}
		info := &finance.AssetInfo{
			Symbol:    "AAPL",
			Splits:    map[string]float64{finance.DateKey(day5): 2},
			Dividends: map[string]float64{finance.DateKey(day5): 1},
			Prices:    map[string]float64{finance.DateKey(day5): 60},
		}
		calc := NewAssetDataCalculator(txs, info)

		// Before split (day 3): 10 shares, 0 realized
		if q := calc.GetQuantity(day3); q != 10 {
			t.Fatalf("expected 10 before split, got %v", q)
		}
		if r := calc.GetRealized(day3); r != 0 {
			t.Fatalf("expected 0 realized before dividend, got %v", r)
		}

		// On day 5: split (10 -> 20), then dividend (20 * 1 = 20), then buy (+5 -> 25)
		if q := calc.GetQuantity(day5); q != 25 {
			t.Fatalf("expected 25 on split+buy day, got %v", q)
		}
		if r := calc.GetRealized(day5); r != 20 {
			t.Fatalf("expected 20 realized (split before dividend), got %v", r)
		}
		if q := calc.GetQuantity(day7); q != 25 {
			t.Fatalf("expected 25 after split, got %v", q)
		}

		pt := calc.GetChartDataPoint(day5)
		if pt.Date != "2024-06-06" || pt.Valuation != 25*60 || pt.Invested != 1250 || pt.Realized != 20 {
			t.Fatalf("unexpected chart point: %+v", pt)
		}
	})
}

func TestParseDays(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	user, err := store.FindOrCreateUserByEmail(ctx, "test@example.com", "Test")
	if err != nil {
		t.Fatalf("FindOrCreateUserByEmail: %v", err)
	}
	p, err := store.CreatePortfolio(ctx, user.ID, "Main")
	if err != nil {
		t.Fatalf("CreatePortfolio: %v", err)
	}

	svc := NewService(store, nil)
	now := time.Date(2024, 6, 15, 15, 30, 0, 0, time.UTC)

	// Default / invalid -> 30 days (31 inclusive)
	daysDefault, err := svc.ParseDays(ctx, p.ID, "invalid", now)
	if err != nil || len(daysDefault) != 31 {
		t.Fatalf("expected 31 days for default, got len=%d, err=%v", len(daysDefault), err)
	}

	// Numeric
	days7, err := svc.ParseDays(ctx, p.ID, "7", now)
	if err != nil || len(days7) != 8 {
		t.Fatalf("expected 8 days for 7, got len=%d, err=%v", len(days7), err)
	}

	// YTD
	daysYTD, err := svc.ParseDays(ctx, p.ID, "ytd", now)
	if err != nil || finance.DateKey(daysYTD[0]) != "2024-01-01" || finance.DateKey(daysYTD[len(daysYTD)-1]) != "2024-06-15" {
		t.Fatalf("unexpected YTD range: len=%d, first=%v, err=%v", len(daysYTD), daysYTD[0], err)
	}

	// Max with no transactions -> falls back to 30 days
	daysMaxEmpty, err := svc.ParseDays(ctx, p.ID, "max", now)
	if err != nil || len(daysMaxEmpty) != 31 {
		t.Fatalf("expected 31 days for empty max, got len=%d, err=%v", len(daysMaxEmpty), err)
	}

	// Max with transaction -> starts 1 day before earliest transaction
	if _, err := store.CreateTransaction(ctx, db.Transaction{
		PortfolioID:     p.ID,
		Symbol:          "AAPL",
		Type:            "BUY",
		Quantity:        1,
		PricePerShare:   100,
		Currency:        "USD",
		TransactionDate: time.Date(2024, 6, 10, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("CreateTransaction: %v", err)
	}
	daysMax, err := svc.ParseDays(ctx, p.ID, "max", now)
	if err != nil || finance.DateKey(daysMax[0]) != "2024-06-09" || len(daysMax) != 7 {
		t.Fatalf("unexpected max range: len=%d, first=%v, err=%v", len(daysMax), daysMax[0], err)
	}
}

func TestGetPortfolioDataEndToEndAndJSON(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	user, err := store.FindOrCreateUserByEmail(ctx, "test2@example.com", "Test")
	if err != nil {
		t.Fatalf("FindOrCreateUserByEmail: %v", err)
	}
	p, err := store.CreatePortfolio(ctx, user.ID, "Growth")
	if err != nil {
		t.Fatalf("CreatePortfolio: %v", err)
	}

	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ts := time.Date(2024, 6, 15, 14, 0, 0, 0, time.UTC).Unix()
		switch r.URL.Path {
		case "/v8/finance/chart/AAPL":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"chart": map[string]any{
					"result": []any{map[string]any{
						"meta":       map[string]any{"symbol": "AAPL", "shortName": "Apple", "currency": "USD", "regularMarketPrice": 150.0},
						"timestamp":  []int64{ts},
						"indicators": map[string]any{"quote": []any{map[string]any{"close": []any{150.0}}}},
					}},
				},
			})
		case "/v8/finance/chart/CLOSED":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"chart": map[string]any{
					"result": []any{map[string]any{
						"meta":       map[string]any{"symbol": "CLOSED", "shortName": "Closed Pos", "currency": "USD", "regularMarketPrice": 50.0},
						"timestamp":  []int64{ts},
						"indicators": map[string]any{"quote": []any{map[string]any{"close": []any{50.0}}}},
					}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer yahooSrv.Close()

	frankSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"date": "2024-06-15", "rate": 0.90},
		})
	}))
	defer frankSrv.Close()

	fin := finance.NewService(store, finance.NewYahooClient(yahooSrv.URL), finance.NewFrankfurterClient(frankSrv.URL))
	svc := NewService(store, fin)

	// Empty portfolio serializes empty slices as [] (not null).
	emptyData, err := svc.GetPortfolioData(ctx, user.ID, p.ID, "USD", nil)
	if err != nil {
		t.Fatalf("GetPortfolioData empty: %v", err)
	}
	rawEmpty, err := json.Marshal(emptyData)
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if strings.Contains(string(rawEmpty), ":null") {
		t.Fatalf("expected non-null empty arrays in JSON, got %s", string(rawEmpty))
	}

	// Add AAPL (EUR buy converted to USD) and CLOSED (buy 5, sell 5 -> quantity 0, avgBuyPrice = 0).
	d1 := time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	if _, err := store.CreateTransaction(ctx, db.Transaction{
		PortfolioID: p.ID, Symbol: "AAPL", Type: "BUY", Quantity: 10, PricePerShare: 90, Currency: "EUR", TransactionDate: d1,
	}); err != nil {
		t.Fatalf("CreateTransaction 1: %v", err)
	}
	if _, err := store.CreateTransaction(ctx, db.Transaction{
		PortfolioID: p.ID, Symbol: "CLOSED", Type: "BUY", Quantity: 5, PricePerShare: 40, Currency: "USD", TransactionDate: d1,
	}); err != nil {
		t.Fatalf("CreateTransaction 2: %v", err)
	}
	if _, err := store.CreateTransaction(ctx, db.Transaction{
		PortfolioID: p.ID, Symbol: "CLOSED", Type: "SELL", Quantity: 5, PricePerShare: 50, Currency: "USD", TransactionDate: d2,
	}); err != nil {
		t.Fatalf("CreateTransaction 3: %v", err)
	}

	data, err := svc.GetPortfolioData(ctx, user.ID, p.ID, "USD", []time.Time{d2})
	if err != nil {
		t.Fatalf("GetPortfolioData: %v", err)
	}
	if len(data.Summary.Assets) != 2 {
		t.Fatalf("expected 2 assets, got %d", len(data.Summary.Assets))
	}
	// Transactions must be reversed (newest first).
	if data.Transactions[0].TransactionDate.Before(data.Transactions[1].TransactionDate) {
		t.Fatalf("expected transactions reversed newest-first")
	}

	// AAPL cost: 10 * (90 * 0.90) = 810, value: 10 * 150 = 1500
	aapl := data.Summary.Assets[0]
	if aapl.Symbol != "AAPL" || !approxEqual(aapl.Cost, 810, 1e-6) || !approxEqual(aapl.Value, 1500, 1e-6) {
		t.Fatalf("unexpected AAPL asset data: %+v", aapl)
	}

	// CLOSED quantity = 0 -> avgBuyPrice must be 0 (not NaN/Inf)
	closed := data.Summary.Assets[1]
	if closed.Symbol != "CLOSED" || closed.Quantity != 0 || closed.AvgBuyPrice != 0 {
		t.Fatalf("unexpected CLOSED asset data: %+v", closed)
	}

	// Verify JSON marshaling succeeds cleanly with no NaN/Inf/null.
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	if strings.Contains(string(raw), "null") {
		t.Fatalf("unexpected null in JSON: %s", string(raw))
	}
}
