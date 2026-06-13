import { db } from "./db";

export type DateInt = number;

export async function getDays(id: string, days: string): Promise<number> {
    if (days === "ytd") {
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const diffTime = Math.abs(now.getTime() - startOfYear.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    if (days === "max") {
        const firstTx = await db.transaction.findFirst({
            where: { portfolioId: id },
            orderBy: { transactionDate: "asc" },
        });
        if (!firstTx) {
            return 30;
        }
        const diffTime = Math.abs(
            new Date().getTime() - new Date(firstTx.transactionDate).getTime(),
        );
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    return parseInt(days, 10) || 30;
}

export function getDateInts(days: number): DateInt[] {
    const dates: DateInt[] = [];
    const today = getDateInt(new Date());
    while (days >= 0) {
        dates.push(today - days * 24 * 60 * 60 * 1000);
        days--;
    }
    return dates;
}

export function getDateInt(date: Date | DateInt = new Date()): DateInt {
    return new Date(date).setHours(0, 0, 0, 0);
}

export function addDays(date: Date | DateInt, days: number): DateInt {
    return getDateInt(date) + days * 24 * 60 * 60 * 1000;
}

export function getDateString(date: Date | DateInt = new Date()): string {
    return new Date(date).toISOString().split("T")[0];
}
