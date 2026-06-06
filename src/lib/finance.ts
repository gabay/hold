import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
import { db } from "./db";

export interface AssetInfo {
  symbol: string;
  name: string;
  price: number;
  currency: string;
}

/**
 * Fetches current price and currency metadata for a symbol
 */
export async function getLiveAssetInfo(symbol: string): Promise<AssetInfo> {
  try {
    const result = (await yahooFinance.quote(symbol.toUpperCase())) as any;
    if (!result) {
      throw new Error(`Symbol ${symbol} not found`);
    }

    return {
      symbol: symbol.toUpperCase(),
      name: result.shortName || result.longName || symbol,
      price: result.regularMarketPrice || 0,
      currency: (result.currency || "USD").toUpperCase(),
    };
  } catch (error) {
    console.error(`Error fetching live asset info for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Fetches historical price for a symbol on a specific date, caching in database
 */
export async function getHistoricalAssetPrice(
  symbol: string,
  date: Date
): Promise<{ price: number; currency: string }> {
  const targetSymbol = symbol.toUpperCase();
  // Strip time from date to represent the day
  const dateKey = new Date(date.toISOString().split("T")[0]);

  // Check cache first
  const cached = await db.assetPriceCache.findUnique({
    where: {
      symbol_date: {
        symbol: targetSymbol,
        date: dateKey,
      },
    },
  });

  if (cached) {
    return { price: cached.price, currency: cached.currency };
  }

  // Fetch from Yahoo Finance
  try {
    const start = new Date(dateKey);
    start.setDate(start.getDate() - 5); // Lookback 5 days in case target date is a weekend/holiday
    const end = new Date(dateKey);
    end.setDate(end.getDate() + 1);

    const historicalData = (await yahooFinance.historical(targetSymbol, {
      period1: start.toISOString().split("T")[0],
      period2: end.toISOString().split("T")[0],
      interval: "1d",
    })) as any[];

    if (!historicalData || historicalData.length === 0) {
      // Fallback to live price if historical is failed or unavailable
      const live = await getLiveAssetInfo(targetSymbol);
      return { price: live.price, currency: live.currency };
    }

    // Get closest data point before or on the target date
    // Sort descending by date
    const sortedData = historicalData
      .filter((d) => d.close !== null && d.close !== undefined)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const closestPrice = sortedData[0].close as number;
    
    // Get live info to know currency
    const liveInfo = await getLiveAssetInfo(targetSymbol);

    // Save cache
    await db.assetPriceCache.upsert({
      where: {
        symbol_date: {
          symbol: targetSymbol,
          date: dateKey,
        },
      },
      update: {
        price: closestPrice,
        currency: liveInfo.currency,
      },
      create: {
        symbol: targetSymbol,
        date: dateKey,
        price: closestPrice,
        currency: liveInfo.currency,
      },
    });

    return { price: closestPrice, currency: liveInfo.currency };
  } catch (error) {
    console.warn(`Could not get historical price for ${targetSymbol} on ${dateKey.toISOString()}:`, error);
    // Fallback to live price
    const live = await getLiveAssetInfo(targetSymbol);
    return { price: live.price, currency: live.currency };
  }
}

/**
 * Gets exchange rate on a specific date, caching in database
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: Date
): Promise<number> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  
  if (from === to) return 1.0;

  const dateKey = new Date(date.toISOString().split("T")[0]);

  // Check cache first
  const cached = await db.exchangeRateCache.findUnique({
    where: {
      fromCurrency_toCurrency_date: {
        fromCurrency: from,
        toCurrency: to,
        date: dateKey,
      },
    },
  });

  if (cached) {
    return cached.rate;
  }

  // Fetch from Frankfurter API
  try {
    const dateStr = dateKey.toISOString().split("T")[0];
    const url = `https://api.frankfurter.app/${dateStr}?from=${from}&to=${to}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch rate: ${response.statusText}`);
    }
    
    const data = (await response.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[to];

    if (!rate) {
      throw new Error(`Rate not found for ${to}`);
    }

    // Cache the rate
    await db.exchangeRateCache.upsert({
      where: {
        fromCurrency_toCurrency_date: {
          fromCurrency: from,
          toCurrency: to,
          date: dateKey,
        },
      },
      update: { rate },
      create: {
        fromCurrency: from,
        toCurrency: to,
        date: dateKey,
        rate,
      },
    });

    // Cache reverse rate too for convenience
    await db.exchangeRateCache.upsert({
      where: {
        fromCurrency_toCurrency_date: {
          fromCurrency: to,
          toCurrency: from,
          date: dateKey,
        },
      },
      update: { rate: 1.0 / rate },
      create: {
        fromCurrency: to,
        toCurrency: from,
        date: dateKey,
        rate: 1.0 / rate,
      },
    });

    return rate;
  } catch (error) {
    console.error(`Error fetching exchange rate ${from} -> ${to} on ${dateKey.toISOString()}:`, error);
    // Fallback to basic standard ratios if API fails
    if (from === "EUR" && to === "USD") return 1.08;
    if (from === "USD" && to === "EUR") return 0.93;
    return 1.0;
  }
}

/**
 * Searches symbols matching a query string
 */
export async function searchAssets(query: string): Promise<Array<{ symbol: string; name: string; type: string }>> {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await yahooFinance.search(query);
    if (!res || !res.quotes) return [];
    
    return res.quotes
      .filter((q: any) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "MUTUALFUND"))
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        type: q.quoteType || "EQUITY",
      }));
  } catch (error) {
    console.error(`Error searching assets for "${query}":`, error);
    return [];
  }
}
