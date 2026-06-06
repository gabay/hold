import { db } from "./db";
import { getLiveAssetInfo, getHistoricalAssetPrice, getExchangeRate } from "./finance";

export interface AssetHolding {
  symbol: string;
  quantity: number;
  totalCost: number; // Cost in transaction currency
  avgBuyPrice: number; // Avg price in transaction currency
  currentPrice: number; // Current price in asset currency
  currency: string; // Asset trading currency (e.g. USD, EUR)
  
  // Values converted to requested display currency
  costInDisplayCurrency: number;
  valueInDisplayCurrency: number;
  profitInDisplayCurrency: number;
  profitPercentage: number;
}

export interface PortfolioSummary {
  portfolioId: string;
  name: string;
  baseCurrency: string;
  displayCurrency: string;
  totalCost: number; // In display currency
  totalValue: number; // In display currency
  totalProfit: number; // In display currency
  totalProfitPercentage: number;
  holdings: AssetHolding[];
}

export interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  valuation: number;
  invested: number;
}

/**
 * Calculates current valuation, cost basis, and holdings for a portfolio in a given display currency
 */
export async function getPortfolioSummary(
  portfolioId: string,
  displayCurrency: string = "USD"
): Promise<PortfolioSummary> {
  const portfolio = await db.portfolio.findUnique({
    where: { id: portfolioId },
    include: { transactions: true },
  });

  if (!portfolio) {
    throw new Error("Portfolio not found");
  }

  const transactions = portfolio.transactions;
  const holdingsMap = new Map<string, { quantity: number; totalCost: number }>();

  // Process transactions to find net holdings and cost basis
  for (const tx of transactions) {
    const symbol = tx.symbol.toUpperCase();
    const current = holdingsMap.get(symbol) || { quantity: 0, totalCost: 0 };
    
    if (tx.type === "BUY") {
      const addedQuantity = tx.quantity;
      const addedCost = tx.quantity * tx.pricePerShare + tx.fee;
      holdingsMap.set(symbol, {
        quantity: current.quantity + addedQuantity,
        totalCost: current.totalCost + addedCost,
      });
    } else if (tx.type === "SELL") {
      const removedQuantity = tx.quantity;
      // Realized profit calculation can be added, but for holdings we just subtract quantity
      const ratio = current.quantity > 0 ? (current.quantity - removedQuantity) / current.quantity : 0;
      holdingsMap.set(symbol, {
        quantity: Math.max(0, current.quantity - removedQuantity),
        // Reduce cost basis proportionally
        totalCost: Math.max(0, current.totalCost * ratio),
      });
    }
  }

  const holdings: AssetHolding[] = [];
  let totalCost = 0;
  let totalValue = 0;

  for (const [symbol, info] of holdingsMap.entries()) {
    if (info.quantity <= 0) continue;

    // Fetch live asset details
    const liveInfo = await getLiveAssetInfo(symbol);
    const avgBuyPrice = info.quantity > 0 ? info.totalCost / info.quantity : 0;

    // Get exchange rate for the cost basis
    // Note: For cost basis, we convert the total original cost in the transaction currency
    // to the display currency at current rate OR transaction rate.
    // For simplicity, we convert transaction-currency cost to display-currency using today's rate,
    // or we can convert them individually during transaction logging.
    // Let's get today's exchange rate for current price and cost.
    const fxRateAssetToDisplay = await getExchangeRate(liveInfo.currency, displayCurrency, new Date());
    
    // We assume transactions are logged in the asset's currency (standard behavior)
    // If transaction currency differs from asset primary currency, we convert from transaction currency.
    // In this app, transaction.currency will represent the currency the buy was executed in.
    // Let's use today's rate for converting current valuation
    const costInDisplayCurrency = info.totalCost * fxRateAssetToDisplay; 
    const valueInDisplayCurrency = info.quantity * liveInfo.price * fxRateAssetToDisplay;
    const profitInDisplayCurrency = valueInDisplayCurrency - costInDisplayCurrency;
    const profitPercentage = costInDisplayCurrency > 0 ? (profitInDisplayCurrency / costInDisplayCurrency) * 100 : 0;

    holdings.push({
      symbol,
      quantity: info.quantity,
      totalCost: info.totalCost,
      avgBuyPrice,
      currentPrice: liveInfo.price,
      currency: liveInfo.currency,
      costInDisplayCurrency,
      valueInDisplayCurrency,
      profitInDisplayCurrency,
      profitPercentage,
    });

    totalCost += costInDisplayCurrency;
    totalValue += valueInDisplayCurrency;
  }

  const totalProfit = totalValue - totalCost;
  const totalProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  return {
    portfolioId: portfolio.id,
    name: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    displayCurrency,
    totalCost,
    totalValue,
    totalProfit,
    totalProfitPercentage,
    holdings,
  };
}

/**
 * Calculates portfolio valuation and invested capital daily over the last N days
 */
export async function getPortfolioHistory(
  portfolioId: string,
  displayCurrency: string = "USD",
  days: number = 30
): Promise<ChartDataPoint[]> {
  const portfolio = await db.portfolio.findUnique({
    where: { id: portfolioId },
    include: { transactions: true },
  });

  if (!portfolio) {
    throw new Error("Portfolio not found");
  }

  const chartData: ChartDataPoint[] = [];
  const today = new Date();
  
  // Generate dates array for past N days (step weekly if 1 year or longer)
  const dates: Date[] = [];
  const step = days >= 365 ? 7 : 1;
  for (let i = days - 1; i >= 0; i -= step) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    dates.push(new Date(d.toISOString().split("T")[0]));
  }

  // Calculate value for each date
  for (const date of dates) {
    const dateStr = date.toISOString().split("T")[0];
    
    // Filter transactions up to this date
    const txsBeforeDate = portfolio.transactions.filter(
      (tx) => new Date(tx.transactionDate.toISOString().split("T")[0]) <= date
    );

    const holdingsMap = new Map<string, { quantity: number; totalCost: number }>();
    
    for (const tx of txsBeforeDate) {
      const symbol = tx.symbol.toUpperCase();
      const current = holdingsMap.get(symbol) || { quantity: 0, totalCost: 0 };
      
      if (tx.type === "BUY") {
        holdingsMap.set(symbol, {
          quantity: current.quantity + tx.quantity,
          totalCost: current.totalCost + (tx.quantity * tx.pricePerShare + tx.fee),
        });
      } else if (tx.type === "SELL") {
        const ratio = current.quantity > 0 ? (current.quantity - tx.quantity) / current.quantity : 0;
        holdingsMap.set(symbol, {
          quantity: Math.max(0, current.quantity - tx.quantity),
          totalCost: Math.max(0, current.totalCost * ratio),
        });
      }
    }

    let dailyValuation = 0;
    let dailyInvested = 0;

    for (const [symbol, info] of holdingsMap.entries()) {
      if (info.quantity <= 0) continue;

      // Get historical price for this symbol on this date
      const { price, currency } = await getHistoricalAssetPrice(symbol, date);
      
      // Get historical exchange rate on this date
      const fxRate = await getExchangeRate(currency, displayCurrency, date);

      dailyValuation += info.quantity * price * fxRate;
      dailyInvested += info.totalCost * fxRate;
    }

    chartData.push({
      date: dateStr,
      valuation: parseFloat(dailyValuation.toFixed(2)),
      invested: parseFloat(dailyInvested.toFixed(2)),
    });
  }

  return chartData;
}
