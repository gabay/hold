import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
        const headers = "symbol,type,quantity,pricePerShare,currency,fee,transactionDate\n";
        const rows = transactions
            .map(
                (tx: any) =>
                    `"${tx.symbol}","${tx.type}",${tx.quantity},${tx.pricePerShare},"${tx.currency}",${tx.fee},"${tx.transactionDate.toISOString()}"`,
            )
            .join("\n");

        const csvContent = headers + rows;

        return new Response(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="portfolio_${id}_export.csv"`,
            },
        });
    } catch (error: any) {
        console.error("Error exporting portfolio:", error);
        return NextResponse.json({ error: "Failed to export transactions" }, { status: 500 });
    }
}
