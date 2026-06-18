import { db } from "./db";

export type DateInt = number;

export async function parseDays(id: string, days: string): Promise<Date[]> {
    const end = getDate();
    if (days === "ytd") {
        return expandDays(makeDate(end.getUTCFullYear(), 0, 1), end);
    }
    else if (days === "max") {
        const firstTx = await db.transaction.findFirst({
            where: { portfolioId: id },
            orderBy: { transactionDate: "asc" },
        });
        if (firstTx) {
            const start = getDate(firstTx.transactionDate);
            start.setDate(start.getDate() - 1);
            return expandDays(start, end);
        }
    }
    const daysNumber = parseInt(days, 10) || 30;
    const start = getDate(end);
    start.setUTCDate(end.getUTCDate() - daysNumber);
    return expandDays(start, end);
}

function expandDays(start: Date, end: Date): Date[] {
    const dates = [];
    while (start <= end) {
        dates.push(getDate(start));
        start.setUTCDate(start.getUTCDate() + 1);
    }
    return dates;
}

export function getDateInt(date: Date = getDate()): DateInt {
    return new Date(date).setUTCHours(0, 0, 0, 0);
}

export function addDays(date: DateInt, days: number): DateInt {
    return date + days * 24 * 60 * 60 * 1000;
}

export function getDateString(date: string | Date = getDate()): string {
    const dateString = date instanceof Date ? date.toISOString() : date;
    return dateString.split("T")[0];
}

export function getDate(date: number | string | Date = new Date()): Date {
    const newDate = new Date(date)
    newDate.setUTCHours(0, 0, 0, 0);
    return newDate;
}

export function makeDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month, day));
}
