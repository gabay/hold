import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export async function checkUserPortfolioTransaction(
    userId: string,
    portfolioId: string,
    transactionId: string,
): Promise<boolean> {
    const transaction = await db.transaction.findUnique({
        where: {
            portfolio: {
                userId: userId,
            },
            portfolioId: portfolioId,
            id: transactionId,
        }
    });
    return transaction !== null;
}
