import { auth } from "@/auth";
import { db, checkUserPortfolioTransaction } from "@/lib/db";
import { getAssetInfo } from "@/lib/finance";
import { CURRENCIES } from "@/lib/currencies";
import { NextRequest, NextResponse } from "next/server";
import { getDate } from "@/lib/util";

export async function PUT(
    req: NextRequest,
    ctx: { params: Promise<{ id: string; txid: string }> },
) {
    const session = await auth();
    const { id, txid } = await ctx.params;
    if (
        !session ||
        !session.user?.id ||
        !(await checkUserPortfolioTransaction(session.user.id, id, txid))
    ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { symbol, type, quantity, pricePerShare, currency, transactionDate } = body;

        if (!symbol || !type || !quantity || !pricePerShare) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (type !== "BUY" && type !== "SELL") {
            return NextResponse.json(
                { error: "Invalid type. Must be BUY or SELL." },
                { status: 400 },
            );
        }

        if (currency && !CURRENCIES[currency]) {
            return NextResponse.json(
                { error: `Unsupported currency "${currency}"` },
                { status: 400 },
            );
        }

        // Validate symbol exists.
        try {
            await getAssetInfo(symbol);
        } catch (error: unknown) {
            return NextResponse.json(
                { error: `Error validating symbol "${symbol}": ${(error as Error).message || ""}` },
                { status: 400 },
            );
        }

        const transaction = await db.transaction.update({
            where: { portfolioId: id, id: txid },
            data: {
                symbol: symbol.toUpperCase(),
                type,
                quantity: parseFloat(quantity),
                pricePerShare: parseFloat(pricePerShare),
                currency: currency,
                transactionDate: getDate(transactionDate),
            },
        });

        return NextResponse.json(transaction);
    } catch (error: unknown) {
        console.error("Error updating transaction:", error);
        return NextResponse.json(
            { error: (error as Error).message || "Failed to update transaction" },
            { status: 500 },
        );
    }
}

export async function DELETE(
    req: NextRequest,
    ctx: { params: Promise<{ id: string; txid: string }> },
) {
    const session = await auth();
    const { id, txid } = await ctx.params;
    if (
        !session ||
        !session.user?.id ||
        !(await checkUserPortfolioTransaction(session.user.id, id, txid))
    ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await db.transaction.delete({
            where: { portfolioId: id, id: txid },
        });
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error("Error deleting transaction:", error);
        return NextResponse.json(
            { error: (error as Error).message || "Failed to delete transaction" },
            { status: 500 },
        );
    }
}
