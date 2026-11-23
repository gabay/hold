package server

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gabay/hold/internal/auth"
	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
)

func (s *Server) handleListPortfolios(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	portfolios, err := s.store.EnsureDefaultPortfolio(r.Context(), userID)
	if err != nil {
		slog.Error("list portfolios failed", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to load portfolios")
		return
	}
	writeJSON(w, http.StatusOK, portfolios)
}

func (s *Server) handleCreatePortfolio(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name is required")
		return
	}

	p, err := s.store.CreatePortfolio(r.Context(), userID, name)
	if err != nil {
		slog.Error("create portfolio failed", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to create portfolio")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleRenamePortfolio(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	id := r.PathValue("id")
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Name is required")
		return
	}

	if err := s.store.RenamePortfolio(r.Context(), id, userID, name); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Portfolio not found")
			return
		}
		slog.Error("rename portfolio failed", "portfolio_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to rename portfolio")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"id":   id,
		"name": name,
	})
}

func (s *Server) handleDeletePortfolio(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	id := r.PathValue("id")
	if err := s.store.DeletePortfolio(r.Context(), id, userID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Portfolio not found")
			return
		}
		slog.Error("delete portfolio failed", "portfolio_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to delete portfolio")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleGetPortfolioData(w http.ResponseWriter, r *http.Request) {
	userID, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	currency := strings.TrimSpace(r.URL.Query().Get("currency"))
	if currency == "" {
		currency = "USD"
	} else {
		currency = strings.ToUpper(currency)
		if !finance.IsSupportedCurrency(currency) {
			writeError(w, http.StatusBadRequest, "Unsupported currency")
			return
		}
	}

	daysParam := r.URL.Query().Get("days")
	if daysParam == "" {
		daysParam = "30"
	}

	chartDays, err := s.portfolio.ParseDays(r.Context(), portfolioID, daysParam, time.Now().UTC())
	if err != nil {
		slog.Error("parse days failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to load data")
		return
	}

	data, err := s.portfolio.GetPortfolioData(r.Context(), userID, portfolioID, currency, chartDays)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Portfolio not found")
			return
		}
		slog.Error("get portfolio data failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, data)
}
