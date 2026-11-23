package server

import (
	"log/slog"
	"net/http"

	"github.com/gabay/hold/internal/finance"
)

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleCurrencies(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, finance.Currencies)
}

func (s *Server) handleFinanceSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	results, err := s.finance.SearchAssets(r.Context(), query)
	if err != nil {
		slog.Error("finance search failed", "query", query, "error", err)
		writeError(w, http.StatusInternalServerError, "Search failed")
		return
	}
	if results == nil {
		results = []finance.SearchAssetResult{}
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleClearCache(w http.ResponseWriter, r *http.Request) {
	if err := s.finance.ClearCache(r.Context()); err != nil {
		slog.Error("clear cache failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to clear cache")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
