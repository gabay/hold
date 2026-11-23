package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
	"golang.org/x/oauth2"
)

const oidcStateCookieName = "hold_oidc_state"

type userIDContextKey struct{}

// UserIDFromContext returns the authenticated user ID stored on ctx by RequireAuth.
func UserIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDContextKey{}).(string)
	return id, ok && id != ""
}

// ContextWithUserID returns a copy of ctx with userID attached (useful for tests).
func ContextWithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDContextKey{}, userID)
}

// ProviderInfo describes an enabled authentication provider returned by /api/auth/providers.
type ProviderInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SessionUser is the public user payload returned by /api/auth/session and /api/auth/demo.
type SessionUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Image string `json:"image"`
}

// Service manages session cookies, demo login, and optional OIDC authentication.
type Service struct {
	cfg          config.Config
	store        *db.Store
	secret       []byte
	secureCookie bool
	now          func() time.Time

	oidcMu       sync.Mutex
	oidcProvider *oidc.Provider
	oidcVerifier *oidc.IDTokenVerifier
	oauth2Config *oauth2.Config
	httpClient   *http.Client
}

// NewService constructs an authentication Service.
// If AuthSecret is empty and AllowDemoLogin is true, an ephemeral random secret is generated with a warning.
// If AuthSecret is empty and AllowDemoLogin is false, an error is returned.
func NewService(cfg config.Config, store *db.Store) (*Service, error) {
	var secret []byte
	if cfg.AuthSecret != "" {
		secret = []byte(cfg.AuthSecret)
	} else if cfg.AllowDemoLogin {
		var err error
		secret, err = generateRandomSecret(32)
		if err != nil {
			return nil, err
		}
		slog.Warn("AUTH_SECRET is not set; using an ephemeral random signing key (sessions will reset on restart)")
	} else {
		return nil, errors.New("AUTH_SECRET must be set when ALLOW_DEMO_LOGIN is false")
	}

	return &Service{
		cfg:          cfg,
		store:        store,
		secret:       secret,
		secureCookie: strings.HasPrefix(strings.ToLower(cfg.AuthURL), "https://"),
		now:          time.Now,
	}, nil
}

// RegisterRoutes mounts all authentication endpoints onto mux.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/providers", s.HandleProviders)
	mux.HandleFunc("GET /api/auth/session", s.HandleSession)
	mux.HandleFunc("GET /api/auth/login/oidc", s.HandleOIDCLogin)
	mux.HandleFunc("GET /api/auth/callback/oidc", s.HandleOIDCCallback)
	mux.HandleFunc("POST /api/auth/demo", s.HandleDemoLogin)
	mux.HandleFunc("POST /api/auth/logout", s.HandleLogout)
}

// RequireAuth middleware validates the session cookie and attaches the user ID to the request context.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := s.ParseSession(r)
		if !ok {
			writeAuthJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		ctx := ContextWithUserID(r.Context(), claims.Sub)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// HandleProviders returns the enabled authentication providers.
func (s *Service) HandleProviders(w http.ResponseWriter, _ *http.Request) {
	providers := make(map[string]ProviderInfo)
	if s.cfg.OIDCEnabled() {
		providers["oidc"] = ProviderInfo{
			ID:   "oidc",
			Name: s.cfg.AuthOIDCName,
		}
	}
	if s.cfg.AllowDemoLogin {
		providers["credentials"] = ProviderInfo{
			ID:   "credentials",
			Name: "User",
		}
	}
	writeAuthJSON(w, http.StatusOK, providers)
}

// HandleSession returns the current authenticated user, or {"user": null} when unauthenticated.
func (s *Service) HandleSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.ParseSession(r)
	if !ok {
		writeAuthJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}

	user, err := s.store.GetUserByID(r.Context(), claims.Sub)
	if err != nil {
		if !errors.Is(err, db.ErrNotFound) {
			slog.Error("failed to load session user", "user_id", claims.Sub, "error", err)
		}
		writeAuthJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}

	writeAuthJSON(w, http.StatusOK, map[string]any{
		"user": toSessionUser(user),
	})
}

// HandleDemoLogin authenticates a demo user when ALLOW_DEMO_LOGIN=true.
func (s *Service) HandleDemoLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.AllowDemoLogin {
		writeAuthJSON(w, http.StatusForbidden, map[string]string{"error": "Demo login is disabled"})
		return
	}

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if r.Body != nil {
		dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if err := dec.Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON payload"})
			return
		}
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = "test@example.com"
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "User"
	}

	user, err := s.store.FindOrCreateUserByEmail(r.Context(), email, name)
	if err != nil {
		slog.Error("demo login failed", "error", err)
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to sign in"})
		return
	}

	if err := s.IssueSessionCookie(w, user); err != nil {
		slog.Error("issue session cookie failed", "error", err)
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create session"})
		return
	}

	writeAuthJSON(w, http.StatusOK, map[string]any{
		"user": toSessionUser(user),
	})
}

// HandleLogout clears the session cookie.
func (s *Service) HandleLogout(w http.ResponseWriter, _ *http.Request) {
	s.ClearSessionCookie(w)
	writeAuthJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Service) oidcContext(ctx context.Context) context.Context {
	if s.httpClient != nil {
		return oidc.ClientContext(ctx, s.httpClient)
	}
	return ctx
}

func (s *Service) ensureOIDC(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	if !s.cfg.OIDCEnabled() {
		return nil, nil, errors.New("OIDC is not configured")
	}

	s.oidcMu.Lock()
	defer s.oidcMu.Unlock()

	if s.oauth2Config != nil && s.oidcVerifier != nil {
		return s.oauth2Config, s.oidcVerifier, nil
	}

	provider, err := oidc.NewProvider(s.oidcContext(ctx), s.cfg.AuthOIDCIssuer)
	if err != nil {
		return nil, nil, fmt.Errorf("oidc discovery: %w", err)
	}

	oauthCfg := &oauth2.Config{
		ClientID:     s.cfg.AuthOIDCClientID,
		ClientSecret: s.cfg.AuthOIDCClientSecret,
		RedirectURL:  s.cfg.AuthURL + "/api/auth/callback/oidc",
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	verifier := provider.Verifier(&oidc.Config{
		ClientID: s.cfg.AuthOIDCClientID,
	})

	s.oidcProvider = provider
	s.oauth2Config = oauthCfg
	s.oidcVerifier = verifier
	return oauthCfg, verifier, nil
}

type oidcStatePayload struct {
	State    string `json:"state"`
	Verifier string `json:"verifier"`
	Exp      int64  `json:"exp"`
}

func (s *Service) setOIDCStateCookie(w http.ResponseWriter, state, verifier string) error {
	payload := oidcStatePayload{
		State:    state,
		Verifier: verifier,
		Exp:      s.now().UTC().Add(10 * time.Minute).Unix(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	sig := signHS256(encoded, s.secret)

	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    encoded + "." + sig,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	return nil
}

func (s *Service) clearOIDCStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
}

func (s *Service) parseOIDCStateCookie(r *http.Request) (oidcStatePayload, bool) {
	c, err := r.Cookie(oidcStateCookieName)
	if err != nil || c.Value == "" {
		return oidcStatePayload{}, false
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 2 {
		return oidcStatePayload{}, false
	}
	expectedSig := signHS256(parts[0], s.secret)
	gotSigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return oidcStatePayload{}, false
	}
	expectedSigBytes, _ := base64.RawURLEncoding.DecodeString(expectedSig)
	if !hmac.Equal(gotSigBytes, expectedSigBytes) {
		return oidcStatePayload{}, false
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return oidcStatePayload{}, false
	}
	var payload oidcStatePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return oidcStatePayload{}, false
	}
	if payload.State == "" || payload.Verifier == "" || s.now().Unix() >= payload.Exp {
		return oidcStatePayload{}, false
	}
	return payload, true
}

// HandleOIDCLogin initiates the OIDC authorization code flow with PKCE.
func (s *Service) HandleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.OIDCEnabled() {
		writeAuthJSON(w, http.StatusNotFound, map[string]string{"error": "OIDC is not configured"})
		return
	}

	oauthCfg, _, err := s.ensureOIDC(r.Context())
	if err != nil {
		slog.Error("oidc discovery failed", "error", err)
		writeAuthJSON(w, http.StatusBadGateway, map[string]string{"error": "OIDC provider unavailable"})
		return
	}

	var stateBytes [16]byte
	if _, err := rand.Read(stateBytes[:]); err != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate state"})
		return
	}
	state := hex.EncodeToString(stateBytes[:])
	verifier := oauth2.GenerateVerifier()

	if err := s.setOIDCStateCookie(w, state, verifier); err != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist auth state"})
		return
	}

	authURL := oauthCfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier))
	http.Redirect(w, r, authURL, http.StatusFound)
}

// HandleOIDCCallback completes the OIDC authorization code exchange and issues a session cookie.
func (s *Service) HandleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.OIDCEnabled() {
		writeAuthJSON(w, http.StatusNotFound, map[string]string{"error": "OIDC is not configured"})
		return
	}

	s.clearOIDCStateCookie(w)

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC authorization failed: " + errParam})
		return
	}

	stateCookie, ok := s.parseOIDCStateCookie(r)
	if !ok {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or expired OIDC state"})
		return
	}

	queryState := r.URL.Query().Get("state")
	if subtle.ConstantTimeCompare([]byte(queryState), []byte(stateCookie.State)) != 1 {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid OIDC state"})
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing authorization code"})
		return
	}

	oauthCfg, verifier, err := s.ensureOIDC(r.Context())
	if err != nil {
		slog.Error("oidc discovery failed during callback", "error", err)
		writeAuthJSON(w, http.StatusBadGateway, map[string]string{"error": "OIDC provider unavailable"})
		return
	}

	ctx := s.oidcContext(r.Context())
	token, err := oauthCfg.Exchange(ctx, code, oauth2.VerifierOption(stateCookie.Verifier))
	if err != nil {
		slog.Error("oidc code exchange failed", "error", err)
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Failed to exchange authorization code"})
		return
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing id_token in OIDC response"})
		return
	}

	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		slog.Error("oidc id_token verification failed", "error", err)
		writeAuthJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid id_token"})
		return
	}

	var idClaims struct {
		Sub               string `json:"sub"`
		Email             string `json:"email"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
		Picture           string `json:"picture"`
	}
	if err := idToken.Claims(&idClaims); err != nil {
		writeAuthJSON(w, http.StatusBadRequest, map[string]string{"error": "Failed to parse id_token claims"})
		return
	}
	if idClaims.Sub == "" {
		idClaims.Sub = idToken.Subject
	}

	name := strings.TrimSpace(idClaims.Name)
	if name == "" {
		name = strings.TrimSpace(idClaims.PreferredUsername)
	}
	if name == "" {
		name = strings.TrimSpace(idClaims.Email)
	}
	if name == "" {
		name = "User"
	}

	user, err := s.store.FindOrCreateOIDCUser(r.Context(), "oidc", idClaims.Sub, idClaims.Email, name, idClaims.Picture)
	if err != nil {
		slog.Error("failed to find or create OIDC user", "error", err)
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist user"})
		return
	}

	if err := s.IssueSessionCookie(w, user); err != nil {
		slog.Error("failed to issue session cookie", "error", err)
		writeAuthJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create session"})
		return
	}

	http.Redirect(w, r, "/", http.StatusFound)
}

func toSessionUser(u db.User) SessionUser {
	return SessionUser{
		ID:    u.ID,
		Name:  u.Name,
		Email: u.Email,
		Image: u.Image,
	}
}

func writeAuthJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
