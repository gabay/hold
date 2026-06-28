export interface Currency {
    symbol: string;
    name: string;
}

export const CURRENCIES: Record<string, Currency> = {
    USD: {symbol: "$", name:"United States Dollar"},
    EUR: {symbol: "€", name:"Euro"},
    GBP: {symbol: "£", name:"British Pound"},
    ILS: {symbol: "₪", name:"Israeli New Sheqel"},
    AUD: {symbol: "A$", name:"Australian Dollar"},
    BGN: {symbol: "лв", name:"Bulgarian Lev"},
    BRL: {symbol: "R$", name:"Brazilian Real"},
    CAD: {symbol: "C$", name:"Canadian Dollar"},
    CHF: {symbol: "CHF", name:"Swiss Franc"},
    CNY: {symbol: "¥", name:"Chinese Renminbi Yuan"},
    CZK: {symbol: "Kč", name:"Czech Koruna"},
    DKK: {symbol: "kr", name:"Danish Krone"},
    HKD: {symbol: "HK$", name:"Hong Kong Dollar"},
    HUF: {symbol: "Ft", name:"Hungarian Forint"},
    IDR: {symbol: "Rp", name:"Indonesian Rupiah"},
    INR: {symbol: "₹", name:"Indian Rupee"},
    ISK: {symbol: "kr", name:"Icelandic Króna"},
    JPY: {symbol: "¥", name:"Japanese Yen"},
    KRW: {symbol: "₩", name:"South Korean Won"},
    MXN: {symbol: "MX$", name:"Mexican Peso"},
    MYR: {symbol: "RM", name:"Malaysian Ringgit"},
    NOK: {symbol: "kr", name:"Norwegian Krone"},
    NZD: {symbol: "NZ$", name:"New Zealand Dollar"},
    PHP: {symbol: "₱", name:"Philippine Peso"},
    PLN: {symbol: "zł", name:"Polish Złoty"},
    RON: {symbol: "lei", name:"Romanian Leu"},
    SEK: {symbol: "kr", name:"Swedish Krona"},
    SGD: {symbol: "SGD", name:"Singapore Dollar"},
    THB: { symbol: "฿", name: "Thai Baht" },
    TWD: { symbol: "NT$", name: "Taiwan New Dollar" },
};
