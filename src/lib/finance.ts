import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
import NodeCache from "node-cache";
export const cache = new NodeCache({ stdTTL: 300, checkperiod: 300 });

import { getDateString as getDateString, getDateInt, DateInt, addDays, getDate } from "./util";
import { SearchQuoteYahoo } from "yahoo-finance2/modules/search";
import { db } from "./db";

// Once a symbol/currency-pair has history stored, only re-fetch the last few
// days instead of the full history requested by the caller.
const FETCH_BUFFER_DAYS = 2;

// Given the latest date already stored (if any), returns how far back a
// refresh fetch needs to go: a few days before that, or fromDate if nothing
// (or nothing recent enough) is stored yet.
function bufferedFetchStart(fromDate: Date, latestStored?: Date): Date {
    if (!latestStored) return fromDate;
    const bufferedStart = getDate(addDays(getDateInt(latestStored), -FETCH_BUFFER_DAYS));
    return bufferedStart > fromDate ? bufferedStart : fromDate;
}

// Overlays `overrides` onto `base`, without mutating either.
function mergeMaps<K, V>(base: Map<K, V>, overrides: Map<K, V>): Map<K, V> {
    const merged = new Map(base);
    for (const [key, value] of overrides) merged.set(key, value);
    return merged;
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

export interface SearchAssetResult {
    symbol: string;
    name: string;
    type: string;
}

/**
 * Fetches current price and currency metadata for a symbol
 */
export async function getAssetInfo(
    symbol: string,
    fromDate: Date = getDate(),
    currency?: string,
): Promise<AssetInfo> {
    const cache_key = `asset-${symbol}`;
    const cached = cache.get<AssetInfo>(cache_key);
    if (cached && cached.fromDate <= fromDate)
        return await convertAssetInfoCurrency(cached, currency);

    try {
        const upperSymbol = symbol.toUpperCase();

        // Serve as much as we can from what's already stored, and only ask
        // Yahoo for the last few days on top of it.
        const [existingRows, latest] = await Promise.all([
            db.stockPrice.findMany({
                where: { symbol: upperSymbol, date: { gte: fromDate } },
                orderBy: { date: "asc" },
            }),
            db.stockPrice.findFirst({
                where: { symbol: upperSymbol },
                orderBy: { date: "desc" },
            }),
        ]);

        const result = await yahooFinance.chart(upperSymbol, {
            period1: getDateString(bufferedFetchStart(fromDate, latest?.date)),
            interval: "1d",
        });
        if (!result) {
            throw new Error(`Symbol ${symbol} not found`);
        }

        const freshPrices = new Map(
            result.quotes.filter((q) => q.close).map((q) => [getDateInt(q.date), q.close!]),
        );
        const freshSplits = new Map(
            result.events?.splits?.map((s) => [getDateInt(s.date), s.numerator / s.denominator]),
        );
        const freshDividends = new Map(
            result.events?.dividends?.map((d) => [getDateInt(d.date), d.amount]),
        );

        // Persist raw (unadjusted) prices for the freshly fetched days so future
        // calls only need to top up recent history instead of refetching it all.
        await db.$transaction(
            Array.from(freshPrices.entries()).map(([dateInt, price]) =>
                db.stockPrice.upsert({
                    where: { symbol_date: { symbol: upperSymbol, date: new Date(dateInt) } },
                    create: {
                        symbol: upperSymbol,
                        date: new Date(dateInt),
                        price,
                        dividend: freshDividends.get(dateInt),
                        split: freshSplits.get(dateInt),
                    },
                    update: {
                        price,
                        dividend: freshDividends.get(dateInt),
                        split: freshSplits.get(dateInt),
                    },
                }),
            ),
        );

        const prices = mergeMaps(
            new Map(existingRows.map((r) => [getDateInt(r.date), r.price])),
            freshPrices,
        );
        const splits = mergeMaps(
            new Map(
                existingRows
                    .filter((r) => r.split != null)
                    .map((r) => [getDateInt(r.date), r.split!]),
            ),
            freshSplits,
        );
        const dividends = mergeMaps(
            new Map(
                existingRows
                    .filter((r) => r.dividend != null)
                    .map((r) => [getDateInt(r.date), r.dividend!]),
            ),
            freshDividends,
        );

        const assetInfo = {
            symbol: result.meta.symbol,
            name: result.meta.shortName || result.meta.longName || result.meta.symbol,
            currency: (result.meta.currency || "USD").toUpperCase(),
            price: result.meta.regularMarketPrice || 0,
            fromDate: fromDate,
            prices: adjustPreSplitPrices(prices, splits),
            dividends,
            splits,
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

export function getValueAroundDate(
    values: Map<DateInt, number> | undefined,
    date: DateInt,
): number | undefined {
    if (values === undefined) return undefined;

    // look up 4 days back, or 2 days forward.
    for (const delta of [0, -1, -2, -3, -4, 1, 2]) {
        const price = values.get(addDays(date, delta));
        if (price !== undefined) {
            return price;
        }
    }
    return undefined;
}

/**
 * Gets exchange rate on a specific date
 */
export async function getExchangeRate(
    baseCurrency: string,
    targetCurrency: string,
    date: Date = getDate(),
): Promise<number> {
    const exchangeRates = await getExchangeRates(baseCurrency, targetCurrency, date);
    const rate = getValueAroundDate(exchangeRates?.rates, getDateInt(date));
    if (rate === undefined)
        throw new Error(`No exchange rate for ${baseCurrency} -> ${targetCurrency} on ${date}`);
    return rate;
}

// Rates are always stored with the alphabetically-first currency as the
// base, so only one direction ever needs to be looked up or fetched. The
// opposite direction is derived in memory (1 / rate).
function canonicalPair(
    currencyA: string,
    currencyB: string,
): { base: string; target: string; flipped: boolean } {
    return currencyA <= currencyB
        ? { base: currencyA, target: currencyB, flipped: false }
        : { base: currencyB, target: currencyA, flipped: true };
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

    const { base, target, flipped } = canonicalPair(
        baseCurrency.toUpperCase(),
        targetCurrency.toUpperCase(),
    );

    const cache_key = `xrate-${base}-${target}`;
    const cached = cache.get<ExchangeRates>(cache_key);
    if (cached && cached.fromDate <= fromDate)
        return flipped ? reverseExchangeRates(cached) : cached;

    try {
        const [existingRows, latest] = await Promise.all([
            db.exchangeRate.findMany({
                where: { baseCurrency: base, targetCurrency: target, date: { gte: fromDate } },
                orderBy: { date: "asc" },
            }),
            db.exchangeRate.findFirst({
                where: { baseCurrency: base, targetCurrency: target },
                orderBy: { date: "desc" },
            }),
        ]);

        const dateStr = getDateString(bufferedFetchStart(fromDate, latest?.date));
        const url = `https://api.frankfurter.dev/v2/rates?from=${dateStr}&base=${base}&quotes=${target}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch rate: ${response.statusText}`);
        }
        const data = (await response.json()) as [{ date: string; rate: number }];
        const freshRates = new Map(data.map(({ date, rate }) => [getDateInt(getDate(date)), rate]));

        await db.$transaction(
            Array.from(freshRates.entries()).map(([dateInt, rate]) =>
                db.exchangeRate.upsert({
                    where: {
                        baseCurrency_targetCurrency_date: {
                            baseCurrency: base,
                            targetCurrency: target,
                            date: new Date(dateInt),
                        },
                    },
                    create: {
                        baseCurrency: base,
                        targetCurrency: target,
                        date: new Date(dateInt),
                        rate,
                    },
                    update: { rate },
                }),
            ),
        );

        const rates = mergeMaps(
            new Map(existingRows.map((r) => [getDateInt(r.date), r.rate])),
            freshRates,
        );

        const canonicalResult: ExchangeRates = {
            baseCurrency: base,
            targetCurrency: target,
            fromDate,
            rates,
        };
        cache.set(cache_key, canonicalResult);
        return flipped ? reverseExchangeRates(canonicalResult) : canonicalResult;
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
export async function searchAssets(query: string): Promise<Array<SearchAssetResult>> {
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
                type: q.quoteType! as string,
            }));
    } catch (error) {
        console.error(`Error in searchAssets(${query}):`, error);
        return [];
    }
}
