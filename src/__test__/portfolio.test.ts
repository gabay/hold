import { describe, it, expect, beforeEach, vi } from "vitest";
import { Transaction } from "@prisma/client";
import { getPortfolioData, AssetDataCalculator } from "../lib/portfolio";
import { getDate, getDateInt, getDateString, addDays } from "../lib/util";
import type { AssetInfo } from "../lib/finance";

// Mock dependencies
vi.mock("../lib/db", () => ({
    db: {
        portfolio: {
            findUnique: vi.fn(),
        },
        transaction: {
            findMany: vi.fn(),
        },
    },
}));

vi.mock("../lib/finance", () => ({
    getAssetInfo: vi.fn(),
    getExchangeRate: vi.fn(),
    getPrice: vi.fn(),
}));

import { db } from "../lib/db";
import { getAssetInfo, getPrice } from "../lib/finance";

describe("Portfolio Module", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("AssetDataCalculator", () => {
        const createMockAssetInfo = (overrides?: Partial<AssetInfo>): AssetInfo => ({
            symbol: "AAPL",
            name: "Apple",
            currency: "USD",
            price: 150,
            fromDate: getDate(),
            prices: new Map(),
            dividends: new Map(),
            splits: new Map(),
            ...overrides,
        });

        const createMockTransaction = (overrides?: Partial<Transaction>): Transaction => {
            const baseDate = getDate();
            return {
                id: "1",
                portfolioId: "portfolio-1",
                symbol: "AAPL",
                type: "BUY" as const,
                quantity: 10,
                pricePerShare: 100,
                currency: "USD",
                transactionDate: baseDate,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...overrides,
            };
        };

        describe("quantity calculation", () => {
            it("should calculate initial quantity from buy transactions", () => {
                const transactions = [
                    createMockTransaction({ quantity: 10 }),
                    createMockTransaction({ id: "2", quantity: 5 }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity()).toBe(15);
            });

            it("should handle sell transactions", () => {
                const baseDate = getDate();
                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                    createMockTransaction({
                        id: "2",
                        quantity: 3,
                        type: "SELL" as const,
                        transactionDate: baseDate,
                    }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity()).toBe(7);
            });

            it("should apply stock splits to quantity", () => {
                const baseDate = getDate();
                const splitDate = addDays(getDateInt(baseDate), 5);
                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    splits: new Map([[splitDate, 2]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity(splitDate)).toBe(20);
            });

            it("should apply splits only to past transactions", () => {
                const baseDate = getDate();
                const beforeSplit = addDays(getDateInt(baseDate), 3);
                const splitDate = addDays(getDateInt(baseDate), 5);
                const afterSplit = addDays(getDateInt(baseDate), 7);

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    splits: new Map([[splitDate, 2]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity(beforeSplit)).toBe(10);
                expect(calculator.getQuantity(afterSplit)).toBe(20);
            });

            it("should get quantity at specific date", () => {
                const baseDate = getDate();
                const date1 = getDate(addDays(getDateInt(baseDate), 1));
                const date2 = getDate(addDays(getDateInt(baseDate), 3));

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                    createMockTransaction({
                        id: "2",
                        quantity: 5,
                        transactionDate: date1,
                    }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity(getDateInt(baseDate))).toBe(10);
                expect(calculator.getQuantity(getDateInt(date1))).toBe(15);
                expect(calculator.getQuantity(getDateInt(date2))).toBe(15);
            });
        });

        describe("cost calculation", () => {
            it("should sum buy transactions as cost", () => {
                const transactions = [
                    createMockTransaction({ quantity: 10, pricePerShare: 100 }),
                    createMockTransaction({ id: "2", quantity: 5, pricePerShare: 110 }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getCost()).toBe(10 * 100 + 5 * 110);
            });

            it("should handle sell transaction costs", () => {
                const baseDate = getDate();
                const transactions = [
                    createMockTransaction({
                        quantity: 10,
                        pricePerShare: 100,
                        transactionDate: baseDate,
                    }),
                    createMockTransaction({
                        id: "2",
                        quantity: 5,
                        pricePerShare: 120,
                        type: "SELL" as const,
                        transactionDate: baseDate,
                    }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                // Cost: buy 10@100 - sell 5@120 = 1000 - 600 = 400
                expect(calculator.getCost()).toBe(400);
            });

            it("should get cost at specific date", () => {
                const baseDate = getDate();
                const date1 = getDate(addDays(getDateInt(baseDate), 1));
                const date2 = getDate(addDays(getDateInt(baseDate), 3));

                const transactions = [
                    createMockTransaction({
                        quantity: 10,
                        pricePerShare: 100,
                        transactionDate: baseDate,
                    }),
                    createMockTransaction({
                        id: "2",
                        quantity: 5,
                        pricePerShare: 110,
                        transactionDate: date1,
                    }),
                ];
                const assetInfo = createMockAssetInfo();

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getCost(getDateInt(baseDate))).toBe(1000);
                expect(calculator.getCost(getDateInt(date1))).toBe(1550);
                expect(calculator.getCost(getDateInt(date2))).toBe(1550);
            });
        });

        describe("realized profit calculation", () => {
            it("should calculate realized profit from dividends", () => {
                const baseDate = getDate();
                const dividendDate = addDays(getDateInt(baseDate), 5);

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    dividends: new Map([[dividendDate, 1]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getRealized(dividendDate)).toBe(10);
            });

            it("should only apply dividends after purchase", () => {
                const baseDate = getDate();
                const beforeDate = addDays(getDateInt(baseDate), -5);
                const dividendDate = addDays(getDateInt(baseDate), 5);

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    dividends: new Map([[dividendDate, 1]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getRealized(beforeDate)).toBe(0);
                expect(calculator.getRealized(dividendDate)).toBe(10);
            });

            it("should apply multiple dividends", () => {
                const baseDate = getDate();
                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    dividends: new Map([
                        [addDays(getDateInt(baseDate), 5), 1],
                        [addDays(getDateInt(baseDate), 35), 1],
                        [addDays(getDateInt(baseDate), 65), 1],
                    ]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getRealized(addDays(getDateInt(baseDate), 100))).toBe(30);
            });
        });

        describe("event ordering", () => {
            it("should apply splits before dividends on same day", () => {
                const baseDate = getDate();
                const eventDate = addDays(getDateInt(baseDate), 5);

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                ];
                const assetInfo = createMockAssetInfo({
                    splits: new Map([[eventDate, 2]]),
                    dividends: new Map([[eventDate, 1]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getRealized(eventDate)).toBe(20);
            });

            it("should apply transactions after splits and dividends on same day", () => {
                const baseDate = getDate();
                const eventDate = addDays(getDateInt(baseDate), 5);

                const transactions = [
                    createMockTransaction({ quantity: 10, transactionDate: baseDate }),
                    createMockTransaction({
                        id: "2",
                        quantity: 5,
                        transactionDate: getDate(eventDate),
                    }),
                ];
                const assetInfo = createMockAssetInfo({
                    splits: new Map([[eventDate, 2]]),
                });

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                expect(calculator.getQuantity(eventDate)).toBe(25);
            });
        });

        describe("chart data generation", () => {
            it("should generate chart data point for a date", () => {
                const baseDate = getDate();
                const transactions = [
                    createMockTransaction({
                        quantity: 10,
                        pricePerShare: 100,
                        transactionDate: baseDate,
                    }),
                ];
                const assetInfo = createMockAssetInfo({
                    price: 150,
                    prices: new Map([[getDateInt(baseDate), 150]]),
                });

                const mockGetPrice = vi.mocked(getPrice);
                mockGetPrice.mockReturnValue(150);

                const calculator = new AssetDataCalculator(transactions, assetInfo);
                const dataPoint = calculator.getChartDataPoint(baseDate);

                expect(dataPoint.date).toBe(getDateString(baseDate));
                expect(dataPoint.valuation).toBe(1500);
                expect(dataPoint.invested).toBe(1000);
                expect(dataPoint.realized).toBe(0);
            });
        });
    });

    describe("getPortfolioData", () => {
        const mockDb = vi.mocked(db);
        const mockGetAssetInfo = vi.mocked(getAssetInfo);
        const mockGetPrice = vi.mocked(getPrice);

        const createMockPortfolio = () => ({
            id: "portfolio-1",
            userId: "user-1",
            name: "My Portfolio",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        it("should throw error when portfolio not found", async () => {
            mockDb.portfolio.findUnique.mockResolvedValue(null);

            await expect(getPortfolioData("invalid-id")).rejects.toThrow("Portfolio not found");
        });

        it("should aggregate portfolio data from multiple assets", async () => {
            const baseDate = getDate();
            mockDb.portfolio.findUnique.mockResolvedValue(createMockPortfolio());
            mockDb.transaction.findMany.mockResolvedValue([
                {
                    id: "1",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 100,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "2",
                    portfolioId: "portfolio-1",
                    symbol: "GOOGL",
                    type: "BUY" as const,
                    quantity: 5,
                    pricePerShare: 140,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            mockGetAssetInfo.mockImplementation(async (symbol: string, date: Date) => {
                if (symbol === "AAPL") {
                    return {
                        symbol: "AAPL",
                        name: "Apple",
                        currency: "USD",
                        price: 150,
                        fromDate: date,
                        prices: new Map([[getDateInt(baseDate), 150]]),
                    } as AssetInfo;
                } else {
                    return {
                        symbol: "GOOGL",
                        name: "Google",
                        currency: "USD",
                        price: 200,
                        fromDate: date,
                        prices: new Map([[getDateInt(baseDate), 200]]),
                    } as AssetInfo;
                }
            });

            mockGetPrice.mockReturnValue(150);

            const result = await getPortfolioData("portfolio-1", "USD");

            expect(result.portfolioId).toBe("portfolio-1");
            expect(result.name).toBe("My Portfolio");
            expect(result.summary.assets).toHaveLength(2);
            expect(result.summary.currency).toBe("USD");
        });

        it("should handle empty portfolio", async () => {
            mockDb.portfolio.findUnique.mockResolvedValue(createMockPortfolio());
            mockDb.transaction.findMany.mockResolvedValue([]);

            const result = await getPortfolioData("portfolio-1", "USD");

            expect(result.summary.assets).toHaveLength(0);
            expect(result.summary.totalCost).toBe(0);
            expect(result.summary.totalValue).toBe(0);
        });

        it("should calculate profit metrics correctly", async () => {
            const baseDate = getDate();
            mockDb.portfolio.findUnique.mockResolvedValue(createMockPortfolio());
            mockDb.transaction.findMany.mockResolvedValue([
                {
                    id: "1",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 100,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            mockGetAssetInfo.mockResolvedValue({
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: baseDate,
                prices: new Map([[getDateInt(baseDate), 150]]),
            } as AssetInfo);

            mockGetPrice.mockReturnValue(150);

            const result = await getPortfolioData("portfolio-1", "USD");

            const summary = result.summary;
            expect(summary.totalCost).toBe(1000);
            expect(summary.totalValue).toBe(1500);
            expect(summary.totalProfit).toBe(500);
            expect(summary.totalProfitPercentage).toBeCloseTo(50, 1);
        });

        it("should generate chart data for specified dates", async () => {
            const baseDate = getDate();
            const chartDate = getDate(addDays(getDateInt(baseDate), 1));
            mockDb.portfolio.findUnique.mockResolvedValue(createMockPortfolio());
            mockDb.transaction.findMany.mockResolvedValue([
                {
                    id: "1",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 100,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            mockGetAssetInfo.mockResolvedValue({
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: baseDate,
                prices: new Map([[getDateInt(baseDate), 150]]),
            } as AssetInfo);

            mockGetPrice.mockReturnValue(150);

            const chartDays = [chartDate];
            const result = await getPortfolioData("portfolio-1", "USD", chartDays);

            expect(result.history).toHaveLength(1);
            expect(result.history[0].date).toBe(getDateString(chartDate));
        });

        it("should return transactions in reverse order", async () => {
            const baseDate = getDate();
            const date1 = getDate(addDays(getDateInt(baseDate), 1));
            const date2 = getDate(addDays(getDateInt(baseDate), 2));

            mockDb.portfolio.findUnique.mockResolvedValue(createMockPortfolio());
            mockDb.transaction.findMany.mockResolvedValue([
                {
                    id: "1",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 100,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "2",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 5,
                    pricePerShare: 110,
                    currency: "USD",
                    transactionDate: date1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "3",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 3,
                    pricePerShare: 120,
                    currency: "USD",
                    transactionDate: date2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            mockGetAssetInfo.mockResolvedValue({
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: baseDate,
                prices: new Map(),
            } as AssetInfo);

            const result = await getPortfolioData("portfolio-1", "USD");

            expect(result.transactions[0].id).toBe("3");
            expect(result.transactions[1].id).toBe("2");
            expect(result.transactions[2].id).toBe("1");
        });

        it("should calculate average buy price correctly", async () => {
            const baseDate = getDate();
            const date1 = getDate(addDays(getDateInt(baseDate), 1));

            mockDb.portfolio.findUnique.mockResolvedValue({
                id: "portfolio-1",
                userId: "user-1",
                name: "Test",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mockDb.transaction.findMany.mockResolvedValue([
                {
                    id: "1",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 100,
                    currency: "USD",
                    transactionDate: baseDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "2",
                    portfolioId: "portfolio-1",
                    symbol: "AAPL",
                    type: "BUY" as const,
                    quantity: 10,
                    pricePerShare: 120,
                    currency: "USD",
                    transactionDate: date1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            mockGetAssetInfo.mockResolvedValue({
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: baseDate,
                prices: new Map(),
            } as AssetInfo);

            mockGetPrice.mockReturnValue(150);

            const result = await getPortfolioData("portfolio-1", "USD");
            const assetData = result.summary.assets[0];

            // With 20 total shares and 2200 total cost, avg is 110
            // But since we have only 1 asset and 20 shares at 2200 cost:
            // avgBuyPrice = cost / quantity = 2200 / 20 = 110
            const totalCost = result.summary.assets[0].cost;
            const totalQuantity = result.summary.assets[0].quantity;
            const expectedAvg = totalCost / totalQuantity;
            expect(assetData.avgBuyPrice).toBeCloseTo(expectedAvg, 1);
        });
    });
});
