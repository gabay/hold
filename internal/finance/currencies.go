package finance

import "strings"

// Currency describes a supported display/transaction currency.
type Currency struct {
	Code   string `json:"code"`
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
}

// Currencies contains the 30 supported currencies matching src/lib/currencies.ts.
var Currencies = map[string]Currency{
	"USD": {Code: "USD", Symbol: "$", Name: "United States Dollar"},
	"EUR": {Code: "EUR", Symbol: "€", Name: "Euro"},
	"GBP": {Code: "GBP", Symbol: "£", Name: "British Pound"},
	"ILS": {Code: "ILS", Symbol: "₪", Name: "Israeli New Sheqel"},
	"AUD": {Code: "AUD", Symbol: "A$", Name: "Australian Dollar"},
	"BGN": {Code: "BGN", Symbol: "лв", Name: "Bulgarian Lev"},
	"BRL": {Code: "BRL", Symbol: "R$", Name: "Brazilian Real"},
	"CAD": {Code: "CAD", Symbol: "C$", Name: "Canadian Dollar"},
	"CHF": {Code: "CHF", Symbol: "CHF", Name: "Swiss Franc"},
	"CNY": {Code: "CNY", Symbol: "¥", Name: "Chinese Renminbi Yuan"},
	"CZK": {Code: "CZK", Symbol: "Kč", Name: "Czech Koruna"},
	"DKK": {Code: "DKK", Symbol: "kr", Name: "Danish Krone"},
	"HKD": {Code: "HKD", Symbol: "HK$", Name: "Hong Kong Dollar"},
	"HUF": {Code: "HUF", Symbol: "Ft", Name: "Hungarian Forint"},
	"IDR": {Code: "IDR", Symbol: "Rp", Name: "Indonesian Rupiah"},
	"INR": {Code: "INR", Symbol: "₹", Name: "Indian Rupee"},
	"ISK": {Code: "ISK", Symbol: "kr", Name: "Icelandic Króna"},
	"JPY": {Code: "JPY", Symbol: "¥", Name: "Japanese Yen"},
	"KRW": {Code: "KRW", Symbol: "₩", Name: "South Korean Won"},
	"MXN": {Code: "MXN", Symbol: "MX$", Name: "Mexican Peso"},
	"MYR": {Code: "MYR", Symbol: "RM", Name: "Malaysian Ringgit"},
	"NOK": {Code: "NOK", Symbol: "kr", Name: "Norwegian Krone"},
	"NZD": {Code: "NZD", Symbol: "NZ$", Name: "New Zealand Dollar"},
	"PHP": {Code: "PHP", Symbol: "₱", Name: "Philippine Peso"},
	"PLN": {Code: "PLN", Symbol: "zł", Name: "Polish Złoty"},
	"RON": {Code: "RON", Symbol: "lei", Name: "Romanian Leu"},
	"SEK": {Code: "SEK", Symbol: "kr", Name: "Swedish Krona"},
	"SGD": {Code: "SGD", Symbol: "SGD", Name: "Singapore Dollar"},
	"THB": {Code: "THB", Symbol: "฿", Name: "Thai Baht"},
	"TWD": {Code: "TWD", Symbol: "NT$", Name: "Taiwan New Dollar"},
}

// IsSupportedCurrency reports whether code is one of the 30 supported currencies.
func IsSupportedCurrency(code string) bool {
	_, ok := Currencies[strings.ToUpper(code)]
	return ok
}
