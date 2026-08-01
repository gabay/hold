import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cache,
    convertCurrency,
    getExchangeRate,
    getExchangeRates,
    getValueAroundDate,
} from "../lib/finance";
import { addDays, getDate, getDateInt, getDateString } from "../lib/util";

global.fetch = vi.fn();

vi.mock("../lib/db", () => ({
    db: {
        stockPrice: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            upsert: vi.fn().mockResolvedValue(undefined),
        },
        exchangeRate: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            upsert: vi.fn().mockResolvedValue(undefined),
        },
        $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
}));

import { db } from "../lib/db";

describe("Finance Module", () => {
    beforeEach(() => {
        cache.flushAll();
        vi.clearAllMocks();
    });

    // Some tests override the default (empty) db mock implementations; restore
    // them so that override doesn't leak into unrelated tests.
    afterEach(() => {
        vi.mocked(db).exchangeRate.findFirst.mockReset().mockResolvedValue(null);
        vi.mocked(db).exchangeRate.findMany.mockReset().mockResolvedValue([]);
    });

    describe("getValueAroundDate", () => {
        it("should return exact price when available", () => {
            const date = getDateInt();
            const values = new Map([[date, 150]]);
            expect(getValueAroundDate(values, date)).toBe(150);
        });

        it("should look back up to 4 days for price", () => {
            const baseDate = getDateInt();
            const values = new Map([[addDays(baseDate, -4), 148]]);
            expect(getValueAroundDate(values, baseDate)).toBe(148);
        });

        it("should look forward up to 2 days for price", () => {
            const baseDate = getDateInt();
            const values = new Map([[addDays(baseDate, 2), 151]]);
            expect(getValueAroundDate(values, baseDate)).toBe(151);
        });

        it("should return undefined when no prices provided", () => {
            expect(getValueAroundDate(undefined, getDateInt())).toBe(undefined);
        });

        it("should return undefined when no price found", () => {
            expect(getValueAroundDate(new Map(), getDateInt())).toBe(undefined);
        });

        it("should return undefined when no value in range", () => {
            const baseDate = getDateInt();
            const values = new Map([
                [addDays(baseDate, -5), 148],
                [addDays(baseDate, 3), 152],
            ]);

            // Should return undefined when no value in range
            expect(getValueAroundDate(values, baseDate)).toBe(undefined);
        });

        it("should prioritize exact date over nearby dates", () => {
            const baseDate = getDateInt();
            const values = new Map([
                [baseDate, 150],
                [addDays(baseDate, -1), 149],
                [addDays(baseDate, 1), 151],
            ]);

            expect(getValueAroundDate(values, baseDate)).toBe(150);
        });

        it("should respect search order: back 4 days, then forward 2 days", () => {
            const baseDate = getDateInt();
            const values = new Map([
                [addDays(baseDate, -4), 148],
                [addDays(baseDate, 1), 152],
            ]);

            // Should find -3 before finding +2
            expect(getValueAroundDate(values, baseDate)).toBe(148);
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

            const result = await convertCurrency(100, "EUR", "USD", date);
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

            const rate = await getExchangeRate("EUR", "USD", date);
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

            const rate1 = await getExchangeRate("EUR", "USD", date);
            const rate2 = await getExchangeRate("EUR", "USD", date);

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

            await expect(getExchangeRate("EUR", "USD", date)).rejects.toThrow("No exchange rate");
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

            const rate = await getExchangeRate("EUR", "USD", date);
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

        it("should derive the opposite direction from cache without refetching", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const dateStr = getDateString(date);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: dateStr, rate: 0.92 }],
            } as Response);

            // EUR sorts before USD, so USD->EUR is fetched/cached as EUR->USD...
            await getExchangeRates("USD", "EUR", date);
            // ...and this call reuses that same cache entry, just flipped.
            const reversed = await getExchangeRates("EUR", "USD", date);

            expect(reversed?.baseCurrency).toBe("EUR");
            expect(reversed?.rates.get(getDateInt(date))).toBeCloseTo(0.92, 2);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should always store rates with currencies in alphabetical order, and look up only that direction", async () => {
            const mockFetch = vi.mocked(global.fetch);
            const date = getDate();
            const mockDb = vi.mocked(db);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: getDateString(date), rate: 0.92 }],
            } as Response);

            // USD > EUR alphabetically, so even though USD is requested as the
            // base, it must be fetched and stored as EUR -> USD.
            const result = await getExchangeRates("USD", "EUR", date);

            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("base=EUR&quotes=USD"));
            expect(mockDb.exchangeRate.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ baseCurrency: "EUR", targetCurrency: "USD" }),
                }),
            );
            expect(result?.baseCurrency).toBe("USD");
            expect(result?.rates.get(getDateInt(date))).toBeCloseTo(1 / 0.92, 5);

            // A fresh (uncached) lookup in the canonical direction only needs to
            // check that one direction, not both.
            cache.flushAll();
            mockDb.exchangeRate.findFirst.mockClear();
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ date: getDateString(date), rate: 0.92 }],
            } as Response);

            await getExchangeRates("EUR", "USD", date);

            expect(mockDb.exchangeRate.findFirst).toHaveBeenCalledTimes(1);
            expect(mockDb.exchangeRate.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ baseCurrency: "EUR", targetCurrency: "USD" }),
                }),
            );
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
