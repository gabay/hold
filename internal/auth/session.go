package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gabay/hold/internal/db"
)

const (
	// SessionCookieName is the HTTP cookie storing the signed session JWT.
	SessionCookieName = "hold_session"
	// SessionMaxAge is the session lifetime in seconds (30 days).
	SessionMaxAge = 30 * 24 * 60 * 60
)

// Claims represents the JWT payload stored in the session cookie.
type Claims struct {
	Sub   string `json:"sub"`
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
	Image string `json:"image,omitempty"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

var jwtHeaderEncoded = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

func signHS256(signingInput string, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func generateRandomSecret(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("generate random secret: %w", err)
	}
	return b, nil
}

// SignJWT creates an HS256-signed JWT string for the given claims.
func (s *Service) SignJWT(claims Claims) (string, error) {
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal claims: %w", err)
	}
	payloadEncoded := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := jwtHeaderEncoded + "." + payloadEncoded
	sig := signHS256(signingInput, s.secret)
	return signingInput + "." + sig, nil
}

// VerifyJWT validates an HS256-signed JWT string and returns its claims.
func (s *Service) VerifyJWT(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, errors.New("invalid token format")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, errors.New("invalid token header")
	}
	var hdr struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &hdr); err != nil || hdr.Alg != "HS256" {
		return Claims{}, errors.New("unsupported token algorithm")
	}

	expectedSig := signHS256(parts[0]+"."+parts[1], s.secret)
	gotSigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, errors.New("invalid token signature encoding")
	}
	expectedSigBytes, _ := base64.RawURLEncoding.DecodeString(expectedSig)
	if !hmac.Equal(gotSigBytes, expectedSigBytes) {
		return Claims{}, errors.New("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, errors.New("invalid token payload")
	}
	var claims Claims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return Claims{}, errors.New("malformed token claims")
	}
	if claims.Sub == "" {
		return Claims{}, errors.New("missing subject claim")
	}
	if s.now().Unix() >= claims.Exp {
		return Claims{}, errors.New("token expired")
	}
	return claims, nil
}

// IssueSessionCookie signs a session JWT for user and writes the hold_session cookie.
func (s *Service) IssueSessionCookie(w http.ResponseWriter, user db.User) error {
	now := s.now().UTC()
	claims := Claims{
		Sub:   user.ID,
		Email: user.Email,
		Name:  user.Name,
		Image: user.Image,
		Iat:   now.Unix(),
		Exp:   now.Add(SessionMaxAge * time.Second).Unix(),
	}
	token, err := s.SignJWT(claims)
	if err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   SessionMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	return nil
}

// ClearSessionCookie expires the hold_session cookie.
func (s *Service) ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
}

// ParseSession extracts and verifies the session JWT from the request cookie.
func (s *Service) ParseSession(r *http.Request) (Claims, bool) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		return Claims{}, false
	}
	claims, err := s.VerifyJWT(cookie.Value)
	if err != nil {
		return Claims{}, false
	}
	return claims, true
}
