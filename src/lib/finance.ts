import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: 300, checkperiod: 300 });

import { getDateString as getDateString, getDateInt, DateInt, addDays } from "./util";
import { SearchQuoteYahoo } from "yahoo-finance2/modules/search";

export interface DividendProvider {
    getDividendsOn(date: Date): Promise<number>;
}

export interface AssetInfo {
    symbol: string;
    name: string;
    currency: string;
    price: number;
    fromDate: Date;
    prices: Map<DateInt, number>;
    dividends?: Map<DateInt, number>;
    splits?: Map<DateInt, number>;
}

export interface ExchangeRates {
    baseCurrency: string;
    targetCurrency: string;
    fromDate: Date;
    rates: Map<DateInt, number>;
}

export interface SearchAssetResult { symbol: string; name: string; type: string };

/**
 * Fetches current price and currency metadata for a symbol
 */
export async function getAssetInfo(
    symbol: string,
    fromDate: Date = new Date(),
    currency?: string,
): Promise<AssetInfo> {
    const cache_key = `asset-${symbol}`;
    const cached = cache.get<AssetInfo>(cache_key);
    if (cached && cached.fromDate <= fromDate)
        return await convertAssetInfoCurrency(cached, currency);

    try {
        const result = await yahooFinance.chart(symbol.toUpperCase(), {
            period1: getDateString(fromDate),
            interval: "1d",
        });
        if (!result) {
            throw new Error(`Symbol ${symbol} not found`);
        }

        const prices = new Map(
            result.quotes.filter((q) => q.close).map((q) => [getDateInt(q.date), q.close!]),
        );
        const splits = new Map(
            result.events?.splits?.map((s) => [getDateInt(s.date), s.numerator / s.denominator]),
        );

        const assetInfo = {
            symbol: result.meta.symbol,
            name: result.meta.shortName || result.meta.longName || result.meta.symbol,
            currency: (result.meta.currency || "USD").toUpperCase(),
            price: result.meta.regularMarketPrice || 0,
            fromDate: fromDate,
            prices: adjustPreSplitPrices(prices, splits),
            dividends: new Map(
                result.events?.dividends?.map((d) => [getDateInt(d.date), d.amount]),
            ),
            splits: splits,
        };
        cache.set(cache_key, assetInfo);
        return await convertAssetInfoCurrency(assetInfo, currency);
    } catch (error) {
        console.error(`Error in getAssetInfo(${symbol}, ${fromDate.toISOString()}):`, error);
        throw error;
    }
}

function adjustPreSplitPrices(
    prices: Map<DateInt, number>,
    splits: Map<DateInt, number>,
): Map<DateInt, number> {
    if (splits.size === 0) return prices;

    return new Map(
        prices.entries().map(([date, price]) => {
            const multiplier = splits
                .entries()
                .filter(([splitDate]) => date < splitDate)
                .reduce((acc, [, split]) => acc * split, 1);
            return [date, price * multiplier];
        }),
    );
}

/**
 * Fetches current price and currency metadata for a symbol
 */
async function convertAssetInfoCurrency(
    assetInfo: AssetInfo,
    targetCurrency?: string,
): Promise<AssetInfo> {
    if (!targetCurrency || assetInfo.currency === targetCurrency) return assetInfo;

    const rates = await getExchangeRates(assetInfo.currency, targetCurrency, assetInfo.fromDate);
    return {
        ...assetInfo,
        currency: targetCurrency,
        price: assetInfo.price * (await getExchangeRate(assetInfo.currency, targetCurrency)),
        prices: new Map(
            assetInfo.prices
                .entries()
                .map(([date, price]) => [date, price * (rates?.rates.get(date) || 1)]),
        ),
        dividends:
            assetInfo.dividends &&
            new Map(
                assetInfo.dividends
                    .entries()
                    .map(([date, amount]) => [date, amount * (rates?.rates.get(date) || 1)]),
            ),
    };
}

/**
 * Converts an amount from one currency to another using exchange rates
 */
export async function convertCurrency(
    amount: number,
    baseCurrency: string,
    toCurrency: string,
    date: Date,
): Promise<number> {
    if (baseCurrency === toCurrency) return amount;
    return amount * (await getExchangeRate(baseCurrency, toCurrency, date));
}

export function getPrice(assetInfo: AssetInfo, date: DateInt): number {
    // look up 4 days back, or 2 days forward.
    for (const delta of [0, -1, -2, -3, -4, 1, 2]) {
        const price = assetInfo.prices.get(addDays(date, delta));
        if (price) {
            return price;
        }
    }
    return 0;
}

/**
 * Gets exchange rate on a specific date
 */
export async function getExchangeRate(
    baseCurrency: string,
    targetCurrency: string,
    date: Date = new Date(),
): Promise<number> {
    const exchangeRates = await getExchangeRates(baseCurrency, targetCurrency, date);
    return (
        exchangeRates?.rates.get(getDateInt(date)) ||
        exchangeRates?.rates.get(addDays(date, -1)) ||
        1.0
    );
}

/**
 * Gets exchange rate on a specific date, caching in memory
 */
export async function getExchangeRates(
    baseCurrency: string,
    targetCurrency: string,
    fromDate: Date,
): Promise<ExchangeRates | undefined> {
    // return undefined for converting the same currency.
    if (baseCurrency === targetCurrency) {
        return undefined;
    }

    // lookup cache (and reverse cache)
    const cache_key = `xrate-${baseCurrency}-${targetCurrency}`;
    const cached = cache.get<ExchangeRates>(cache_key);
    if (cached && cached.fromDate <= fromDate) return cached;

    const reverse_cache_key = `xrate-${targetCurrency}-${baseCurrency}`;
    const reverse_cached = cache.get<ExchangeRates>(reverse_cache_key);
    if (reverse_cached && reverse_cached.fromDate <= fromDate)
        return reverseExchangeRates(reverse_cached);

    // Fetch from Frankfurter API
    try {
        const dateStr = getDateString(fromDate);
        const base = baseCurrency.toUpperCase();
        const target = targetCurrency.toUpperCase();
        const url = `https://api.frankfurter.dev/v2/rates?from=${dateStr}&base=${base}&quotes=${target}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch rate: ${response.statusText}`);
        }
        const data = (await response.json()) as [{ date: string; rate: number }];
        const exchangeRates = {
            baseCurrency,
            targetCurrency,
            fromDate,
            rates: new Map(data.map(({ date, rate }) => [getDateInt(new Date(date)), rate])),
        };
        cache.set(cache_key, exchangeRates);
        return exchangeRates;
    } catch (error) {
        console.error(
            `Error fetching exchange rates ${baseCurrency} -> ${targetCurrency} since ${fromDate.toISOString()}:`,
            error,
        );
        throw error;
    }
}

function reverseExchangeRates(exchangeRates: ExchangeRates): ExchangeRates {
    return {
        baseCurrency: exchangeRates.targetCurrency,
        targetCurrency: exchangeRates.baseCurrency,
        fromDate: exchangeRates.fromDate,
        rates: new Map(
            Array.from(exchangeRates.rates.entries()).map(([date, rate]) => [date, 1 / rate]),
        ),
    };
}

/**
 * Searches symbols matching a query string
 */
export async function searchAssets(
    query: string,
): Promise<Array<SearchAssetResult>> {
    if (!query || query.trim().length < 2) return [];
    try {
        const res = await yahooFinance.search(query);
        if (!res || !res.quotes) return [];

        return (res.quotes as Array<SearchQuoteYahoo>)
            .filter(
                (q) =>
                    q.symbol &&
                    (q.quoteType === "EQUITY" ||
                        q.quoteType === "ETF" ||
                        q.quoteType === "MUTUALFUND"),
            )
            .map((q) => ({
                symbol: q.symbol!,
                name: q.shortname || q.longname || q.symbol!,
                type: (q.quoteType as string) || "EQUITY",
            }));
    } catch (error) {
        console.error(`Error in searchAssets(${query}):`, error);
        return [];
    }
}
