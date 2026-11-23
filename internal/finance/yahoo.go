package finance

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultYahooBaseURL   = "https://query1.finance.yahoo.com"
	defaultYahooUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
	defaultHTTPTimeout    = 15 * time.Second
)

// YahooChartResult holds parsed chart metadata, daily closes, dividends, and splits.
type YahooChartResult struct {
	Symbol    string
	Name      string
	Currency  string
	Price     float64
	Prices    map[string]float64
	Dividends map[string]float64
	Splits    map[string]float64
}

// SearchAssetResult represents a single asset search result.
type SearchAssetResult struct {
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

// YahooClient fetches market data and symbol search results from Yahoo Finance.
type YahooClient struct {
	baseURL    string
	userAgent  string
	httpClient *http.Client
}

// NewYahooClient creates a YahooClient with an optional base URL (defaults to Yahoo Finance).
func NewYahooClient(baseURL string) *YahooClient {
	if baseURL == "" {
		baseURL = defaultYahooBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")
	return &YahooClient{
		baseURL:    baseURL,
		userAgent:  defaultYahooUserAgent,
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
	}
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Symbol             string  `json:"symbol"`
				ShortName          string  `json:"shortName"`
				LongName           string  `json:"longName"`
				Currency           string  `json:"currency"`
				RegularMarketPrice float64 `json:"regularMarketPrice"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Close []*float64 `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
			Events *struct {
				Dividends map[string]struct {
					Amount float64 `json:"amount"`
					Date   int64   `json:"date"`
				} `json:"dividends"`
				Splits map[string]struct {
					Date        int64   `json:"date"`
					Numerator   float64 `json:"numerator"`
					Denominator float64 `json:"denominator"`
				} `json:"splits"`
			} `json:"events"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

// FetchChart retrieves daily historical prices, dividends, and splits for symbol.
func (c *YahooClient) FetchChart(ctx context.Context, symbol string, period1, period2 time.Time) (*YahooChartResult, error) {
	u := fmt.Sprintf("%s/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=div,split",
		c.baseURL,
		url.PathEscape(symbol),
		NormalizeDate(period1).Unix(),
		period2.UTC().Unix(),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build yahoo chart request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("yahoo chart request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("yahoo chart status %d: %s", resp.StatusCode, resp.Status)
	}

	var parsed yahooChartResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode yahoo chart response: %w", err)
	}
	if parsed.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo chart error (%s): %s", parsed.Chart.Error.Code, parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}

	r := parsed.Chart.Result[0]
	metaSymbol := r.Meta.Symbol
	if metaSymbol == "" {
		metaSymbol = symbol
	}
	name := r.Meta.ShortName
	if name == "" {
		name = r.Meta.LongName
	}
	if name == "" {
		name = metaSymbol
	}
	currency := strings.ToUpper(strings.TrimSpace(r.Meta.Currency))
	if currency == "" {
		currency = "USD"
	}

	prices := make(map[string]float64)
	if len(r.Indicators.Quote) > 0 {
		closes := r.Indicators.Quote[0].Close
		for i, ts := range r.Timestamp {
			if i >= len(closes) || closes[i] == nil {
				continue
			}
			key := DateKey(time.Unix(ts, 0).UTC())
			prices[key] = *closes[i]
		}
	}

	dividends := make(map[string]float64)
	splits := make(map[string]float64)
	if r.Events != nil {
		for k, d := range r.Events.Dividends {
			ts := d.Date
			if ts == 0 {
				if parsedTS, err := strconv.ParseInt(k, 10, 64); err == nil {
					ts = parsedTS
				}
			}
			key := DateKey(time.Unix(ts, 0).UTC())
			dividends[key] = d.Amount
		}
		for k, s := range r.Events.Splits {
			if s.Denominator == 0 {
				continue
			}
			ts := s.Date
			if ts == 0 {
				if parsedTS, err := strconv.ParseInt(k, 10, 64); err == nil {
					ts = parsedTS
				}
			}
			key := DateKey(time.Unix(ts, 0).UTC())
			splits[key] = s.Numerator / s.Denominator
		}
	}

	return &YahooChartResult{
		Symbol:    metaSymbol,
		Name:      name,
		Currency:  currency,
		Price:     r.Meta.RegularMarketPrice,
		Prices:    prices,
		Dividends: dividends,
		Splits:    splits,
	}, nil
}

type yahooSearchResponse struct {
	Quotes []struct {
		Symbol    string `json:"symbol"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		QuoteType string `json:"quoteType"`
	} `json:"quotes"`
}

// Search queries Yahoo Finance for EQUITY, ETF, and MUTUALFUND symbols matching query.
func (c *YahooClient) Search(ctx context.Context, query string) ([]SearchAssetResult, error) {
	u := fmt.Sprintf("%s/v1/finance/search?q=%s", c.baseURL, url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build yahoo search request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("yahoo search request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("yahoo search status %d: %s", resp.StatusCode, resp.Status)
	}

	var parsed yahooSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode yahoo search response: %w", err)
	}

	out := []SearchAssetResult{}
	for _, q := range parsed.Quotes {
		if q.Symbol == "" {
			continue
		}
		switch q.QuoteType {
		case "EQUITY", "ETF", "MUTUALFUND":
		default:
			continue
		}
		name := q.ShortName
		if name == "" {
			name = q.LongName
		}
		if name == "" {
			name = q.Symbol
		}
		out = append(out, SearchAssetResult{
			Symbol: q.Symbol,
			Name:   name,
			Type:   q.QuoteType,
		})
	}
	return out, nil
}
