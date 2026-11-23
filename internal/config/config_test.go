package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	keys := []string{
		"PORT",
		"DATABASE_URL",
		"AUTH_SECRET",
		"AUTH_URL",
		"ALLOW_DEMO_LOGIN",
		"AUTH_OIDC_ISSUER",
		"AUTH_OIDC_CLIENT_ID",
		"AUTH_OIDC_CLIENT_SECRET",
		"AUTH_OIDC_NAME",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}

	cfg := Load()

	if cfg.Port != "3000" {
		t.Errorf("Port = %q, want %q", cfg.Port, "3000")
	}
	if cfg.DatabaseURL != "./data/hold.db" {
		t.Errorf("DatabaseURL = %q, want %q", cfg.DatabaseURL, "./data/hold.db")
	}
	if cfg.AuthSecret != "" {
		t.Errorf("AuthSecret = %q, want empty", cfg.AuthSecret)
	}
	if cfg.AuthURL != "http://localhost:3000" {
		t.Errorf("AuthURL = %q, want %q", cfg.AuthURL, "http://localhost:3000")
	}
	if cfg.AllowDemoLogin {
		t.Errorf("AllowDemoLogin = true, want false")
	}
	if cfg.AuthOIDCName != "OIDC" {
		t.Errorf("AuthOIDCName = %q, want %q", cfg.AuthOIDCName, "OIDC")
	}
	if cfg.OIDCEnabled() {
		t.Errorf("OIDCEnabled() = true, want false")
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("PORT", "8080")
	t.Setenv("DATABASE_URL", "file:/var/lib/hold/hold.db")
	t.Setenv("AUTH_SECRET", "super-secret")
	t.Setenv("AUTH_URL", "https://hold.example.com///")
	t.Setenv("ALLOW_DEMO_LOGIN", "true")
	t.Setenv("AUTH_OIDC_ISSUER", "https://auth.example.com")
	t.Setenv("AUTH_OIDC_CLIENT_ID", "hold-client")
	t.Setenv("AUTH_OIDC_CLIENT_SECRET", "oidc-secret")
	t.Setenv("AUTH_OIDC_NAME", "Authelia")

	cfg := Load()

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.DatabaseURL != "/var/lib/hold/hold.db" {
		t.Errorf("DatabaseURL = %q, want %q", cfg.DatabaseURL, "/var/lib/hold/hold.db")
	}
	if cfg.AuthSecret != "super-secret" {
		t.Errorf("AuthSecret = %q, want %q", cfg.AuthSecret, "super-secret")
	}
	if cfg.AuthURL != "https://hold.example.com" {
		t.Errorf("AuthURL = %q, want %q", cfg.AuthURL, "https://hold.example.com")
	}
	if !cfg.AllowDemoLogin {
		t.Errorf("AllowDemoLogin = false, want true")
	}
	if cfg.AuthOIDCIssuer != "https://auth.example.com" {
		t.Errorf("AuthOIDCIssuer = %q, want %q", cfg.AuthOIDCIssuer, "https://auth.example.com")
	}
	if cfg.AuthOIDCClientID != "hold-client" {
		t.Errorf("AuthOIDCClientID = %q, want %q", cfg.AuthOIDCClientID, "hold-client")
	}
	if cfg.AuthOIDCClientSecret != "oidc-secret" {
		t.Errorf("AuthOIDCClientSecret = %q, want %q", cfg.AuthOIDCClientSecret, "oidc-secret")
	}
	if cfg.AuthOIDCName != "Authelia" {
		t.Errorf("AuthOIDCName = %q, want %q", cfg.AuthOIDCName, "Authelia")
	}
	if !cfg.OIDCEnabled() {
		t.Errorf("OIDCEnabled() = false, want true")
	}
}

func TestOIDCEnabledRequiresBothIssuerAndClientID(t *testing.T) {
	t.Setenv("AUTH_OIDC_ISSUER", "https://auth.example.com")
	t.Setenv("AUTH_OIDC_CLIENT_ID", "")
	if Load().OIDCEnabled() {
		t.Errorf("OIDCEnabled() = true when client ID is empty")
	}

	t.Setenv("AUTH_OIDC_ISSUER", "")
	t.Setenv("AUTH_OIDC_CLIENT_ID", "hold-client")
	if Load().OIDCEnabled() {
		t.Errorf("OIDCEnabled() = true when issuer is empty")
	}
}
