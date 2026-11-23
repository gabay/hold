package portfolio

import (
	"math"
	"sort"
	"time"

	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
)

// PortfolioData represents the full portfolio response matching src/lib/portfolio.ts.
type PortfolioData struct {
	PortfolioID  string           `json:"portfolioId"`
	Name         string           `json:"name"`
	Summary      PortfolioSummary `json:"summary"`
	Transactions []db.Transaction `json:"transactions"`
	History      []ChartDataPoint `json:"history"`
}

// PortfolioSummary holds aggregated portfolio totals and per-asset holdings.
type PortfolioSummary struct {
	Currency              string      `json:"currency"`
	TotalCost             float64     `json:"totalCost"`
	TotalValue            float64     `json:"totalValue"`
	TotalRealized         float64     `json:"totalRealized"`
	TotalProfit           float64     `json:"totalProfit"`
	TotalProfitPercentage float64     `json:"totalProfitPercentage"`
	Assets                []AssetData `json:"assets"`
}

// AssetData holds valuation, cost basis, profit, and chart history for one symbol.
type AssetData struct {
	Symbol           string           `json:"symbol"`
	Currency         string           `json:"currency"`
	Quantity         float64          `json:"quantity"`
	AvgBuyPrice      float64          `json:"avgBuyPrice"`
	CurrentPrice     float64          `json:"currentPrice"`
	Cost             float64          `json:"cost"`
	Value            float64          `json:"value"`
	Realized         float64          `json:"realized"`
	Profit           float64          `json:"profit"`
	ProfitPercentage float64          `json:"profitPercentage"`
	History          []ChartDataPoint `json:"history"`
}

// ChartDataPoint represents a single day's valuation, invested cost, and realized profit.
type ChartDataPoint struct {
	Date      string  `json:"date"`
	Valuation float64 `json:"valuation"`
	Invested  float64 `json:"invested"`
	Realized  float64 `json:"realized"`
}

type dateValue struct {
	date  string
	value float64
}

type timelineEvent struct {
	date     string
	priority int
	apply    func()
}

// AssetDataCalculator precomputes split, dividend, and transaction timelines
// for an asset so quantity, cost, realized profit, and chart points can be
// queried at any date.
type AssetDataCalculator struct {
	transactions   []db.Transaction
	assetInfo      *finance.AssetInfo
	quantityByDate []dateValue
	realizedByDate []dateValue
}

// NewAssetDataCalculator builds a timeline calculator from transactions and asset market data.
func NewAssetDataCalculator(transactions []db.Transaction, assetInfo *finance.AssetInfo) *AssetDataCalculator {
	calc := &AssetDataCalculator{
		transactions: transactions,
		assetInfo:    assetInfo,
	}

	var quantity float64
	var realized float64
	var events []timelineEvent

	if assetInfo != nil {
		for date, multiplier := range assetInfo.Splits {
			m := multiplier
			events = append(events, timelineEvent{
				date:     date,
				priority: 1,
				apply:    func() { quantity *= m },
			})
		}
		for date, amount := range assetInfo.Dividends {
			a := amount
			events = append(events, timelineEvent{
				date:     date,
				priority: 2,
				apply:    func() { realized += a * quantity },
			})
		}
	}

	for _, tx := range transactions {
		t := tx
		events = append(events, timelineEvent{
			date:     finance.DateKey(t.TransactionDate),
			priority: 3,
			apply: func() {
				if t.Type == "BUY" {
					quantity += t.Quantity
				} else {
					quantity -= t.Quantity
				}
			},
		})
	}

	sort.SliceStable(events, func(i, j int) bool {
		if events[i].date != events[j].date {
			return events[i].date < events[j].date
		}
		return events[i].priority < events[j].priority
	})

	for _, ev := range events {
		prevQuantity := quantity
		prevRealized := realized
		ev.apply()
		if quantity != prevQuantity {
			calc.quantityByDate = append(calc.quantityByDate, dateValue{date: ev.date, value: quantity})
		}
		if realized != prevRealized {
			calc.realizedByDate = append(calc.realizedByDate, dateValue{date: ev.date, value: realized})
		}
	}

	return calc
}

// GetQuantity returns the asset quantity held at the end of date (UTC).
func (c *AssetDataCalculator) GetQuantity(date time.Time) float64 {
	if date.IsZero() {
		date = time.Now().UTC()
	}
	target := finance.DateKey(date)
	for i := len(c.quantityByDate) - 1; i >= 0; i-- {
		if c.quantityByDate[i].date <= target {
			return c.quantityByDate[i].value
		}
	}
	return 0
}

// GetRealized returns cumulative realized dividend profit as of date (UTC).
func (c *AssetDataCalculator) GetRealized(date time.Time) float64 {
	if date.IsZero() {
		date = time.Now().UTC()
	}
	target := finance.DateKey(date)
	for i := len(c.realizedByDate) - 1; i >= 0; i-- {
		if c.realizedByDate[i].date <= target {
			return c.realizedByDate[i].value
		}
	}
	return 0
}

// GetCost returns net invested cost basis as of date (UTC).
func (c *AssetDataCalculator) GetCost(date time.Time) float64 {
	if date.IsZero() {
		date = time.Now().UTC()
	}
	target := finance.DateKey(date)
	var cost float64
	for _, tx := range c.transactions {
		if finance.DateKey(tx.TransactionDate) <= target {
			if tx.Type == "SELL" {
				cost -= tx.PricePerShare * tx.Quantity
			} else {
				cost += tx.PricePerShare * tx.Quantity
			}
		}
	}
	return cost
}

// GetChartDataPoint computes the chart point for date.
func (c *AssetDataCalculator) GetChartDataPoint(date time.Time) ChartDataPoint {
	norm := finance.NormalizeDate(date)
	var prices map[string]float64
	if c.assetInfo != nil {
		prices = c.assetInfo.Prices
	}
	price, ok := finance.GetValueAroundDate(prices, norm)
	if !ok {
		price = 0
	}
	return ChartDataPoint{
		Date:      finance.DateKey(norm),
		Valuation: safeFloat(price * c.GetQuantity(norm)),
		Invested:  safeFloat(c.GetCost(norm)),
		Realized:  safeFloat(c.GetRealized(norm)),
	}
}

func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}
