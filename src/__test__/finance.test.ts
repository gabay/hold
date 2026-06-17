import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    cache,
    convertCurrency,
    getExchangeRate,
    getExchangeRates,
    getPrice,
    type AssetInfo,
} from "../lib/finance";
import { addDays, getDate, getDateInt, getDateString } from "../lib/util";

global.fetch = vi.fn();

describe("Finance Module", () => {
    beforeEach(() => {
        cache.flushAll();
        vi.clearAllMocks();
    });

    describe("getPrice", () => {
        it("should return exact price when available", () => {
            const date = getDateInt();
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices: new Map([[date, 150]]),
            };

            expect(getPrice(assetInfo, date)).toBe(150);
        });

        it("should look back up to 4 days for price", () => {
            const baseDate = getDateInt();
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices: new Map([[addDays(baseDate, -2), 148]]),
            };

            expect(getPrice(assetInfo, baseDate)).toBe(148);
        });

        it("should look forward up to 2 days for price", () => {
            const baseDate = getDateInt();
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices: new Map([[addDays(baseDate, 1), 151]]),
            };

            expect(getPrice(assetInfo, baseDate)).toBe(151);
        });

        it("should return 0 when no price found", () => {
            const baseDate = getDateInt();
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices: new Map(),
            };

            expect(getPrice(assetInfo, baseDate)).toBe(0);
        });

        it("should prioritize exact date over nearby dates", () => {
            const baseDate = getDateInt();
            const prices = new Map([
                [baseDate, 150],
                [addDays(baseDate, -1), 149],
                [addDays(baseDate, 1), 151],
            ]);
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices,
            };

            expect(getPrice(assetInfo, baseDate)).toBe(150);
        });

        it("should respect search order: back 4 days, then forward 2 days", () => {
            const baseDate = getDateInt();
            const assetInfo: AssetInfo = {
                symbol: "AAPL",
                name: "Apple",
                currency: "USD",
                price: 150,
                fromDate: getDate(),
                prices: new Map([
                    [addDays(baseDate, -3), 148],
                    [addDays(baseDate, 2), 152],
                ]),
            };

            // Should find -3 before finding +2
            expect(getPrice(assetInfo, baseDate)).toBe(148);
        });
    });

    describe("convertCurrency", () => {
        it("should return same amount when currencies are identical", async () => {
            const result = await convertCurrency(100, "USD", "USD", getDate());
            expect(result).toBe(100);
        });

        it("should convert currency using exchange rates", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const result = await convertCurrency(100, "USD", "EUR", date);
            expect(result).toBeCloseTo(92, 1);
        });
    });

    describe("getExchangeRate", () => {
        it("should fetch exchange rate for a specific date", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const rate = await getExchangeRate("USD", "EUR", date);
            expect(rate).toBeCloseTo(0.92, 2);
        });

        it("should use cached exchange rates", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const rate1 = await getExchangeRate("USD", "EUR", date);
            const rate2 = await getExchangeRate("USD", "EUR", date);

            expect(rate1).toBeCloseTo(rate2, 2);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should throw error when exchange rate not found", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            } as Response);

            await expect(getExchangeRate("USD", "EUR", date)).rejects.toThrow("No exchange rate");
        });

        it("should look back 1 day if current day rate not found", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const prevDate = getDate(addDays(getDateInt(date), -1));
            const prevDateStr = getDateString(prevDate);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: prevDateStr, rate: 0.92 }],
            } as Response);

            const rate = await getExchangeRate("USD", "EUR", date);
            expect(rate).toBeCloseTo(0.92, 2);
        });
    });

    describe("getExchangeRates", () => {
        it("should return undefined for same currency", async () => {
            const result = await getExchangeRates("USD", "USD", getDate());
            expect(result).toBeUndefined();
        });

        it("should fetch exchange rates from API", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const rates = await getExchangeRates("USD", "EUR", date);
            expect(rates?.baseCurrency).toBe("USD");
            expect(rates?.targetCurrency).toBe("EUR");
            expect(rates?.rates.size).toBeGreaterThan(0);
        });

        it("should cache exchange rates", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const rates1 = await getExchangeRates("USD", "EUR", date);
            const rates2 = await getExchangeRates("USD", "EUR", date);

            expect(rates1?.rates).toEqual(rates2?.rates);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should use reverse cache when available", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            await getExchangeRates("USD", "EUR", date);
            const reversed = await getExchangeRates("EUR", "USD", date);

            expect(reversed?.baseCurrency).toBe("EUR");
            expect(reversed?.rates.get(getDateInt(date))).toBeCloseTo(1 / 0.92, 2);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should handle API errors gracefully", async () => {
            const mockFetch = vi.mocked(global.fetch);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                statusText: "Not Found",
            } as Response);

            await expect(getExchangeRates("USD", "EUR", getDate())).rejects.toThrow();
        });

        it("should use fromDate parameter correctly", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);
            const olderDate = getDate(addDays(getDateInt(date), -30));

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            const rates = await getExchangeRates("USD", "EUR", olderDate);
            expect(rates?.fromDate).toEqual(olderDate);
        });
    });

    describe("cache usage", () => {
        it("should skip API call when cached data is recent enough", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const oldDate = getDate(addDays(getDateInt(getDate()), -100));
            const dateStr = getDateString(oldDate);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            // First call fetches
            await getExchangeRates("USD", "EUR", oldDate);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Second call should use cache (fromDate is equal)
            await getExchangeRates("USD", "EUR", oldDate);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should fetch again when cached data is older than requested date", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const oldDate = getDate(addDays(getDateInt(getDate()), -100));
            const newDate = getDate(addDays(getDateInt(getDate()), -50));
            const dateStr = getDateString(oldDate);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            // Cache with old date
            await getExchangeRates("USD", "EUR", oldDate);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Clear cache and mock again
            cache.flushAll();
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            // Request with newer date should fetch again
            await getExchangeRates("USD", "EUR", newDate);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });
});
