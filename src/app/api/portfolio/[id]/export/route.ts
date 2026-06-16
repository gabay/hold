import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Transaction } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    try {
        const transactions = await db.transaction.findMany({
            where: { portfolioId: id },
            orderBy: { transactionDate: "asc" },
        });

        // Generate CSV contents
        const headers = "symbol,type,quantity,pricePerShare,currency,transactionDate\n";
        const rows = transactions
            .map(
                (tx: Transaction) =>
                    `"${tx.symbol}","${tx.type}",${tx.quantity},${tx.pricePerShare},"${tx.currency}","${tx.transactionDate.toISOString()}"`,
            )
            .join("\n");

        const csvContent = headers + rows;

        return new Response(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="portfolio_export_${id}.csv"`,
            },
        });
    } catch (error: unknown) {
        console.error("Error exporting portfolio:", error);
        return NextResponse.json({ error: "Failed to export transactions" }, { status: 500 });
    }
}
