package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
	"github.com/go-jose/go-jose/v4"
)

func openTestStore(t *testing.T) *db.Store {
	t.Helper()
	store, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestNewServiceSecretRequirements(t *testing.T) {
	store := openTestStore(t)

	if _, err := NewService(config.Config{AllowDemoLogin: false, AuthSecret: ""}, store); err == nil {
		t.Fatal("expected error when AuthSecret is empty and AllowDemoLogin is false")
	}

	svc, err := NewService(config.Config{AllowDemoLogin: true, AuthSecret: ""}, store)
	if err != nil {
		t.Fatalf("expected ephemeral secret when AllowDemoLogin is true, got error: %v", err)
	}
	if len(svc.secret) == 0 {
		t.Fatal("expected non-empty ephemeral secret")
	}
}

func TestJWTSignVerifyTamperExpiry(t *testing.T) {
	store := openTestStore(t)
	now := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	svc, err := NewService(config.Config{AuthSecret: "super-secret-key", AuthURL: "https://hold.example.com"}, store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	svc.now = func() time.Time { return now }

	claims := Claims{
		Sub:   "user-123",
		Email: "alice@example.com",
		Name:  "Alice",
		Iat:   now.Unix(),
		Exp:   now.Add(time.Hour).Unix(),
	}
	tok, err := svc.SignJWT(claims)
	if err != nil {
		t.Fatalf("SignJWT: %v", err)
	}

	got, err := svc.VerifyJWT(tok)
	if err != nil {
		t.Fatalf("VerifyJWT: %v", err)
	}
	if got.Sub != "user-123" || got.Email != "alice@example.com" {
		t.Fatalf("unexpected claims: %+v", got)
	}

	// Tamper with payload
	parts := strings.Split(tok, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"evil","exp":9999999999}`))
	if _, err := svc.VerifyJWT(strings.Join(parts, ".")); err == nil {
		t.Fatal("expected error for tampered payload")
	}

	// Tamper with signature
	if _, err := svc.VerifyJWT(parts[0] + "." + parts[1] + ".invalidsig"); err == nil {
		t.Fatal("expected error for invalid signature")
	}

	// Expired token
	svc.now = func() time.Time { return now.Add(2 * time.Hour) }
	if _, err := svc.VerifyJWT(tok); err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestSessionCookiesAndRequireAuth(t *testing.T) {
	store := openTestStore(t)
	svc, err := NewService(config.Config{AuthSecret: "test-secret", AuthURL: "https://hold.example.com"}, store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	rec := httptest.NewRecorder()
	err = svc.IssueSessionCookie(rec, db.User{ID: "u1", Email: "u1@example.com", Name: "U1"})
	if err != nil {
		t.Fatalf("IssueSessionCookie: %v", err)
	}

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != SessionCookieName || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.MaxAge != SessionMaxAge {
		t.Fatalf("unexpected cookie attributes: %+v", c)
	}

	// Valid request passes RequireAuth
	var gotUserID string
	protected := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID, _ = UserIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/portfolio", nil)
	req.AddCookie(c)
	authRec := httptest.NewRecorder()
	protected.ServeHTTP(authRec, req)
	if authRec.Code != http.StatusOK || gotUserID != "u1" {
		t.Fatalf("expected 200 with u1, got status=%d user=%q", authRec.Code, gotUserID)
	}

	// Missing cookie fails RequireAuth
	unauthRec := httptest.NewRecorder()
	protected.ServeHTTP(unauthRec, httptest.NewRequest(http.MethodGet, "/api/portfolio", nil))
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthRec.Code)
	}

	// ClearSessionCookie expires it
	clearRec := httptest.NewRecorder()
	svc.ClearSessionCookie(clearRec)
	cleared := clearRec.Result().Cookies()[0]
	if cleared.MaxAge != -1 || cleared.Value != "" {
		t.Fatalf("expected cleared cookie, got %+v", cleared)
	}
}

func TestProvidersSessionDemoAndLogoutHandlers(t *testing.T) {
	store := openTestStore(t)

	// Demo disabled
	disabledSvc, err := NewService(config.Config{AuthSecret: "s", AllowDemoLogin: false}, store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	mux := http.NewServeMux()
	disabledSvc.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/demo", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when demo login disabled, got %d", rec.Code)
	}

	// Demo enabled + OIDC configured
	enabledSvc, err := NewService(config.Config{
		AuthSecret:       "s",
		AuthURL:          "http://localhost:3000",
		AllowDemoLogin:   true,
		AuthOIDCIssuer:   "https://idp.example.com",
		AuthOIDCClientID: "client-1",
		AuthOIDCName:     "Authentik",
	}, store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	mux = http.NewServeMux()
	enabledSvc.RegisterRoutes(mux)

	// Providers
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/providers", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("providers status = %d", rec.Code)
	}
	var providers map[string]ProviderInfo
	if err := json.NewDecoder(rec.Body).Decode(&providers); err != nil {
		t.Fatalf("decode providers: %v", err)
	}
	if providers["oidc"].Name != "Authentik" || providers["credentials"].Name != "User" {
		t.Fatalf("unexpected providers: %+v", providers)
	}

	// Unauthenticated session -> {"user": null}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("session status = %d", rec.Code)
	}
	var sessResp map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&sessResp)
	if sessResp["user"] != nil {
		t.Fatalf("expected null user, got %+v", sessResp)
	}

	// Demo login with default email/name
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/demo", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("demo login status = %d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected session cookie after demo login")
	}

	// Authenticated session
	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("session status = %d", rec.Code)
	}
	var authSess struct {
		User *SessionUser `json:"user"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&authSess)
	if authSess.User == nil || authSess.User.Email != "test@example.com" {
		t.Fatalf("unexpected session user: %+v", authSess.User)
	}

	// Logout
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("logout status = %d", rec.Code)
	}
	if rec.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("expected cleared cookie on logout")
	}
}

func TestOIDCLoginAndCallbackFlow(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	jwk := jose.JSONWebKey{
		Key:       &privKey.PublicKey,
		KeyID:     "test-kid",
		Algorithm: string(jose.RS256),
		Use:       "sig",
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privKey}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test-kid"))
	if err != nil {
		t.Fatalf("new jose signer: %v", err)
	}

	var issuerURL string
	var capturedChallenge string
	var capturedRedirectURI string

	oidcMux := http.NewServeMux()
	oidcMux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                issuerURL,
			"authorization_endpoint":                issuerURL + "/authorize",
			"token_endpoint":                        issuerURL + "/token",
			"jwks_uri":                              issuerURL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	oidcMux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{jwk}})
	})
	oidcMux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		if r.Form.Get("code") != "auth-code-1" {
			http.Error(w, "bad code", http.StatusBadRequest)
			return
		}
		verifier := r.Form.Get("code_verifier")
		sum := sha256.Sum256([]byte(verifier))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != capturedChallenge {
			http.Error(w, "pkce mismatch", http.StatusBadRequest)
			return
		}

		now := time.Now().UTC()
		idClaims, _ := json.Marshal(map[string]any{
			"iss":     issuerURL,
			"sub":     "oidc-sub-42",
			"aud":     "hold-client",
			"exp":     now.Add(time.Hour).Unix(),
			"iat":     now.Unix(),
			"email":   "bob@example.com",
			"name":    "Bob",
			"picture": "https://example.com/bob.png",
		})
		jws, err := signer.Sign(idClaims)
		if err != nil {
			http.Error(w, "sign error", http.StatusInternalServerError)
			return
		}
		rawIDToken, err := jws.CompactSerialize()
		if err != nil {
			http.Error(w, "serialize error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "access-123",
			"token_type":   "Bearer",
			"expires_in":   3600,
			"id_token":     rawIDToken,
		})
	})

	oidcSrv := httptest.NewServer(oidcMux)
	defer oidcSrv.Close()
	issuerURL = oidcSrv.URL

	store := openTestStore(t)
	svc, err := NewService(config.Config{
		AuthSecret:           "oidc-test-secret",
		AuthURL:              "http://localhost:3000",
		AuthOIDCIssuer:       issuerURL,
		AuthOIDCClientID:     "hold-client",
		AuthOIDCClientSecret: "hold-secret",
		AuthOIDCName:         "MockOIDC",
	}, store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	svc.httpClient = oidcSrv.Client()

	mux := http.NewServeMux()
	svc.RegisterRoutes(mux)

	// Step 1: Login redirects to OIDC authorize endpoint with PKCE + state cookie
	loginRec := httptest.NewRecorder()
	mux.ServeHTTP(loginRec, httptest.NewRequest(http.MethodGet, "/api/auth/login/oidc", nil))
	if loginRec.Code != http.StatusFound {
		t.Fatalf("expected 302 from login, got %d (%s)", loginRec.Code, loginRec.Body.String())
	}

	loc, err := url.Parse(loginRec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect location: %v", err)
	}
	q := loc.Query()
	state := q.Get("state")
	capturedChallenge = q.Get("code_challenge")
	capturedRedirectURI = q.Get("redirect_uri")
	if state == "" || capturedChallenge == "" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("missing PKCE/state params in redirect: %s", loc.String())
	}
	if capturedRedirectURI != "http://localhost:3000/api/auth/callback/oidc" {
		t.Fatalf("unexpected redirect_uri: %q", capturedRedirectURI)
	}

	var stateCookie *http.Cookie
	for _, c := range loginRec.Result().Cookies() {
		if c.Name == oidcStateCookieName {
			stateCookie = c
		}
	}
	if stateCookie == nil {
		t.Fatal("expected hold_oidc_state cookie")
	}

	// Step 2: Callback exchanges code, verifies ID token, creates user, sets hold_session cookie
	cbReq := httptest.NewRequest(http.MethodGet, "/api/auth/callback/oidc?code=auth-code-1&state="+url.QueryEscape(state), nil)
	cbReq.AddCookie(stateCookie)
	cbRec := httptest.NewRecorder()
	mux.ServeHTTP(cbRec, cbReq)
	if cbRec.Code != http.StatusFound {
		t.Fatalf("expected 302 from callback, got %d (%s)", cbRec.Code, cbRec.Body.String())
	}
	if cbRec.Header().Get("Location") != "/" {
		t.Fatalf("expected redirect to /, got %q", cbRec.Header().Get("Location"))
	}

	var sessionCookie *http.Cookie
	for _, c := range cbRec.Result().Cookies() {
		if c.Name == SessionCookieName {
			sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("expected hold_session cookie after callback")
	}

	// Step 3: Session endpoint returns the OIDC user
	sessReq := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessReq.AddCookie(sessionCookie)
	sessRec := httptest.NewRecorder()
	mux.ServeHTTP(sessRec, sessReq)
	var sessOut struct {
		User *SessionUser `json:"user"`
	}
	_ = json.NewDecoder(sessRec.Body).Decode(&sessOut)
	if sessOut.User == nil || sessOut.User.Email != "bob@example.com" || sessOut.User.Name != "Bob" {
		t.Fatalf("unexpected OIDC session user: %+v", sessOut.User)
	}
}
