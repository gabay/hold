package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gabay/hold/internal/auth"
	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
	"github.com/gabay/hold/internal/portfolio"
)

// Server wires HTTP routes to the application services.
type Server struct {
	cfg       config.Config
	store     *db.Store
	auth      *auth.Service
	finance   *finance.Service
	portfolio *portfolio.Service
	staticFS  fs.FS
}

// New constructs the HTTP handler with all API routes, optional static SPA serving,
// panic recovery, and structured request logging.
func New(
	cfg config.Config,
	store *db.Store,
	authSvc *auth.Service,
	financeSvc *finance.Service,
	portfolioSvc *portfolio.Service,
	staticFS fs.FS,
) http.Handler {
	s := &Server{
		cfg:       cfg,
		store:     store,
		auth:      authSvc,
		finance:   financeSvc,
		portfolio: portfolioSvc,
		staticFS:  staticFS,
	}

	mux := http.NewServeMux()

	// Public endpoints
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/currencies", s.handleCurrencies)

	// Auth endpoints
	authSvc.RegisterRoutes(mux)

	// Protected portfolio endpoints
	protect := authSvc.RequireAuth
	mux.Handle("GET /api/portfolio", protect(http.HandlerFunc(s.handleListPortfolios)))
	mux.Handle("POST /api/portfolio", protect(http.HandlerFunc(s.handleCreatePortfolio)))
	mux.Handle("PATCH /api/portfolio/{id}", protect(http.HandlerFunc(s.handleRenamePortfolio)))
	mux.Handle("DELETE /api/portfolio/{id}", protect(http.HandlerFunc(s.handleDeletePortfolio)))
	mux.Handle("GET /api/portfolio/{id}/data", protect(http.HandlerFunc(s.handleGetPortfolioData)))

	// Protected transaction endpoints
	mux.Handle("GET /api/portfolio/{id}/transactions", protect(http.HandlerFunc(s.handleListTransactions)))
	mux.Handle("POST /api/portfolio/{id}/transactions", protect(http.HandlerFunc(s.handleCreateTransaction)))
	mux.Handle("DELETE /api/portfolio/{id}/transactions", protect(http.HandlerFunc(s.handleDeleteAllTransactions)))
	mux.Handle("PUT /api/portfolio/{id}/transactions/{txid}", protect(http.HandlerFunc(s.handleUpdateTransaction)))
	mux.Handle("DELETE /api/portfolio/{id}/transactions/{txid}", protect(http.HandlerFunc(s.handleDeleteTransaction)))

	// Protected CSV endpoints
	mux.Handle("GET /api/portfolio/{id}/export", protect(http.HandlerFunc(s.handleExportCSV)))
	mux.Handle("POST /api/portfolio/{id}/import", protect(http.HandlerFunc(s.handleImportCSV)))

	// Protected search & cache endpoints
	mux.Handle("GET /api/finance/search", protect(http.HandlerFunc(s.handleFinanceSearch)))
	mux.Handle("DELETE /api/cache", protect(http.HandlerFunc(s.handleClearCache)))

	// Static SPA fallback when staticFS is provided
	if staticFS != nil {
		mux.HandleFunc("GET /", s.handleSPA)
	}

	return s.recoverMiddleware(s.loggingMiddleware(mux))
}

func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	clean := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if clean == "" || clean == "." {
		clean = "index.html"
	}

	if s.serveStaticFile(w, r, clean) {
		return
	}

	// SPA fallback to index.html for client-side routes
	if !s.serveStaticFile(w, r, "index.html") {
		http.NotFound(w, r)
	}
}

func (s *Server) serveStaticFile(w http.ResponseWriter, r *http.Request, name string) bool {
	f, err := s.staticFS.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}

	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	if ctype := mime.TypeByExtension(path.Ext(name)); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}

	if rs, ok := f.(io.ReadSeeker); ok {
		http.ServeContent(w, r, info.Name(), info.ModTime(), rs)
		return true
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return false
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), bytes.NewReader(data))
	return true
}

type statusResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusResponseWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.status = code
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(b)
}

func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered",
					"panic", rec,
					"method", r.Method,
					"path", r.URL.Path,
					"stack", string(debug.Stack()),
				)
				writeError(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requirePortfolio(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return "", "", false
	}
	portfolioID := r.PathValue("id")
	if portfolioID == "" {
		writeError(w, http.StatusNotFound, "Portfolio not found")
		return "", "", false
	}
	if _, err := s.store.GetPortfolio(r.Context(), portfolioID, userID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Portfolio not found")
			return "", "", false
		}
		slog.Error("verify portfolio ownership failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to verify portfolio")
		return "", "", false
	}
	return userID, portfolioID, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("empty body")
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(dst)
}
