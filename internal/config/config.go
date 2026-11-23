package config

import (
	"os"
	"strings"
)

// Config holds runtime configuration loaded from environment variables.
type Config struct {
	Port                 string
	DatabaseURL          string
	AuthSecret           string
	AuthURL              string
	AllowDemoLogin       bool
	AuthOIDCIssuer       string
	AuthOIDCClientID     string
	AuthOIDCClientSecret string
	AuthOIDCName         string
}

// Load reads configuration from environment variables, applying defaults where omitted.
func Load() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	dbURL := strings.TrimPrefix(os.Getenv("DATABASE_URL"), "file:")
	if dbURL == "" {
		dbURL = "./data/hold.db"
	}

	authURL := os.Getenv("AUTH_URL")
	if authURL == "" {
		authURL = "http://localhost:3000"
	}
	authURL = strings.TrimRight(authURL, "/")

	oidcName := os.Getenv("AUTH_OIDC_NAME")
	if oidcName == "" {
		oidcName = "OIDC"
	}

	return Config{
		Port:                 port,
		DatabaseURL:          dbURL,
		AuthSecret:           os.Getenv("AUTH_SECRET"),
		AuthURL:              authURL,
		AllowDemoLogin:       os.Getenv("ALLOW_DEMO_LOGIN") == "true",
		AuthOIDCIssuer:       os.Getenv("AUTH_OIDC_ISSUER"),
		AuthOIDCClientID:     os.Getenv("AUTH_OIDC_CLIENT_ID"),
		AuthOIDCClientSecret: os.Getenv("AUTH_OIDC_CLIENT_SECRET"),
		AuthOIDCName:         oidcName,
	}
}

// OIDCEnabled reports whether OIDC authentication is configured.
func (c Config) OIDCEnabled() bool {
	return c.AuthOIDCIssuer != "" && c.AuthOIDCClientID != ""
}
