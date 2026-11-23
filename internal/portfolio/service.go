package portfolio

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
	"golang.org/x/sync/errgroup"
)

const maxSymbolConcurrency = 8

// Service computes portfolio valuations, summaries, and historical chart series.
type Service struct {
	store   *db.Store
	finance *finance.Service
}

// NewService creates a portfolio Service.
func NewService(store *db.Store, fin *finance.Service) *Service {
	return &Service{
		store:   store,
		finance: fin,
	}
}

// ParseDays converts a days query parameter ("ytd", "max", or positive integer, default 30)
// into an ascending slice of UTC midnight dates ending on now.
func (s *Service) ParseDays(ctx context.Context, portfolioID, daysParam string, now time.Time) ([]time.Time, error) {
	end := finance.NormalizeDate(now)

	switch daysParam {
	case "ytd":
		start := time.Date(end.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		return finance.ExpandDays(start, end), nil
	case "max":
		firstDate, ok, err := s.store.GetFirstTransactionDate(ctx, portfolioID)
		if err != nil {
			return nil, err
		}
		if ok {
			start := finance.AddDays(firstDate, -1)
			return finance.ExpandDays(start, end), nil
		}
	}

	daysNumber, err := strconv.Atoi(daysParam)
	if err != nil || daysNumber <= 0 {
		daysNumber = 30
	}
	start := finance.AddDays(end, -daysNumber)
	return finance.ExpandDays(start, end), nil
}

// GetPortfolioData loads the portfolio and computes holdings, totals, and chart history.
func (s *Service) GetPortfolioData(ctx context.Context, userID, portfolioID, currency string, chartDays []time.Time) (*PortfolioData, error) {
	if strings.TrimSpace(currency) == "" {
		currency = "USD"
	} else {
		currency = strings.ToUpper(strings.TrimSpace(currency))
	}

	p, err := s.store.GetPortfolio(ctx, portfolioID, userID)
	if err != nil {
		return nil, err
	}

	transactions, err := s.store.ListTransactions(ctx, portfolioID, true)
	if err != nil {
		return nil, err
	}

	// Group transactions by symbol preserving order of first appearance.
	var symbols []string
	bySymbol := make(map[string][]db.Transaction)
	for _, tx := range transactions {
		if _, exists := bySymbol[tx.Symbol]; !exists {
			symbols = append(symbols, tx.Symbol)
		}
		bySymbol[tx.Symbol] = append(bySymbol[tx.Symbol], tx)
	}

	assets := make([]AssetData, len(symbols))
	if len(symbols) > 0 {
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(maxSymbolConcurrency)

		for i, sym := range symbols {
			idx := i
			symbol := sym
			symbolTxs := bySymbol[symbol]
			g.Go(func() error {
				asset, err := s.getAssetData(gctx, symbol, symbolTxs, currency, chartDays)
				if err != nil {
					return err
				}
				assets[idx] = asset
				return nil
			})
		}
		if err := g.Wait(); err != nil {
			return nil, err
		}
	}

	var totalCost, totalValue, totalRealized float64
	for _, a := range assets {
		totalCost += a.Cost
		totalValue += a.Value
		totalRealized += a.Realized
	}
	totalProfit := safeFloat(totalValue + totalRealized - totalCost)
	totalProfitPercentage := 0.0
	if totalCost > 0 {
		totalProfitPercentage = safeFloat((totalProfit / totalCost) * 100)
	}

	// Reverse transactions (newest first) matching src/lib/portfolio.ts.
	reversedTxs := make([]db.Transaction, len(transactions))
	for i, tx := range transactions {
		reversedTxs[len(transactions)-1-i] = tx
	}

	return &PortfolioData{
		PortfolioID: portfolioID,
		Name:        p.Name,
		Summary: PortfolioSummary{
			Currency:              currency,
			TotalCost:             safeFloat(totalCost),
			TotalValue:            safeFloat(totalValue),
			TotalRealized:         safeFloat(totalRealized),
			TotalProfit:           totalProfit,
			TotalProfitPercentage: totalProfitPercentage,
			Assets:                assets,
		},
		Transactions: reversedTxs,
		History:      aggregateChartData(chartDays, assets),
	}, nil
}

func (s *Service) getAssetData(ctx context.Context, symbol string, transactions []db.Transaction, currency string, chartDays []time.Time) (AssetData, error) {
	firstTxDate := finance.NormalizeDate(transactions[0].TransactionDate)
	for _, tx := range transactions[1:] {
		d := finance.NormalizeDate(tx.TransactionDate)
		if d.Before(firstTxDate) {
			firstTxDate = d
		}
	}

	assetInfo, err := s.finance.GetAssetInfo(ctx, symbol, firstTxDate, currency)
	if err != nil {
		return AssetData{}, err
	}

	convertedTxs, err := s.convertTransactionsCurrency(ctx, transactions, currency)
	if err != nil {
		return AssetData{}, err
	}

	now := time.Now().UTC()
	calc := NewAssetDataCalculator(convertedTxs, assetInfo)
	quantity := safeFloat(calc.GetQuantity(now))
	realized := safeFloat(calc.GetRealized(now))
	value := safeFloat(quantity * assetInfo.Price)
	cost := safeFloat(calc.GetCost(now))
	profit := safeFloat(value + realized - cost)

	profitPercentage := 0.0
	if cost > 0 {
		profitPercentage = safeFloat((profit / cost) * 100)
	}

	avgBuyPrice := 0.0
	if quantity != 0 {
		avgBuyPrice = safeFloat(cost / quantity)
	}

	history := make([]ChartDataPoint, len(chartDays))
	for i, day := range chartDays {
		history[i] = calc.GetChartDataPoint(day)
	}

	return AssetData{
		Symbol:           symbol,
		Currency:         currency,
		Quantity:         quantity,
		AvgBuyPrice:      avgBuyPrice,
		CurrentPrice:     safeFloat(assetInfo.Price),
		Cost:             cost,
		Value:            value,
		Realized:         realized,
		Profit:           profit,
		ProfitPercentage: profitPercentage,
		History:          history,
	}, nil
}

func (s *Service) convertTransactionsCurrency(ctx context.Context, transactions []db.Transaction, currency string) ([]db.Transaction, error) {
	converted := make([]db.Transaction, len(transactions))
	for i, tx := range transactions {
		converted[i] = tx
		if strings.EqualFold(tx.Currency, currency) {
			continue
		}
		rate, err := s.finance.GetExchangeRate(ctx, tx.Currency, currency, tx.TransactionDate)
		if err != nil {
			return nil, err
		}
		converted[i].PricePerShare = tx.PricePerShare * rate
		converted[i].Currency = currency
	}
	return converted, nil
}

func aggregateChartData(chartDays []time.Time, assets []AssetData) []ChartDataPoint {
	chartData := make([]ChartDataPoint, len(chartDays))
	for i, day := range chartDays {
		point := ChartDataPoint{
			Date: finance.DateKey(day),
		}
		for _, asset := range assets {
			if i < len(asset.History) {
				point.Valuation += asset.History[i].Valuation
				point.Invested += asset.History[i].Invested
				point.Realized += asset.History[i].Realized
			}
		}
		point.Valuation = safeFloat(point.Valuation)
		point.Invested = safeFloat(point.Invested)
		point.Realized = safeFloat(point.Realized)
		chartData[i] = point
	}
	return chartData
}
