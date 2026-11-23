package server

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabay/hold/internal/auth"
	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
	"github.com/gabay/hold/internal/portfolio"
)

type testEnv struct {
	handler http.Handler
	store   *db.Store
	authSvc *auth.Service
	finSvc  *finance.Service
}

func setupTestEnv(t *testing.T, withStatic bool) *testEnv {
	t.Helper()

	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v8/finance/chart/INVALID"):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found"}}}`))
		case strings.HasPrefix(r.URL.Path, "/v8/finance/chart/"):
			sym := strings.TrimPrefix(r.URL.Path, "/v8/finance/chart/")
			now := time.Now().UTC().Unix()
			day1 := time.Now().UTC().Add(-24 * time.Hour).Unix()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"chart": map[string]any{
					"result": []any{
						map[string]any{
							"meta": map[string]any{
								"symbol":             sym,
								"shortName":          sym + " Inc.",
								"currency":           "USD",
								"regularMarketPrice": 150.0,
							},
							"timestamp": []int64{day1, now},
							"indicators": map[string]any{
								"quote": []any{
									map[string]any{
										"close": []float64{145.0, 150.0},
									},
								},
							},
						},
					},
				},
			})
		case r.URL.Path == "/v1/finance/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"quotes": []any{
					map[string]any{
						"symbol":    "AAPL",
						"shortname": "Apple Inc.",
						"quoteType": "EQUITY",
						"exchDisp":  "NASDAQ",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(yahooSrv.Close)

	frankSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		today := time.Now().UTC().Format("2006-01-02")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"amount":     1.0,
			"base":       "EUR",
			"start_date": today,
			"rates": map[string]any{
				today: map[string]float64{"USD": 1.1},
			},
		})
	}))
	t.Cleanup(frankSrv.Close)

	cfg := config.Config{
		Port:           "3000",
		AuthSecret:     "test-secret-for-server",
		AuthURL:        "http://localhost:3000",
		AllowDemoLogin: true,
	}

	finSvc := finance.NewService(store, finance.NewYahooClient(yahooSrv.URL), finance.NewFrankfurterClient(frankSrv.URL))
	portSvc := portfolio.NewService(store, finSvc)
	authSvc, err := auth.NewService(cfg, store)
	if err != nil {
		t.Fatalf("auth.NewService: %v", err)
	}

	var staticFS fstest.MapFS
	if withStatic {
		staticFS = fstest.MapFS{
			"index.html":    &fstest.MapFile{Data: []byte("<html><body>Hold SPA</body></html>")},
			"assets/app.js": &fstest.MapFile{Data: []byte("console.log('hold');")},
		}
		handler := New(cfg, store, authSvc, finSvc, portSvc, staticFS)
		return &testEnv{handler: handler, store: store, authSvc: authSvc, finSvc: finSvc}
	}

	handler := New(cfg, store, authSvc, finSvc, portSvc, nil)
	return &testEnv{handler: handler, store: store, authSvc: authSvc, finSvc: finSvc}
}

func (e *testEnv) loginUser(t *testing.T, email, name string) (string, *http.Cookie) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "name": name})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/demo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loginUser(%s) status=%d body=%s", email, rec.Code, rec.Body.String())
	}
	var resp struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	return resp.User.ID, rec.Result().Cookies()[0]
}

func (e *testEnv) doJSON(t *testing.T, method, path string, cookie *http.Cookie, payload any) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		bodyReader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func TestHealthAndCurrenciesAndAuthGuard(t *testing.T) {
	env := setupTestEnv(t, false)

	rec := env.doJSON(t, http.MethodGet, "/api/health", nil, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("health unexpected: %d %s", rec.Code, rec.Body.String())
	}

	rec = env.doJSON(t, http.MethodGet, "/api/currencies", nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("currencies status = %d", rec.Code)
	}
	var currs map[string]finance.Currency
	if err := json.NewDecoder(rec.Body).Decode(&currs); err != nil {
		t.Fatalf("decode currencies: %v", err)
	}
	if len(currs) != 30 || currs["USD"].Symbol != "$" {
		t.Fatalf("unexpected currencies map len=%d", len(currs))
	}

	for _, ep := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/portfolio"},
		{http.MethodPost, "/api/portfolio"},
		{http.MethodGet, "/api/finance/search?q=AAPL"},
		{http.MethodDelete, "/api/cache"},
	} {
		rec = env.doJSON(t, ep.method, ep.path, nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s expected 401, got %d", ep.method, ep.path, rec.Code)
		}
	}
}

func TestPortfolioCRUDAndCrossUserIsolation(t *testing.T) {
	env := setupTestEnv(t, false)
	_, cookieA := env.loginUser(t, "alice@example.com", "Alice")
	_, cookieB := env.loginUser(t, "bob@example.com", "Bob")

	// User A gets default portfolio
	rec := env.doJSON(t, http.MethodGet, "/api/portfolio", cookieA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list portfolios: %d %s", rec.Code, rec.Body.String())
	}
	var portfolios []db.Portfolio
	_ = json.NewDecoder(rec.Body).Decode(&portfolios)
	if len(portfolios) != 1 || portfolios[0].Name != "Portfolio" {
		t.Fatalf("unexpected default portfolios: %+v", portfolios)
	}

	// User A creates a second portfolio
	rec = env.doJSON(t, http.MethodPost, "/api/portfolio", cookieA, map[string]string{"name": "Retirement"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create portfolio: %d %s", rec.Code, rec.Body.String())
	}
	var created db.Portfolio
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.Name != "Retirement" {
		t.Fatalf("unexpected created portfolio: %+v", created)
	}

	// Empty name rejected
	rec = env.doJSON(t, http.MethodPost, "/api/portfolio", cookieA, map[string]string{"name": "   "})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank name, got %d", rec.Code)
	}

	// User A adds a transaction to Retirement
	rec = env.doJSON(t, http.MethodPost, "/api/portfolio/"+created.ID+"/transactions", cookieA, map[string]any{
		"symbol":          "AAPL",
		"type":            "BUY",
		"quantity":        10,
		"pricePerShare":   140,
		"transactionDate": "2025-01-15",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create tx: %d %s", rec.Code, rec.Body.String())
	}
	var tx db.Transaction
	_ = json.NewDecoder(rec.Body).Decode(&tx)

	// User B must get 404 on every endpoint targeting User A's portfolio
	isolationChecks := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPatch, "/api/portfolio/" + created.ID, map[string]string{"name": "Hacked"}},
		{http.MethodDelete, "/api/portfolio/" + created.ID, nil},
		{http.MethodGet, "/api/portfolio/" + created.ID + "/data", nil},
		{http.MethodGet, "/api/portfolio/" + created.ID + "/transactions", nil},
		{http.MethodPost, "/api/portfolio/" + created.ID + "/transactions", map[string]any{"symbol": "AAPL", "type": "BUY", "quantity": 1, "pricePerShare": 100}},
		{http.MethodDelete, "/api/portfolio/" + created.ID + "/transactions", nil},
		{http.MethodPut, "/api/portfolio/" + created.ID + "/transactions/" + tx.ID, map[string]any{"symbol": "AAPL", "type": "BUY", "quantity": 1, "pricePerShare": 100}},
		{http.MethodDelete, "/api/portfolio/" + created.ID + "/transactions/" + tx.ID, nil},
		{http.MethodGet, "/api/portfolio/" + created.ID + "/export", nil},
	}
	for _, chk := range isolationChecks {
		r := env.doJSON(t, chk.method, chk.path, cookieB, chk.body)
		if r.Code != http.StatusNotFound {
			t.Fatalf("isolation check %s %s expected 404, got %d (%s)", chk.method, chk.path, r.Code, r.Body.String())
		}
	}

	// User B CSV import isolation
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "tx.csv")
	_, _ = fw.Write([]byte("symbol,type,quantity,price\nAAPL,BUY,1,100\n"))
	_ = mw.Close()
	impReq := httptest.NewRequest(http.MethodPost, "/api/portfolio/"+created.ID+"/import", &buf)
	impReq.Header.Set("Content-Type", mw.FormDataContentType())
	impReq.AddCookie(cookieB)
	impRec := httptest.NewRecorder()
	env.handler.ServeHTTP(impRec, impReq)
	if impRec.Code != http.StatusNotFound {
		t.Fatalf("isolation CSV import expected 404, got %d", impRec.Code)
	}

	// User A renames & fetches portfolio data
	rec = env.doJSON(t, http.MethodPatch, "/api/portfolio/"+created.ID, cookieA, map[string]string{"name": "Long Term"})
	if rec.Code != http.StatusOK {
		t.Fatalf("rename failed: %d %s", rec.Code, rec.Body.String())
	}

	rec = env.doJSON(t, http.MethodGet, "/api/portfolio/"+created.ID+"/data?currency=USD&days=7", cookieA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("portfolio data failed: %d %s", rec.Code, rec.Body.String())
	}
	var pdata portfolio.PortfolioData
	if err := json.NewDecoder(rec.Body).Decode(&pdata); err != nil {
		t.Fatalf("decode portfolio data: %v", err)
	}
	if pdata.Name != "Long Term" || len(pdata.Summary.Assets) != 1 || pdata.Summary.Assets[0].Symbol != "AAPL" {
		t.Fatalf("unexpected portfolio data: %+v", pdata)
	}

	// User A deletes portfolio
	rec = env.doJSON(t, http.MethodDelete, "/api/portfolio/"+created.ID, cookieA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete portfolio failed: %d", rec.Code)
	}
}

func TestTransactionHandlersAndValidation(t *testing.T) {
	env := setupTestEnv(t, false)
	_, cookie := env.loginUser(t, "txuser@example.com", "TxUser")

	rec := env.doJSON(t, http.MethodGet, "/api/portfolio", cookie, nil)
	var ports []db.Portfolio
	_ = json.NewDecoder(rec.Body).Decode(&ports)
	pid := ports[0].ID

	// Empty list returns [] not null
	rec = env.doJSON(t, http.MethodGet, "/api/portfolio/"+pid+"/transactions", cookie, nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("expected [], got %d %q", rec.Code, rec.Body.String())
	}

	// Invalid symbol rejected
	rec = env.doJSON(t, http.MethodPost, "/api/portfolio/"+pid+"/transactions", cookie, map[string]any{
		"symbol":        "INVALID",
		"type":          "BUY",
		"quantity":      1,
		"pricePerShare": 10,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid symbol, got %d", rec.Code)
	}

	// Create valid transaction (currency defaults to USD from assetInfo)
	rec = env.doJSON(t, http.MethodPost, "/api/portfolio/"+pid+"/transactions", cookie, map[string]any{
		"symbol":          "aapl",
		"type":            "BUY",
		"quantity":        5,
		"pricePerShare":   100,
		"transactionDate": "2025-02-01",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create tx: %d %s", rec.Code, rec.Body.String())
	}
	var created db.Transaction
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.Symbol != "AAPL" || created.Currency != "USD" {
		t.Fatalf("unexpected created tx: %+v", created)
	}

	// Update transaction
	rec = env.doJSON(t, http.MethodPut, "/api/portfolio/"+pid+"/transactions/"+created.ID, cookie, map[string]any{
		"symbol":          "AAPL",
		"type":            "SELL",
		"quantity":        2,
		"pricePerShare":   120,
		"currency":        "USD",
		"transactionDate": "2025-02-02",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("update tx: %d %s", rec.Code, rec.Body.String())
	}
	var updated db.Transaction
	_ = json.NewDecoder(rec.Body).Decode(&updated)
	if updated.Type != "SELL" || updated.Quantity != 2 {
		t.Fatalf("unexpected updated tx: %+v", updated)
	}

	// Insert transaction with empty currency directly in DB and verify GET resolves it
	_, err := env.store.CreateTransaction(t.Context(), db.Transaction{
		PortfolioID:     pid,
		Symbol:          "MSFT",
		Type:            "BUY",
		Quantity:        3,
		PricePerShare:   300,
		Currency:        "",
		TransactionDate: time.Date(2025, 2, 3, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("direct CreateTransaction: %v", err)
	}
	rec = env.doJSON(t, http.MethodGet, "/api/portfolio/"+pid+"/transactions", cookie, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list tx: %d", rec.Code)
	}
	var list []db.Transaction
	_ = json.NewDecoder(rec.Body).Decode(&list)
	if len(list) != 2 || list[0].Symbol != "MSFT" || list[0].Currency != "USD" {
		t.Fatalf("expected MSFT with resolved USD currency first, got %+v", list)
	}

	// Delete single transaction
	rec = env.doJSON(t, http.MethodDelete, "/api/portfolio/"+pid+"/transactions/"+created.ID, cookie, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete single tx: %d", rec.Code)
	}

	// Delete all transactions
	rec = env.doJSON(t, http.MethodDelete, "/api/portfolio/"+pid+"/transactions", cookie, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete all tx: %d", rec.Code)
	}
	rec = env.doJSON(t, http.MethodGet, "/api/portfolio/"+pid+"/transactions", cookie, nil)
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("expected [] after clear, got %s", rec.Body.String())
	}
}

func TestCSVImportExportRoundTrip(t *testing.T) {
	env := setupTestEnv(t, false)
	_, cookie := env.loginUser(t, "csv@example.com", "CSV")

	rec := env.doJSON(t, http.MethodGet, "/api/portfolio", cookie, nil)
	var ports []db.Portfolio
	_ = json.NewDecoder(rec.Body).Decode(&ports)
	pid := ports[0].ID

	uploadCSV := func(content string) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("file", "import.csv")
		_, _ = fw.Write([]byte(content))
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/portfolio/"+pid+"/import", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.AddCookie(cookie)
		r := httptest.NewRecorder()
		env.handler.ServeHTTP(r, req)
		return r
	}

	// Validation errors
	if r := uploadCSV("symbol,type\nAAPL,BUY\n"); r.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing columns, got %d", r.Code)
	}
	if r := uploadCSV("symbol,type,quantity,price,currency\nAAPL,BUY,1,100,XYZ\n"); r.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unsupported currency, got %d", r.Code)
	}
	if r := uploadCSV("symbol,type,quantity,price\nAAPL,HOLD,1,100\n"); r.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid type, got %d", r.Code)
	}

	// Valid import with BOM + aliases (price, date)
	csvInput := "\ufeffSymbol,Type,Quantity,Price,Currency,Date\n" +
		"msft,buy,2,300,USD,2025-02-01\n" +
		"aapl,sell,1,150,EUR,2025-01-10\n"
	r := uploadCSV(csvInput)
	if r.Code != http.StatusOK {
		t.Fatalf("import failed: %d %s", r.Code, r.Body.String())
	}
	var impResp struct {
		Success bool `json:"success"`
		Count   int  `json:"count"`
	}
	_ = json.NewDecoder(r.Body).Decode(&impResp)
	if !impResp.Success || impResp.Count != 2 {
		t.Fatalf("unexpected import response: %+v", impResp)
	}

	// Export and verify ascending order & headers
	expRec := env.doJSON(t, http.MethodGet, "/api/portfolio/"+pid+"/export", cookie, nil)
	if expRec.Code != http.StatusOK {
		t.Fatalf("export failed: %d", expRec.Code)
	}
	if !strings.HasPrefix(expRec.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("unexpected Content-Type: %q", expRec.Header().Get("Content-Type"))
	}
	if !strings.Contains(expRec.Header().Get("Content-Disposition"), "portfolio_export_"+pid+".csv") {
		t.Fatalf("unexpected Content-Disposition: %q", expRec.Header().Get("Content-Disposition"))
	}

	rows, err := csv.NewReader(expRec.Body).ReadAll()
	if err != nil {
		t.Fatalf("parse exported csv: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 CSV rows, got %d", len(rows))
	}
	// Ascending order: 2025-01-10 (AAPL) first, 2025-02-01 (MSFT) second
	if rows[1][0] != "AAPL" || rows[2][0] != "MSFT" {
		t.Fatalf("unexpected export order: %+v", rows)
	}
}

func TestSearchCacheAndStaticSPA(t *testing.T) {
	env := setupTestEnv(t, true)
	_, cookie := env.loginUser(t, "spa@example.com", "SPA")

	// Search < 2 chars returns []
	rec := env.doJSON(t, http.MethodGet, "/api/finance/search?q=a", cookie, nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("short search unexpected: %d %s", rec.Code, rec.Body.String())
	}

	// Search >= 2 chars returns Yahoo results
	rec = env.doJSON(t, http.MethodGet, "/api/finance/search?q=AAPL", cookie, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "AAPL") {
		t.Fatalf("search AAPL unexpected: %d %s", rec.Code, rec.Body.String())
	}

	// Clear cache
	rec = env.doJSON(t, http.MethodDelete, "/api/cache", cookie, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"success":true`) {
		t.Fatalf("clear cache unexpected: %d %s", rec.Code, rec.Body.String())
	}

	// Static SPA: /assets/app.js gets immutable cache-control
	rec = env.doJSON(t, http.MethodGet, "/assets/app.js", nil, nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset unexpected: %d cache=%q", rec.Code, rec.Header().Get("Cache-Control"))
	}

	// Static SPA: unknown client route falls back to index.html
	rec = env.doJSON(t, http.MethodGet, "/portfolio/abc", nil, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Hold SPA") {
		t.Fatalf("SPA fallback unexpected: %d %s", rec.Code, rec.Body.String())
	}

	// Unknown /api/ route returns 404 JSON, not index.html
	rec = env.doJSON(t, http.MethodGet, "/api/does-not-exist", nil, nil)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "Hold SPA") {
		t.Fatalf("unknown /api/ route unexpected: %d %s", rec.Code, rec.Body.String())
	}
}
