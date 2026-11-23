package finance

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gabay/hold/internal/cache"
	"github.com/gabay/hold/internal/db"
	"golang.org/x/sync/singleflight"
)

// FetchBufferDays is how many days before the latest stored date we re-fetch
// when refreshing incremental market history.
const FetchBufferDays = 2

// AssetInfo holds market metadata, adjusted daily prices, dividends, and splits.
type AssetInfo struct {
	Symbol    string
	Name      string
	Currency  string
	Price     float64
	FromDate  time.Time
	Prices    map[string]float64
	Dividends map[string]float64
	Splits    map[string]float64
}

// ExchangeRates holds daily exchange rates for BaseCurrency -> TargetCurrency.
type ExchangeRates struct {
	BaseCurrency   string
	TargetCurrency string
	FromDate       time.Time
	Rates          map[string]float64
}

// Service coordinates market data fetching, SQLite caching, and in-memory TTL caching.
type Service struct {
	store       *db.Store
	yahoo       *YahooClient
	frankfurter *FrankfurterClient
	assetCache  *cache.Cache[*AssetInfo]
	rateCache   *cache.Cache[*ExchangeRates]
	sf          singleflight.Group
	now         func() time.Time
}

// NewService creates a finance Service backed by store and the provided HTTP clients.
func NewService(store *db.Store, yahoo *YahooClient, frankfurter *FrankfurterClient) *Service {
	if yahoo == nil {
		yahoo = NewYahooClient("")
	}
	if frankfurter == nil {
		frankfurter = NewFrankfurterClient("")
	}
	return &Service{
		store:       store,
		yahoo:       yahoo,
		frankfurter: frankfurter,
		assetCache:  cache.New[*AssetInfo](cache.DefaultTTL),
		rateCache:   cache.New[*ExchangeRates](cache.DefaultTTL),
		now:         time.Now,
	}
}

func bufferedFetchStart(fromDate time.Time, latestStored string, hasLatest bool) time.Time {
	fromNorm := NormalizeDate(fromDate)
	if !hasLatest || latestStored == "" {
		return fromNorm
	}
	latestTime, err := ParseDateKey(latestStored)
	if err != nil {
		return fromNorm
	}
	buffered := AddDays(latestTime, -FetchBufferDays)
	if buffered.After(fromNorm) {
		return buffered
	}
	return fromNorm
}

func mergeFloatMaps(base, overrides map[string]float64) map[string]float64 {
	merged := make(map[string]float64, len(base)+len(overrides))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range overrides {
		merged[k] = v
	}
	return merged
}

// AdjustPreSplitPrices multiplies each historical price by the product of all
// split ratios occurring strictly after that price's date (date < splitDate).
func AdjustPreSplitPrices(prices, splits map[string]float64) map[string]float64 {
	adjusted := make(map[string]float64, len(prices))
	if len(splits) == 0 {
		for k, v := range prices {
			adjusted[k] = v
		}
		return adjusted
	}
	for date, price := range prices {
		multiplier := 1.0
		for splitDate, ratio := range splits {
			if date < splitDate {
				multiplier *= ratio
			}
		}
		adjusted[date] = price * multiplier
	}
	return adjusted
}

// GetAssetInfo fetches asset metadata and split-adjusted daily prices from fromDate,
// optionally converted into targetCurrency.
func (s *Service) GetAssetInfo(ctx context.Context, symbol string, fromDate time.Time, targetCurrency string) (*AssetInfo, error) {
	upperSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	fromNorm := NormalizeDate(fromDate)
	cacheKey := "asset-" + upperSymbol

	if cached, ok := s.assetCache.Get(cacheKey); ok && !cached.FromDate.After(fromNorm) {
		return s.convertAssetInfoCurrency(ctx, cached, targetCurrency)
	}

	sfKey := cacheKey + ":" + DateKey(fromNorm)
	val, err, _ := s.sf.Do(sfKey, func() (any, error) {
		if cached, ok := s.assetCache.Get(cacheKey); ok && !cached.FromDate.After(fromNorm) {
			return cached, nil
		}

		fromKey := DateKey(fromNorm)
		existingRows, err := s.store.GetStockPrices(ctx, upperSymbol, fromKey)
		if err != nil {
			return nil, fmt.Errorf("get cached stock prices: %w", err)
		}
		latestDate, hasLatest, err := s.store.GetLatestStockPriceDate(ctx, upperSymbol)
		if err != nil {
			return nil, fmt.Errorf("get latest stock price date: %w", err)
		}

		fetchStart := bufferedFetchStart(fromNorm, latestDate, hasLatest)
		chart, err := s.yahoo.FetchChart(ctx, upperSymbol, fetchStart, s.now().UTC())
		if err != nil {
			return nil, err
		}

		// Persist raw (unadjusted) prices for the freshly fetched days.
		dates := make([]string, 0, len(chart.Prices))
		for d := range chart.Prices {
			dates = append(dates, d)
		}
		sort.Strings(dates)

		rowsToUpsert := make([]db.StockPriceRow, 0, len(dates))
		for _, d := range dates {
			row := db.StockPriceRow{
				Symbol: upperSymbol,
				Date:   d,
				Price:  chart.Prices[d],
			}
			if div, ok := chart.Dividends[d]; ok {
				v := div
				row.Dividend = &v
			}
			if spl, ok := chart.Splits[d]; ok {
				v := spl
				row.Split = &v
			}
			rowsToUpsert = append(rowsToUpsert, row)
		}
		if err := s.store.UpsertStockPrices(ctx, upperSymbol, rowsToUpsert); err != nil {
			return nil, fmt.Errorf("upsert stock prices: %w", err)
		}

		dbPrices := make(map[string]float64, len(existingRows))
		dbSplits := make(map[string]float64)
		dbDividends := make(map[string]float64)
		for _, r := range existingRows {
			dbPrices[r.Date] = r.Price
			if r.Split != nil {
				dbSplits[r.Date] = *r.Split
			}
			if r.Dividend != nil {
				dbDividends[r.Date] = *r.Dividend
			}
		}

		prices := mergeFloatMaps(dbPrices, chart.Prices)
		splits := mergeFloatMaps(dbSplits, chart.Splits)
		dividends := mergeFloatMaps(dbDividends, chart.Dividends)

		info := &AssetInfo{
			Symbol:    chart.Symbol,
			Name:      chart.Name,
			Currency:  chart.Currency,
			Price:     chart.Price,
			FromDate:  fromNorm,
			Prices:    AdjustPreSplitPrices(prices, splits),
			Dividends: dividends,
			Splits:    splits,
		}
		s.assetCache.Set(cacheKey, info)
		return info, nil
	})
	if err != nil {
		return nil, err
	}

	return s.convertAssetInfoCurrency(ctx, val.(*AssetInfo), targetCurrency)
}

func (s *Service) convertAssetInfoCurrency(ctx context.Context, info *AssetInfo, targetCurrency string) (*AssetInfo, error) {
	target := strings.ToUpper(strings.TrimSpace(targetCurrency))
	if target == "" || info.Currency == target {
		return info, nil
	}

	rates, err := s.GetExchangeRates(ctx, info.Currency, target, info.FromDate)
	if err != nil {
		return nil, err
	}
	currentRate, err := s.GetExchangeRate(ctx, info.Currency, target, NormalizeDate(s.now().UTC()))
	if err != nil {
		return nil, err
	}

	convertedPrices := make(map[string]float64, len(info.Prices))
	for date, price := range info.Prices {
		r := 1.0
		if rates != nil {
			if v, ok := rates.Rates[date]; ok && v != 0 {
				r = v
			}
		}
		convertedPrices[date] = price * r
	}

	var convertedDividends map[string]float64
	if info.Dividends != nil {
		convertedDividends = make(map[string]float64, len(info.Dividends))
		for date, amount := range info.Dividends {
			r := 1.0
			if rates != nil {
				if v, ok := rates.Rates[date]; ok && v != 0 {
					r = v
				}
			}
			convertedDividends[date] = amount * r
		}
	}

	return &AssetInfo{
		Symbol:    info.Symbol,
		Name:      info.Name,
		Currency:  target,
		Price:     info.Price * currentRate,
		FromDate:  info.FromDate,
		Prices:    convertedPrices,
		Dividends: convertedDividends,
		Splits:    info.Splits,
	}, nil
}

func canonicalPair(currencyA, currencyB string) (base, target string, flipped bool) {
	if currencyA <= currencyB {
		return currencyA, currencyB, false
	}
	return currencyB, currencyA, true
}

func reverseExchangeRates(er *ExchangeRates) *ExchangeRates {
	rev := make(map[string]float64, len(er.Rates))
	for date, rate := range er.Rates {
		if rate != 0 {
			rev[date] = 1.0 / rate
		}
	}
	return &ExchangeRates{
		BaseCurrency:   er.TargetCurrency,
		TargetCurrency: er.BaseCurrency,
		FromDate:       er.FromDate,
		Rates:          rev,
	}
}

// GetExchangeRates returns daily exchange rates for baseCurrency -> targetCurrency
// starting at fromDate. Returns (nil, nil) when baseCurrency == targetCurrency.
func (s *Service) GetExchangeRates(ctx context.Context, baseCurrency, targetCurrency string, fromDate time.Time) (*ExchangeRates, error) {
	baseIn := strings.ToUpper(strings.TrimSpace(baseCurrency))
	targetIn := strings.ToUpper(strings.TrimSpace(targetCurrency))
	if baseIn == targetIn {
		return nil, nil
	}

	base, target, flipped := canonicalPair(baseIn, targetIn)
	fromNorm := NormalizeDate(fromDate)
	cacheKey := "xrate-" + base + "-" + target

	if cached, ok := s.rateCache.Get(cacheKey); ok && !cached.FromDate.After(fromNorm) {
		if flipped {
			return reverseExchangeRates(cached), nil
		}
		return cached, nil
	}

	sfKey := cacheKey + ":" + DateKey(fromNorm)
	val, err, _ := s.sf.Do(sfKey, func() (any, error) {
		if cached, ok := s.rateCache.Get(cacheKey); ok && !cached.FromDate.After(fromNorm) {
			return cached, nil
		}

		fromKey := DateKey(fromNorm)
		existingRows, err := s.store.GetExchangeRates(ctx, base, target, fromKey)
		if err != nil {
			return nil, fmt.Errorf("get cached exchange rates: %w", err)
		}
		latestDate, hasLatest, err := s.store.GetLatestExchangeRateDate(ctx, base, target)
		if err != nil {
			return nil, fmt.Errorf("get latest exchange rate date: %w", err)
		}

		fetchStart := bufferedFetchStart(fromNorm, latestDate, hasLatest)
		freshRates, err := s.frankfurter.FetchRates(ctx, base, target, fetchStart)
		if err != nil {
			return nil, err
		}

		dates := make([]string, 0, len(freshRates))
		for d := range freshRates {
			dates = append(dates, d)
		}
		sort.Strings(dates)

		rowsToUpsert := make([]db.ExchangeRateRow, 0, len(dates))
		for _, d := range dates {
			rowsToUpsert = append(rowsToUpsert, db.ExchangeRateRow{
				BaseCurrency:   base,
				TargetCurrency: target,
				Date:           d,
				Rate:           freshRates[d],
			})
		}
		if err := s.store.UpsertExchangeRates(ctx, base, target, rowsToUpsert); err != nil {
			return nil, fmt.Errorf("upsert exchange rates: %w", err)
		}

		dbRates := make(map[string]float64, len(existingRows))
		for _, r := range existingRows {
			dbRates[r.Date] = r.Rate
		}

		canonical := &ExchangeRates{
			BaseCurrency:   base,
			TargetCurrency: target,
			FromDate:       fromNorm,
			Rates:          mergeFloatMaps(dbRates, freshRates),
		}
		s.rateCache.Set(cacheKey, canonical)
		return canonical, nil
	})
	if err != nil {
		return nil, err
	}

	canonical := val.(*ExchangeRates)
	if flipped {
		return reverseExchangeRates(canonical), nil
	}
	return canonical, nil
}

// GetExchangeRate returns the exchange rate for baseCurrency -> targetCurrency on date,
// using GetValueAroundDate fallback.
func (s *Service) GetExchangeRate(ctx context.Context, baseCurrency, targetCurrency string, date time.Time) (float64, error) {
	if strings.EqualFold(strings.TrimSpace(baseCurrency), strings.TrimSpace(targetCurrency)) {
		return 1, nil
	}
	rates, err := s.GetExchangeRates(ctx, baseCurrency, targetCurrency, date)
	if err != nil {
		return 0, err
	}
	var rateMap map[string]float64
	if rates != nil {
		rateMap = rates.Rates
	}
	rate, ok := GetValueAroundDate(rateMap, date)
	if !ok {
		return 0, fmt.Errorf("no exchange rate for %s -> %s on %s", baseCurrency, targetCurrency, DateKey(date))
	}
	return rate, nil
}

// ConvertCurrency converts amount from base to target currency on date.
func (s *Service) ConvertCurrency(ctx context.Context, amount float64, base, target string, date time.Time) (float64, error) {
	if strings.EqualFold(strings.TrimSpace(base), strings.TrimSpace(target)) {
		return amount, nil
	}
	rate, err := s.GetExchangeRate(ctx, base, target, date)
	if err != nil {
		return 0, err
	}
	return amount * rate, nil
}

// SearchAssets searches Yahoo Finance for matching symbols.
// Returns an empty slice when trimmed query is shorter than 2 characters.
func (s *Service) SearchAssets(ctx context.Context, query string) ([]SearchAssetResult, error) {
	if len(strings.TrimSpace(query)) < 2 {
		return []SearchAssetResult{}, nil
	}
	return s.yahoo.Search(ctx, query)
}

// ClearCache clears both SQLite market cache tables and both in-memory TTL caches.
func (s *Service) ClearCache(ctx context.Context) error {
	if err := s.store.ClearMarketCache(ctx); err != nil {
		return err
	}
	s.assetCache.Flush()
	s.rateCache.Flush()
	return nil
}
