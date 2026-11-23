package finance

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultFrankfurterBaseURL = "https://api.frankfurter.dev"

// FrankfurterClient fetches historical exchange rates from the Frankfurter v2 API.
type FrankfurterClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewFrankfurterClient creates a FrankfurterClient with an optional base URL.
func NewFrankfurterClient(baseURL string) *FrankfurterClient {
	if baseURL == "" {
		baseURL = defaultFrankfurterBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")
	return &FrankfurterClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
	}
}

type frankfurterRateEntry struct {
	Date string  `json:"date"`
	Rate float64 `json:"rate"`
}

// FetchRates retrieves daily exchange rates for base -> target starting at fromDate.
func (c *FrankfurterClient) FetchRates(ctx context.Context, base, target string, fromDate time.Time) (map[string]float64, error) {
	u := fmt.Sprintf("%s/v2/rates?from=%s&base=%s&quotes=%s",
		c.baseURL,
		url.QueryEscape(DateKey(fromDate)),
		url.QueryEscape(base),
		url.QueryEscape(target),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build frankfurter request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("frankfurter request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to fetch rate: %s", resp.Status)
	}

	var entries []frankfurterRateEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, fmt.Errorf("decode frankfurter response: %w", err)
	}

	rates := make(map[string]float64, len(entries))
	for _, e := range entries {
		parsedDate, err := ParseDateKey(e.Date)
		if err != nil {
			continue
		}
		rates[DateKey(parsedDate)] = e.Rate
	}
	return rates, nil
}
