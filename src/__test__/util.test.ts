import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseDays, getDateInt, addDays, getDateString, getDate, makeDate } from "../lib/util";
import { db } from "../lib/db";

vi.mock("../lib/db", () => ({
    db: {
        transaction: {
            findFirst: vi.fn(),
        },
    },
}));

describe("util", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("getDate", () => {
        it("should return today's date with UTC hours set to 0", () => {
            const date = getDate();
            expect(date.getUTCHours()).toBe(0);
            expect(date.getUTCMinutes()).toBe(0);
            expect(date.getUTCSeconds()).toBe(0);
            expect(date.getUTCMilliseconds()).toBe(0);
        });

        it("should accept a Date object and reset hours", () => {
            const input = new Date("2024-06-15T14:30:45.123Z");
            const result = getDate(input);
            expect(result.getUTCHours()).toBe(0);
            expect(result.getUTCMinutes()).toBe(0);
            expect(result.getUTCSeconds()).toBe(0);
            expect(result.getUTCMilliseconds()).toBe(0);
            expect(result.getUTCFullYear()).toBe(2024);
            expect(result.getUTCMonth()).toBe(5); // June is month 5
            expect(result.getUTCDate()).toBe(15);
        });

        it("should accept an ISO string and reset hours", () => {
            const result = getDate("2024-06-15T14:30:45.123Z");
            expect(result.getUTCHours()).toBe(0);
            expect(result.getUTCDate()).toBe(15);
        });

        it("should accept a timestamp number and reset hours", () => {
            const timestamp = new Date("2024-06-15T14:30:45.123Z").getTime();
            const result = getDate(timestamp);
            expect(result.getUTCHours()).toBe(0);
            expect(result.getUTCDate()).toBe(15);
        });

        it("should handle edge cases like year boundaries", () => {
            const result = getDate("2024-01-01T23:59:59.999Z");
            expect(result.getUTCDate()).toBe(1);
            expect(result.getUTCMonth()).toBe(0);
            expect(result.getUTCFullYear()).toBe(2024);
        });
    });

    describe("makeDate", () => {
        it("should create a UTC date from year, month, day", () => {
            const result = makeDate(2024, 5, 15);
            expect(result.getUTCFullYear()).toBe(2024);
            expect(result.getUTCMonth()).toBe(5); // 0-indexed
            expect(result.getUTCDate()).toBe(15);
        });

        it("should handle January (month 0)", () => {
            const result = makeDate(2024, 0, 1);
            expect(result.getUTCMonth()).toBe(0);
            expect(result.getUTCDate()).toBe(1);
        });

        it("should handle December (month 11)", () => {
            const result = makeDate(2024, 11, 31);
            expect(result.getUTCMonth()).toBe(11);
            expect(result.getUTCDate()).toBe(31);
        });

        it("should set time to midnight UTC", () => {
            const result = makeDate(2024, 5, 15);
            expect(result.getUTCHours()).toBe(0);
            expect(result.getUTCMinutes()).toBe(0);
            expect(result.getUTCSeconds()).toBe(0);
            expect(result.getUTCMilliseconds()).toBe(0);
        });
    });

    describe("getDateInt", () => {
        it("should return a timestamp with hours set to 0", () => {
            const date = new Date("2024-06-15T14:30:45.123Z");
            const result = getDateInt(date);
            const expected = new Date("2024-06-15T00:00:00.000Z").getTime();
            expect(result).toBe(expected);
        });

        it("should use current date when no argument provided", () => {
            const result = getDateInt();
            const now = new Date();
            const expectedDate = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
            );
            expect(result).toBe(expectedDate.getTime());
        });

        it("should return a DateInt type (number)", () => {
            const result = getDateInt();
            expect(typeof result).toBe("number");
        });

        it("should be consistent across calls with the same date", () => {
            const date = new Date("2024-06-15T14:30:45.123Z");
            const result1 = getDateInt(date);
            const result2 = getDateInt(date);
            expect(result1).toBe(result2);
        });
    });

    describe("addDays", () => {
        it("should add positive days to a DateInt", () => {
            const baseDate = getDateInt(new Date("2024-06-15T00:00:00.000Z"));
            const result = addDays(baseDate, 5);
            const expected = getDateInt(new Date("2024-06-20T00:00:00.000Z"));
            expect(result).toBe(expected);
        });

        it("should subtract days when given negative number", () => {
            const baseDate = getDateInt(new Date("2024-06-15T00:00:00.000Z"));
            const result = addDays(baseDate, -5);
            const expected = getDateInt(new Date("2024-06-10T00:00:00.000Z"));
            expect(result).toBe(expected);
        });

        it("should handle 0 days", () => {
            const baseDate = getDateInt(new Date("2024-06-15T00:00:00.000Z"));
            const result = addDays(baseDate, 0);
            expect(result).toBe(baseDate);
        });

        it("should handle month boundaries", () => {
            const baseDate = getDateInt(new Date("2024-06-30T00:00:00.000Z"));
            const result = addDays(baseDate, 1);
            const expected = getDateInt(new Date("2024-07-01T00:00:00.000Z"));
            expect(result).toBe(expected);
        });

        it("should handle year boundaries", () => {
            const baseDate = getDateInt(new Date("2024-12-31T00:00:00.000Z"));
            const result = addDays(baseDate, 1);
            const expected = getDateInt(new Date("2025-01-01T00:00:00.000Z"));
            expect(result).toBe(expected);
        });

        it("should correctly calculate the millisecond offset", () => {
            const baseDate = 0; // Jan 1, 1970 UTC
            const result = addDays(baseDate, 1);
            expect(result).toBe(24 * 60 * 60 * 1000);
        });
    });

    describe("getDateString", () => {
        it("should return YYYY-MM-DD format from Date object", () => {
            const date = new Date("2024-06-15T14:30:45.123Z");
            const result = getDateString(date);
            expect(result).toBe("2024-06-15");
        });

        it("should return YYYY-MM-DD format from ISO string", () => {
            const result = getDateString("2024-06-15T14:30:45.123Z");
            expect(result).toBe("2024-06-15");
        });

        it("should handle dates at year start", () => {
            const result = getDateString(new Date("2024-01-01T00:00:00.000Z"));
            expect(result).toBe("2024-01-01");
        });

        it("should handle dates at year end", () => {
            const result = getDateString(new Date("2024-12-31T23:59:59.999Z"));
            expect(result).toBe("2024-12-31");
        });

        it("should use current date when no argument provided", () => {
            const result = getDateString();
            const now = new Date();
            const expected = now.toISOString().split("T")[0];
            expect(result).toBe(expected);
        });

        it("should handle single-digit months and days", () => {
            const result = getDateString(new Date("2024-02-05T12:00:00.000Z"));
            expect(result).toBe("2024-02-05");
        });
    });

    describe("parseDays", () => {
        it("should parse numeric string and return array of dates", async () => {
            const result = await parseDays("portfolio-1", "7");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
            expect(result[0] instanceof Date).toBe(true);
        });

        it("should use default of 30 days for invalid numeric string", async () => {
            const result = await parseDays("portfolio-1", "invalid");
            expect(result.length).toBe(31); // 30 days + 1 for inclusive range
        });

        it("should return consecutive dates with no gaps", async () => {
            const result = await parseDays("portfolio-1", "3");
            for (let i = 0; i < result.length - 1; i++) {
                const diff =
                    (result[i + 1].getTime() - result[i].getTime()) / (24 * 60 * 60 * 1000);
                expect(diff).toBe(1);
            }
        });

        it("should handle ytd (year-to-date) string", async () => {
            const result = await parseDays("portfolio-1", "ytd");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
            // First date should be January 1st of current year
            const firstDate = result[0];
            expect(firstDate.getUTCMonth()).toBe(0); // January
            expect(firstDate.getUTCDate()).toBe(1);
        });

        it("should handle max string with transaction history", async () => {
            const mockTransaction = {
                transactionDate: "2023-06-15T00:00:00.000Z",
                portfolioId: "portfolio-1",
            };
            vi.mocked(db.transaction.findFirst).mockResolvedValue(
                mockTransaction as Parameters<typeof db.transaction.findFirst>[0],
            );

            const result = await parseDays("portfolio-1", "max");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
            expect(result[0].getUTCFullYear()).toBe(2023);
        });

        it("should handle max string with no transaction history", async () => {
            vi.mocked(db.transaction.findFirst).mockResolvedValue(null);

            const result = await parseDays("portfolio-1", "max");
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(31); // Falls back to default 30 days
        });

        it("should return dates in ascending order", async () => {
            const result = await parseDays("portfolio-1", "10");
            for (let i = 0; i < result.length - 1; i++) {
                expect(result[i].getTime()).toBeLessThan(result[i + 1].getTime());
            }
        });

        it("should include both start and end dates", async () => {
            const result = await parseDays("portfolio-1", "0");
            expect(result.length).toBeGreaterThanOrEqual(1);
        });

        it("should query database with correct parameters for max", async () => {
            vi.mocked(db.transaction.findFirst).mockResolvedValue(null);

            await parseDays("my-portfolio", "max");

            expect(db.transaction.findFirst).toHaveBeenCalledWith({
                where: { portfolioId: "my-portfolio" },
                orderBy: { transactionDate: "asc" },
            });
        });

        it("should handle large day counts", async () => {
            const result = await parseDays("portfolio-1", "365");
            expect(result.length).toBe(366); // 365 days + 1 for inclusive
        });

        it("should reset hours to UTC 0 for all dates", async () => {
            const result = await parseDays("portfolio-1", "3");
            result.forEach((date) => {
                expect(date.getUTCHours()).toBe(0);
                expect(date.getUTCMinutes()).toBe(0);
                expect(date.getUTCSeconds()).toBe(0);
                expect(date.getUTCMilliseconds()).toBe(0);
            });
        });
    });
});
