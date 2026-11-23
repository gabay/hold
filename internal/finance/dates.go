package finance

import "time"

var valueAroundDateOffsets = [...]int{0, -1, -2, -3, -4, 1, 2}

// NormalizeDate truncates t to UTC midnight.
func NormalizeDate(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

// DateKey formats t in UTC as YYYY-MM-DD.
func DateKey(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// ParseDateKey parses a YYYY-MM-DD string into a UTC midnight time.Time.
func ParseDateKey(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

// AddDays returns t normalized to UTC midnight plus the given number of days.
func AddDays(t time.Time, days int) time.Time {
	return NormalizeDate(t).AddDate(0, 0, days)
}

// ExpandDays returns an inclusive slice of UTC midnight dates from start to end.
func ExpandDays(start, end time.Time) []time.Time {
	cur := NormalizeDate(start)
	endNorm := NormalizeDate(end)
	dates := []time.Time{}
	for !cur.After(endNorm) {
		dates = append(dates, cur)
		cur = cur.AddDate(0, 0, 1)
	}
	return dates
}

// GetValueAroundDate looks up a value at date, falling back up to 4 days back, then 2 days forward.
// Checks day offsets [0, -1, -2, -3, -4, 1, 2] in that exact order.
func GetValueAroundDate(values map[string]float64, date time.Time) (float64, bool) {
	if values == nil {
		return 0, false
	}
	base := NormalizeDate(date)
	for _, delta := range valueAroundDateOffsets {
		if v, ok := values[DateKey(AddDays(base, delta))]; ok {
			return v, true
		}
	}
	return 0, false
}
