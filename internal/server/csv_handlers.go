package server

import (
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
)

const maxCSVImportBytes = 10 << 20 // 10 MB

func (s *Server) handleExportCSV(w http.ResponseWriter, r *http.Request) {
	_, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	txs, err := s.store.ListTransactions(r.Context(), portfolioID, true)
	if err != nil {
		slog.Error("export csv list transactions failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to export transactions")
		return
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="portfolio_export_%s.csv"`, portfolioID))
	w.WriteHeader(http.StatusOK)

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"symbol", "type", "quantity", "pricePerShare", "currency", "transactionDate"})
	for _, tx := range txs {
		_ = cw.Write([]string{
			tx.Symbol,
			tx.Type,
			strconv.FormatFloat(tx.Quantity, 'f', -1, 64),
			strconv.FormatFloat(tx.PricePerShare, 'f', -1, 64),
			tx.Currency,
			tx.TransactionDate.UTC().Format(time.RFC3339),
		})
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		slog.Error("export csv flush failed", "portfolio_id", portfolioID, "error", err)
	}
}

func (s *Server) handleImportCSV(w http.ResponseWriter, r *http.Request) {
	_, portfolioID, ok := s.requirePortfolio(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxCSVImportBytes)
	if err := r.ParseMultipartForm(maxCSVImportBytes); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid multipart form or file exceeds 10 MB limit")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "No file provided")
		return
	}
	defer file.Close()

	cr := csv.NewReader(file)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true

	var records [][]string
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid CSV format: %v", err))
			return
		}
		if isEmptyCSVRow(rec) {
			continue
		}
		records = append(records, rec)
	}

	if len(records) <= 1 {
		writeError(w, http.StatusBadRequest, "Empty CSV file")
		return
	}

	headers := make([]string, len(records[0]))
	for i, h := range records[0] {
		h = strings.TrimPrefix(h, "\ufeff")
		headers[i] = strings.ToLower(strings.TrimSpace(h))
	}

	symbolIdx := indexOf(headers, "symbol")
	typeIdx := indexOf(headers, "type")
	quantityIdx := indexOf(headers, "quantity")
	priceIdx := indexOf(headers, "pricepershare")
	if priceIdx == -1 {
		priceIdx = indexOf(headers, "price")
	}
	currencyIdx := indexOf(headers, "currency")
	dateIdx := indexOf(headers, "transactiondate")
	if dateIdx == -1 {
		dateIdx = indexOf(headers, "date")
	}

	if symbolIdx == -1 || typeIdx == -1 || quantityIdx == -1 || priceIdx == -1 {
		writeError(w, http.StatusBadRequest, "Required columns missing. Expected header containing at least: symbol, type, quantity, pricePerShare")
		return
	}

	newTransactions := make([]db.Transaction, 0, len(records)-1)
	today := finance.NormalizeDate(time.Now().UTC())

	for i, row := range records[1:] {
		rowNum := i + 2
		symbol := strings.ToUpper(cellAt(row, symbolIdx))
		txType := strings.ToUpper(cellAt(row, typeIdx))
		qtyStr := cellAt(row, quantityIdx)
		priceStr := cellAt(row, priceIdx)

		if symbol == "" || (txType != "BUY" && txType != "SELL") {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid numeric or action data at row %d", rowNum))
			return
		}

		qty, err := strconv.ParseFloat(qtyStr, 64)
		if err != nil || math.IsNaN(qty) || math.IsInf(qty, 0) || qty <= 0 {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid numeric or action data at row %d", rowNum))
			return
		}

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || math.IsNaN(price) || math.IsInf(price, 0) || price < 0 {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid numeric or action data at row %d", rowNum))
			return
		}

		curr := strings.ToUpper(cellAt(row, currencyIdx))
		if curr != "" && !finance.IsSupportedCurrency(curr) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Unsupported currency %q at row %d", curr, rowNum))
			return
		}

		txDate := today
		if rawDate := cellAt(row, dateIdx); rawDate != "" {
			parsed, err := parseTransactionDate(rawDate)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("Invalid date %q at row %d", rawDate, rowNum))
				return
			}
			txDate = parsed
		}

		newTransactions = append(newTransactions, db.Transaction{
			PortfolioID:     portfolioID,
			Symbol:          symbol,
			Type:            txType,
			Quantity:        qty,
			PricePerShare:   price,
			Currency:        curr,
			TransactionDate: txDate,
		})
	}

	if err := s.store.CreateTransactionsBatch(r.Context(), newTransactions); err != nil {
		slog.Error("import csv batch insert failed", "portfolio_id", portfolioID, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to import transactions")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"count":   len(newTransactions),
	})
}

func isEmptyCSVRow(row []string) bool {
	for _, cell := range row {
		if strings.TrimSpace(cell) != "" {
			return false
		}
	}
	return true
}

func indexOf(slice []string, target string) int {
	for i, v := range slice {
		if v == target {
			return i
		}
	}
	return -1
}

func cellAt(row []string, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}
