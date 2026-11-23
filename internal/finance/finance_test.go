package finance

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabay/hold/internal/db"
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

func TestCurrencies(t *testing.T) {
	if len(Currencies) != 30 {
		t.Fatalf("expected 30 supported currencies, got %d", len(Currencies))
	}
	if c, ok := Currencies["USD"]; !ok || c.Symbol != "$" || c.Name != "United States Dollar" {
		t.Fatalf("unexpected USD currency entry: %+v", c)
	}
	if c, ok := Currencies["EUR"]; !ok || c.Symbol != "€" || c.Name != "Euro" {
		t.Fatalf("unexpected EUR currency entry: %+v", c)
	}
	if !IsSupportedCurrency("USD") || !IsSupportedCurrency("usd") {
		t.Fatal("expected USD to be supported")
	}
	if IsSupportedCurrency("FOO") {
		t.Fatal("expected FOO not to be supported")
	}
}

func TestDateHelpers(t *testing.T) {
	loc := time.FixedZone("EST", -5*3600)
	input := time.Date(2024, 6, 15, 22, 30, 45, 123, loc)
	// 22:30 EST is 03:30 UTC next day (2024-06-16)
	norm := NormalizeDate(input)
	if norm.Location() != time.UTC || DateKey(norm) != "2024-06-16" {
		t.Fatalf("unexpected normalized date: %v", norm)
	}
	if norm.Hour() != 0 || norm.Minute() != 0 || norm.Second() != 0 || norm.Nanosecond() != 0 {
		t.Fatalf("expected UTC midnight, got %v", norm)
	}

	parsed, err := ParseDateKey("2024-06-15")
	if err != nil {
		t.Fatalf("ParseDateKey error: %v", err)
	}
	if DateKey(parsed) != "2024-06-15" || parsed.Location() != time.UTC {
		t.Fatalf("unexpected parsed date: %v", parsed)
	}

	next := AddDays(parsed, 16)
	if DateKey(next) != "2024-07-01" {
		t.Fatalf("expected 2024-07-01, got %s", DateKey(next))
	}

	days := ExpandDays(parsed, AddDays(parsed, 2))
	if len(days) != 3 {
		t.Fatalf("expected 3 days, got %d", len(days))
	}
	if DateKey(days[0]) != "2024-06-15" || DateKey(days[2]) != "2024-06-17" {
		t.Fatalf("unexpected expanded days: %v", days)
	}
}

func TestGetValueAroundDate(t *testing.T) {
	base := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)

	t.Run("exact match", func(t *testing.T) {
		values := map[string]float64{DateKey(base): 150}
		v, ok := GetValueAroundDate(values, base)
		if !ok || v != 150 {
			t.Fatalf("got (%v, %v), want (150, true)", v, ok)
		}
	})

	t.Run("look back up to 4 days", func(t *testing.T) {
		values := map[string]float64{DateKey(AddDays(base, -4)): 148}
		v, ok := GetValueAroundDate(values, base)
		if !ok || v != 148 {
			t.Fatalf("got (%v, %v), want (148, true)", v, ok)
		}
	})

	t.Run("look forward up to 2 days", func(t *testing.T) {
		values := map[string]float64{DateKey(AddDays(base, 2)): 151}
		v, ok := GetValueAroundDate(values, base)
		if !ok || v != 151 {
			t.Fatalf("got (%v, %v), want (151, true)", v, ok)
		}
	})

	t.Run("nil map", func(t *testing.T) {
		if _, ok := GetValueAroundDate(nil, base); ok {
			t.Fatal("expected false for nil map")
		}
	})

	t.Run("empty map", func(t *testing.T) {
		if _, ok := GetValueAroundDate(map[string]float64{}, base); ok {
			t.Fatal("expected false for empty map")
		}
	})

	t.Run("out of range", func(t *testing.T) {
		values := map[string]float64{
			DateKey(AddDays(base, -5)): 148,
			DateKey(AddDays(base, 3)):  152,
		}
		if _, ok := GetValueAroundDate(values, base); ok {
			t.Fatal("expected false when out of [-4, +2] range")
		}
	})

	t.Run("prioritize exact date over nearby", func(t *testing.T) {
		values := map[string]float64{
			DateKey(base):              150,
			DateKey(AddDays(base, -1)): 149,
			DateKey(AddDays(base, 1)):  151,
		}
		v, ok := GetValueAroundDate(values, base)
		if !ok || v != 150 {
			t.Fatalf("got (%v, %v), want (150, true)", v, ok)
		}
	})

	t.Run("respect search order: back 4 days before forward 2 days", func(t *testing.T) {
		values := map[string]float64{
			DateKey(AddDays(base, -4)): 148,
			DateKey(AddDays(base, 1)):  152,
		}
		v, ok := GetValueAroundDate(values, base)
		if !ok || v != 148 {
			t.Fatalf("got (%v, %v), want (148, true)", v, ok)
		}
	})
}

func TestAdjustPreSplitPrices(t *testing.T) {
	prices := map[string]float64{
		"2020-01-01": 100,
		"2020-08-30": 120,
		"2020-08-31": 30, // split date itself: NOT adjusted
		"2022-06-01": 25,
	}

	t.Run("no splits", func(t *testing.T) {
		adj := AdjustPreSplitPrices(prices, nil)
		if adj["2020-01-01"] != 100 || adj["2020-08-31"] != 30 {
			t.Fatalf("unexpected prices with no splits: %+v", adj)
		}
	})

	t.Run("single split", func(t *testing.T) {
		splits := map[string]float64{"2020-08-31": 4}
		adj := AdjustPreSplitPrices(prices, splits)
		if adj["2020-01-01"] != 400 || adj["2020-08-30"] != 480 || adj["2020-08-31"] != 30 {
			t.Fatalf("unexpected single-split adjusted prices: %+v", adj)
		}
	})

	t.Run("multiple splits compound", func(t *testing.T) {
		splits := map[string]float64{
			"2020-08-31": 4,
			"2022-06-01": 2,
		}
		adj := AdjustPreSplitPrices(prices, splits)
		if adj["2020-01-01"] != 800 {
			t.Fatalf("expected 100*4*2=800, got %v", adj["2020-01-01"])
		}
		if adj["2020-08-31"] != 60 {
			t.Fatalf("expected 30*2=60, got %v", adj["2020-08-31"])
		}
		if adj["2022-06-01"] != 25 {
			t.Fatalf("expected 25 on second split date, got %v", adj["2022-06-01"])
		}
	})
}

func TestExchangeRatesAndCanonicalCaching(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	var calls atomic.Int32
	var lastQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		lastQuery = r.URL.RawQuery
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"date": "2024-06-15", "rate": 0.92},
		})
	}))
	defer srv.Close()

	svc := NewService(store, NewYahooClient("http://127.0.0.1:0"), NewFrankfurterClient(srv.URL))
	date := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)

	// Same currency returns nil, nil without HTTP call.
	same, err := svc.GetExchangeRates(ctx, "USD", "USD", date)
	if err != nil || same != nil {
		t.Fatalf("expected (nil, nil) for same currency, got (%v, %v)", same, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("expected 0 HTTP calls for same currency, got %d", calls.Load())
	}

	// Request USD -> EUR: canonical pair is EUR -> USD, so Frankfurter is queried with base=EUR&quotes=USD.
	usdToEur, err := svc.GetExchangeRates(ctx, "USD", "EUR", date)
	if err != nil {
		t.Fatalf("GetExchangeRates error: %v", err)
	}
	if lastQuery != "from=2024-06-15&base=EUR&quotes=USD" {
		t.Fatalf("unexpected canonical query: %s", lastQuery)
	}
	if usdToEur.BaseCurrency != "USD" || usdToEur.TargetCurrency != "EUR" {
		t.Fatalf("unexpected pair: %s -> %s", usdToEur.BaseCurrency, usdToEur.TargetCurrency)
	}
	if !approxEqual(usdToEur.Rates["2024-06-15"], 1.0/0.92, 1e-6) {
		t.Fatalf("expected inverted rate 1/0.92, got %v", usdToEur.Rates["2024-06-15"])
	}

	// Reverse direction EUR -> USD hits in-memory cache without another HTTP call.
	eurToUsd, err := svc.GetExchangeRates(ctx, "EUR", "USD", date)
	if err != nil {
		t.Fatalf("GetExchangeRates reverse error: %v", err)
	}
	if !approxEqual(eurToUsd.Rates["2024-06-15"], 0.92, 1e-6) {
		t.Fatalf("expected 0.92, got %v", eurToUsd.Rates["2024-06-15"])
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 HTTP call total, got %d", calls.Load())
	}

	// ConvertCurrency uses the rate.
	converted, err := svc.ConvertCurrency(ctx, 100, "EUR", "USD", date)
	if err != nil {
		t.Fatalf("ConvertCurrency error: %v", err)
	}
	if !approxEqual(converted, 92, 1e-6) {
		t.Fatalf("expected 92, got %v", converted)
	}

	// Verify DB stored canonical direction EUR -> USD.
	rows, err := store.GetExchangeRates(ctx, "EUR", "USD", "2024-06-15")
	if err != nil || len(rows) != 1 || !approxEqual(rows[0].Rate, 0.92, 1e-6) {
		t.Fatalf("unexpected DB rows: %+v, err=%v", rows, err)
	}

	// ClearCache clears both DB and memory; next call triggers HTTP again.
	if err := svc.ClearCache(ctx); err != nil {
		t.Fatalf("ClearCache error: %v", err)
	}
	rowsAfter, err := store.GetExchangeRates(ctx, "EUR", "USD", "2024-06-15")
	if err != nil || len(rowsAfter) != 0 {
		t.Fatalf("expected empty DB after ClearCache, got %+v, err=%v", rowsAfter, err)
	}
	if _, err := svc.GetExchangeRates(ctx, "EUR", "USD", date); err != nil {
		t.Fatalf("GetExchangeRates after ClearCache error: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 HTTP calls after ClearCache, got %d", calls.Load())
	}
}

func TestIncrementalDBTopUpAndFetchBufferDays(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	// Pre-populate SQLite with prices up to 2024-06-10.
	if err := store.UpsertStockPrices(ctx, "AAPL", []db.StockPriceRow{
		{Symbol: "AAPL", Date: "2024-06-01", Price: 190},
		{Symbol: "AAPL", Date: "2024-06-10", Price: 195},
	}); err != nil {
		t.Fatalf("seed stock prices: %v", err)
	}

	var gotPeriod1 string
	var gotUA string
	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPeriod1 = r.URL.Query().Get("period1")
		gotUA = r.Header.Get("User-Agent")
		ts1 := time.Date(2024, 6, 10, 14, 30, 0, 0, time.UTC).Unix()
		ts2 := time.Date(2024, 6, 11, 14, 30, 0, 0, time.UTC).Unix()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"chart": map[string]any{
				"result": []any{
					map[string]any{
						"meta": map[string]any{
							"symbol":             "AAPL",
							"shortName":          "Apple Inc.",
							"currency":           "usd",
							"regularMarketPrice": 200.0,
						},
						"timestamp": []int64{ts1, ts2},
						"indicators": map[string]any{
							"quote": []any{
								map[string]any{
									"close": []any{196.0, 200.0},
								},
							},
						},
					},
				},
			},
		})
	}))
	defer yahooSrv.Close()

	svc := NewService(store, NewYahooClient(yahooSrv.URL), NewFrankfurterClient("http://127.0.0.1:0"))
	fromDate := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	info, err := svc.GetAssetInfo(ctx, "aapl", fromDate, "")
	if err != nil {
		t.Fatalf("GetAssetInfo error: %v", err)
	}

	if gotUA == "" {
		t.Fatal("expected User-Agent header to be set")
	}
	// Latest stored is 2024-06-10, so bufferedFetchStart = 2024-06-08 (2 days before).
	expectedPeriod1 := time.Date(2024, 6, 8, 0, 0, 0, 0, time.UTC).Unix()
	if gotPeriod1 != "1717804800" || expectedPeriod1 != 1717804800 {
		t.Fatalf("expected period1=%d (2024-06-08), got %s", expectedPeriod1, gotPeriod1)
	}
	if info.Currency != "USD" {
		t.Fatalf("expected uppercased currency USD, got %s", info.Currency)
	}
	// DB price 2024-06-01 (190) preserved, fresh price 2024-06-10 (196) overwrote DB (195), and 2024-06-11 (200) added.
	if info.Prices["2024-06-01"] != 190 || info.Prices["2024-06-10"] != 196 || info.Prices["2024-06-11"] != 200 {
		t.Fatalf("unexpected merged prices: %+v", info.Prices)
	}
}

func TestYahooChartNullClosesAndSearch(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v8/finance/chart/MSFT":
			ts1 := time.Date(2024, 6, 1, 14, 0, 0, 0, time.UTC).Unix()
			ts2 := time.Date(2024, 6, 2, 14, 0, 0, 0, time.UTC).Unix()
			splitTS := time.Date(2024, 6, 2, 0, 0, 0, 0, time.UTC).Unix()
			divTS := time.Date(2024, 6, 2, 0, 0, 0, 0, time.UTC).Unix()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"chart": map[string]any{
					"result": []any{
						map[string]any{
							"meta": map[string]any{
								"symbol":             "MSFT",
								"longName":           "Microsoft Corporation",
								"currency":           "USD",
								"regularMarketPrice": 420.0,
							},
							"timestamp": []int64{ts1, ts2},
							"indicators": map[string]any{
								"quote": []any{
									map[string]any{
										"close": []any{nil, 420.0},
									},
								},
							},
							"events": map[string]any{
								"dividends": map[string]any{
									"1": map[string]any{"amount": 0.75, "date": divTS},
								},
								"splits": map[string]any{
									"1": map[string]any{"date": splitTS, "numerator": 2, "denominator": 1},
								},
							},
						},
					},
				},
			})
		case "/v1/finance/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"quotes": []any{
					map[string]any{"symbol": "AAPL", "shortname": "Apple Inc.", "quoteType": "EQUITY"},
					map[string]any{"symbol": "SPY", "longname": "SPDR S&P 500", "quoteType": "ETF"},
					map[string]any{"symbol": "VFIAX", "shortname": "Vanguard 500", "quoteType": "MUTUALFUND"},
					map[string]any{"symbol": "BTC-USD", "shortname": "Bitcoin", "quoteType": "CRYPTOCURRENCY"},
					map[string]any{"symbol": "", "shortname": "Empty", "quoteType": "EQUITY"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer yahooSrv.Close()

	svc := NewService(store, NewYahooClient(yahooSrv.URL), NewFrankfurterClient("http://127.0.0.1:0"))

	info, err := svc.GetAssetInfo(ctx, "MSFT", time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC), "")
	if err != nil {
		t.Fatalf("GetAssetInfo error: %v", err)
	}
	if info.Name != "Microsoft Corporation" {
		t.Fatalf("expected longName fallback, got %q", info.Name)
	}
	if _, hasNullDay := info.Prices["2024-06-01"]; hasNullDay {
		t.Fatal("expected null close price to be skipped")
	}
	if info.Prices["2024-06-02"] != 420.0 || info.Dividends["2024-06-02"] != 0.75 || info.Splits["2024-06-02"] != 2.0 {
		t.Fatalf("unexpected MSFT parsed data: %+v", info)
	}

	// Short query returns empty slice without calling server.
	shortRes, err := svc.SearchAssets(ctx, " a ")
	if err != nil || len(shortRes) != 0 {
		t.Fatalf("expected empty slice for short query, got (%+v, %v)", shortRes, err)
	}

	res, err := svc.SearchAssets(ctx, "app")
	if err != nil {
		t.Fatalf("SearchAssets error: %v", err)
	}
	if len(res) != 3 {
		t.Fatalf("expected 3 filtered search results, got %+v", res)
	}
}

func TestBackfillWhenOnlyRecentDatesCached(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)

	// Simulate only recent prices cached (e.g. from validating a symbol on today's date).
	if err := store.UpsertStockPrices(ctx, "AAPL", []db.StockPriceRow{
		{Symbol: "AAPL", Date: "2026-04-17", Price: 210},
	}); err != nil {
		t.Fatalf("seed recent stock price: %v", err)
	}
	if err := store.UpsertExchangeRates(ctx, "EUR", "USD", []db.ExchangeRateRow{
		{BaseCurrency: "EUR", TargetCurrency: "USD", Date: "2026-04-17", Rate: 1.08},
	}); err != nil {
		t.Fatalf("seed recent exchange rate: %v", err)
	}

	var gotYahooPeriod1 string
	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotYahooPeriod1 = r.URL.Query().Get("period1")
		tsOld := time.Date(2025, 4, 21, 14, 30, 0, 0, time.UTC).Unix()
		tsNew := time.Date(2026, 4, 17, 14, 30, 0, 0, time.UTC).Unix()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"chart": map[string]any{
				"result": []any{
					map[string]any{
						"meta": map[string]any{
							"symbol":             "AAPL",
							"shortName":          "Apple Inc.",
							"currency":           "USD",
							"regularMarketPrice": 210.0,
						},
						"timestamp": []int64{tsOld, tsNew},
						"indicators": map[string]any{
							"quote": []any{
								map[string]any{"close": []any{175.0, 210.0}},
							},
						},
					},
				},
			},
		})
	}))
	defer yahooSrv.Close()

	var gotFXFrom string
	fxSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotFXFrom = r.URL.Query().Get("from")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"date": "2025-04-21", "rate": 1.05},
			{"date": "2026-04-17", "rate": 1.08},
		})
	}))
	defer fxSrv.Close()

	svc := NewService(store, NewYahooClient(yahooSrv.URL), NewFrankfurterClient(fxSrv.URL))
	oneYearAgo := time.Date(2025, 4, 20, 0, 0, 0, 0, time.UTC)

	info, err := svc.GetAssetInfo(ctx, "AAPL", oneYearAgo, "")
	if err != nil {
		t.Fatalf("GetAssetInfo error: %v", err)
	}
	// Must fetch from oneYearAgo (not 2026-04-15) because cache had a leading gap.
	if gotYahooPeriod1 != "1745107200" {
		t.Fatalf("expected Yahoo period1=%d (2025-04-20), got %s", oneYearAgo.Unix(), gotYahooPeriod1)
	}
	if info.Prices["2025-04-21"] != 175.0 || info.Prices["2026-04-17"] != 210.0 {
		t.Fatalf("expected backfilled historical prices, got %+v", info.Prices)
	}

	rates, err := svc.GetExchangeRates(ctx, "EUR", "USD", oneYearAgo)
	if err != nil {
		t.Fatalf("GetExchangeRates error: %v", err)
	}
	if gotFXFrom != "2025-04-20" {
		t.Fatalf("expected Frankfurter from=2025-04-20, got %s", gotFXFrom)
	}
	if rates.Rates["2025-04-21"] != 1.05 || rates.Rates["2026-04-17"] != 1.08 {
		t.Fatalf("expected backfilled historical rates, got %+v", rates.Rates)
	}
}
