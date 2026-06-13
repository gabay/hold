import { Transaction } from "@prisma/client";
import { db } from "./db";
import { getAssetInfo, getExchangeRate, AssetInfo, getPrice } from "./finance";
import { DateInt, getDateInt, getDateString } from "./util";

export interface PortfolioData {
    portfolioId: string;
    name: string;

    // portfolio summary (including holdings)
    summary: PortfolioSummary;

    // transactions
    transactions: Transaction[];

    // chart data
    history: ChartDataPoint[];
}

export interface PortfolioSummary {
    currency: string;
    totalCost: number;
    totalValue: number;
    totalRealized: number;
    totalProfit: number;
    totalProfitPercentage: number;
    assets: AssetData[];
}

export interface AssetData {
    symbol: string;
    currency: string;
    quantity: number;

    avgBuyPrice: number;
    currentPrice: number;

    cost: number;
    value: number;
    realized: number;
    profit: number;
    profitPercentage: number;

    history: ChartDataPoint[];
}

export interface ChartDataPoint {
    date: string; // YYYY-MM-DD
    valuation: number;
    invested: number;
    realized: number;
}

export interface DateIntValue {
    timestamp: DateInt;
    value: number;
}

/**
 * Calculate portfolio data
 */
export async function getPortfolioData(
    portfolioId: string,
    currency: string = "USD",
    chartDays: DateInt[] = [],
): Promise<PortfolioData> {
    // get portfolio + transactions.
    const portfolio = await db.portfolio.findUnique({
        where: { id: portfolioId },
    });
    if (!portfolio) {
        throw new Error("Portfolio not found");
    }

    const transactions = await db.transaction.findMany({
        where: { portfolioId: portfolioId },
        orderBy: { transactionDate: "asc" },
    });

    // get asset data for every symbol.
    const symbols = new Set(transactions.map((tx) => tx.symbol));
    const assets = await Promise.all(
        Array.from(symbols).map((symbol) =>
            getAssetData(
                symbol,
                transactions.filter((tx) => tx.symbol === symbol),
                currency,
                chartDays,
            ),
        ),
    );

    // sum up all asset data to portfolio data.
    const totalCost = assets.reduce((sum, asset) => sum + asset.cost, 0);
    const totalValue = assets.reduce((sum, asset) => sum + asset.value, 0);
    const totalRealized = assets.reduce((sum, asset) => sum + asset.realized, 0);
    const totalProfit = totalValue + totalRealized - totalCost;
    const totalProfitPercentage = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return {
        portfolioId,
        name: portfolio.name,
        summary: {
            currency,
            totalCost,
            totalValue,
            totalRealized,
            totalProfit,
            totalProfitPercentage,
            assets,
        },
        transactions: transactions.reverse(),
        history: aggregateChartData(chartDays, assets),
    };
}

/**
 * Calculates the asset data for a given symbol, including quantity, cost, value, and profit.
 */
async function getAssetData(
    symbol: string,
    transactions: Transaction[],
    currency: string,
    chartDays: DateInt[],
): Promise<AssetData> {
    // find the first transaction date
    const firstActivity = new Date(
        Math.min(...transactions.map((tx) => tx.transactionDate.getTime())),
    );
    // get asset info and transactions in currancy
    const assetInfo = await getAssetInfo(symbol, firstActivity, currency);
    const transactionsInCurrency = await convertTransactionsCurrency(transactions, currency);

    const calculator = new AssetDataCalculator(transactionsInCurrency, assetInfo);
    const quantity = calculator.getQuantity();
    const realized = calculator.getRealized();
    const value = quantity * assetInfo.price;
    const cost = calculator.getCost();
    const profit = value + realized - cost;
    const profitPercentage = cost > 0 ? (profit / cost) * 100 : 0;

    // TODO use splits to calculate current quantity
    // TODO: use dividends + sells to calculate realized

    return {
        symbol,
        currency,
        quantity,
        avgBuyPrice: cost / quantity,
        currentPrice: assetInfo.price,
        cost,
        value,
        realized,
        profit,
        profitPercentage,
        history: chartDays.map((day) => calculator.getChartDataPoint(day)),
    };
}

/**
 * Converts all transactions to the specified currency.
 */
async function convertTransactionsCurrency(
    transactions: Transaction[],
    currency: string,
): Promise<Transaction[]> {
    return await Promise.all(
        transactions.map(async (tx) => {
            if (tx.currency === currency) {
                return tx;
            }
            return {
                ...tx,
                pricePerShare:
                    tx.pricePerShare *
                    (await getExchangeRate(tx.currency, currency, tx.transactionDate)),
                currency,
            };
        }),
    );
}

/**
 * Calculates statistics of the given asset, given the asset info and historic transactions.
 * This class preforms some per-computation on initialization to allow efficient calculation of
 * asset quantity, cost, realized profit, and chart data for any date.
 */
class AssetDataCalculator {
    private transactions: Transaction[];
    private assetInfo: AssetInfo;
    private quantityByDate: DateIntValue[] = [];
    private realizedByDate: DateIntValue[] = [];

    constructor(transactions: Transaction[], assetInfo: AssetInfo) {
        this.transactions = transactions;
        this.assetInfo = assetInfo;

        // splits + dividends should happen before buys and sells.
        enum EventType {
            Split = 1,
            Dividend,
            Buy,
            Sell,
        }

        interface Event {
            date: DateInt;
            type: EventType;
            value: number;
        }

        // create a sorted list of events.
        const events: Event[] = [];
        this.transactions.forEach((tx) => {
            events.push({
                date: getDateInt(tx.transactionDate),
                type: tx.type === "SELL" ? EventType.Sell : EventType.Buy,
                value: tx.quantity,
            });
        });
        this.assetInfo.splits?.entries().forEach(([date, multiplier]) => {
            events.push({
                date,
                type: EventType.Split,
                value: multiplier,
            });
        });
        this.assetInfo.dividends?.entries().forEach(([date, amount]) => {
            events.push({
                date,
                type: EventType.Dividend,
                value: amount,
            });
        });
        events.sort((a, b) => a.date - b.date || a.type - b.type);

        let quantity = 0;
        let realized = 0;

        events.forEach((event) => {
            switch (event.type) {
                case EventType.Split:
                    quantity *= event.value;
                    this.quantityByDate.push({ timestamp: event.date, value: quantity });
                    break;
                case EventType.Dividend:
                    realized += event.value * quantity;
                    this.realizedByDate.push({ timestamp: event.date, value: realized });
                    break;
                case EventType.Buy:
                    quantity += event.value;
                    this.quantityByDate.push({ timestamp: event.date, value: quantity });
                    break;
                case EventType.Sell:
                    quantity -= event.value;
                    this.quantityByDate.push({ timestamp: event.date, value: quantity });
                    break;
            }
        });
    }

    getQuantity(date: DateInt = getDateInt(new Date())): number {
        // return the value of the biggest quantityByDate smaller than date, or 0
        //
        return this.quantityByDate.findLast((q) => q.timestamp <= date)?.value ?? 0;
    }

    getRealized(date: DateInt = getDateInt(new Date())): number {
        return this.realizedByDate.findLast((q) => q.timestamp <= date)?.value ?? 0;
    }

    getCost(date: DateInt = getDateInt(new Date())): number {
        return this.transactions
            .filter((tx) => getDateInt(tx.transactionDate) <= date)
            .reduce(
                (cost, tx) =>
                    tx.type === "SELL"
                        ? cost - tx.pricePerShare * tx.quantity
                        : cost + tx.pricePerShare * tx.quantity,
                0,
            );
    }

    getChartDataPoint(date: DateInt): ChartDataPoint {
        return {
            date: getDateString(date),
            valuation: getPrice(this.assetInfo, date) * this.getQuantity(date),
            invested: this.getCost(date),
            realized: this.getRealized(date),
        };
    }
}

/**
 * Aggregates chart data points for the given assets over a specified days.
 * NOTE: this assumes that chartDays[], and all assets[][] arrays are the same length, and that all
 * elements in index `i` refer to the same date.
 */
function aggregateChartData(chartDays: DateInt[], assets: AssetData[]): ChartDataPoint[] {
    const chartData: ChartDataPoint[] = [];
    for (let i = 0; i < chartDays.length; i++) {
        const datapoint = {
            date: getDateString(chartDays[i]),
            valuation: 0,
            invested: 0,
            realized: 0,
        };
        for (const asset of assets) {
            const history = asset.history[i];
            datapoint.valuation += history.valuation;
            datapoint.invested += history.invested;
            datapoint.realized += history.realized;
        }
        chartData.push(datapoint);
    }
    return chartData;
}
