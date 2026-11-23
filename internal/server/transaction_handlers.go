package server

import (
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
)

type transactionPayload struct {
	Symbol          string  `json:"symbol"`
	Type            string  `json:"type"`
	Quantity        float64 `json:"quantity"`
	PricePerShare   float64 `json:"pricePerShare"`
	Currency        string  `json:"currency"`
	TransactionDate string  `json:"transactionDate"`
}

func parseTransactionDate(raw string) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return finance.NormalizeDate(time.Now().UTC()), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return finance.NormalizeDate(t), nil
	}
	if t, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return finance.NormalizeDate(t), nil
	}
	if t, err := time.Parse("2006-01-02", trimmed); err == nil {
		return finance.NormalizeDate(t), nil
	}
	return time.Time{}, fmt.Errorf("invalid transactionDate %q", raw)
}

func (s *Server) validateTransactionPayload(r *http.Request) (db.Transaction, int, string) {
	var req transactionPayload
	if err := decodeJSON(r, &req); err != nil {
		return db.Transaction{}, http.StatusBadRequest, "Invalid request payload"
	}

	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	txType := strings.ToUpper(strings.TrimSpace(req.Type))

	if symbol == "" || txType == "" {
		return db.Transaction{}, http.StatusBadRequest, "Missing required fields"
	}
	if txType != "BUY" && txType != "SELL" {
		return db.Transaction{}, http.StatusBadRequest, "Invalid type. Must be BUY or SELL."
	}
	if math.IsNaN(req.Quantity) || math.IsInf(req.Quantity, 0) || req.Quantity <= 0 {
		return db.Transaction{}, http.StatusBadRequest, "Quantity must be greater than 0"
	}
	if math.IsNaN(req.PricePerShare) || math.IsInf(req.PricePerShare, 0) || req.PricePerShare < 0 {
		return db.Transaction{}, http.StatusBadRequest, "Price per share must be 0 or greater"
	}

	curr := strings.ToUpper(strings.TrimSpace(req.Currency))
	if curr != "" && !finance.IsSupportedCurrency(curr) {
		return db.Transaction{}, http.StatusBadRequest, fmt.Sprintf("Unsupported currency %q", curr)
	}

	txDate, err := parseTransactionDate(req.TransactionDate)
	if err != nil {
		return db.Transaction{}, http.StatusBadRequest, err.Error()
	}

	assetInfo, err := s.finance.GetAssetInfo(r.Context(), symbol, time.Now().UTC(), "")
	if err != nil {
		return db.Transaction{}, http.StatusBadRequest, fmt.Sprintf("Could not validate ticker symbol %q. Is it correct?", symbol)
	}
	if curr == "" {
		curr = assetInfo.Currency
	}

	return db.Transaction{
		Symbol:          symbol,
		Type:            txType,
		Quantity:        req.Quantity,
		PricePerShare:   req.PricePerShare,
		Currency:        curr,
		TransactionDate: txDate,
	}, 0, ""
}

func (s *Server) handleListTransactions(w http.ResponseWriter, r *http.Request) {
	_, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	txs, err := s.store.ListTransactions(r.Context(), portfolioID, false)
	if err != nil {
		slog.Error("list transactions failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to load transactions")
		return
	}

	symbolCurrency := make(map[string]string)
	now := time.Now().UTC()
	for i := range txs {
		if txs[i].Currency != "" {
			continue
		}
		sym := strings.ToUpper(txs[i].Symbol)
		curr, cached := symbolCurrency[sym]
		if !cached {
			info, err := s.finance.GetAssetInfo(r.Context(), sym, now, "")
			if err != nil {
				slog.Error("resolve transaction currency failed", "symbol", sym, "error", err)
				writeError(w, http.StatusInternalServerError, "Failed to resolve transaction currency")
				return
			}
			curr = info.Currency
			symbolCurrency[sym] = curr
		}
		txs[i].Currency = curr
	}

	if txs == nil {
		txs = []db.Transaction{}
	}
	writeJSON(w, http.StatusOK, txs)
}

func (s *Server) handleCreateTransaction(w http.ResponseWriter, r *http.Request) {
	_, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	tx, errStatus, errMsg := s.validateTransactionPayload(r)
	if errStatus != 0 {
		writeError(w, errStatus, errMsg)
		return
	}
	tx.PortfolioID = portfolioID

	created, err := s.store.CreateTransaction(r.Context(), tx)
	if err != nil {
		slog.Error("create transaction failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to create transaction")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleDeleteAllTransactions(w http.ResponseWriter, r *http.Request) {
	userID, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	if err := s.store.DeleteAllTransactions(r.Context(), userID, portfolioID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Portfolio not found")
			return
		}
		slog.Error("delete all transactions failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to clear transactions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) handleUpdateTransaction(w http.ResponseWriter, r *http.Request) {
	userID, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	txID := r.PathValue("txid")
	tx, errStatus, errMsg := s.validateTransactionPayload(r)
	if errStatus != 0 {
		writeError(w, errStatus, errMsg)
		return
	}
	tx.ID = txID
	tx.PortfolioID = portfolioID

	updated, err := s.store.UpdateTransaction(r.Context(), userID, tx)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Transaction not found")
			return
		}
		slog.Error("update transaction failed", "portfolio_id", portfolioID, "tx_id", txID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to update transaction")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteTransaction(w http.ResponseWriter, r *http.Request) {
	userID, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	txID := r.PathValue("txid")
	if err := s.store.DeleteTransaction(r.Context(), userID, portfolioID, txID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Transaction not found")
			return
		}
		slog.Error("delete transaction failed", "portfolio_id", portfolioID, "tx_id", txID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to delete transaction")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
