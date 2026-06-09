import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getLiveAssetInfo } from "@/lib/finance";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    const transactions = await db.transaction.findMany({
        where: { portfolioId: id },
        orderBy: { transactionDate: "desc" },
    });

    const symbolToCurrency = new Map<string, string>();
    const resolvedTransactions = await Promise.all(
        transactions.map(async (tx) => {
            if (!tx.currency) {
                const symbol = tx.symbol.toUpperCase();
                let currency = symbolToCurrency.get(symbol);
                if (!currency) {
                    try {
                        const info = await getLiveAssetInfo(symbol);
                        currency = info.currency;
                        symbolToCurrency.set(symbol, currency);
                    } catch (e) {
                        currency = "USD"; // Fallback
                    }
                }
                return { ...tx, currency };
            }
            return tx;
        }),
    );

    return NextResponse.json(resolvedTransactions);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

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

        const normalizedCurrency = currency ? currency.toUpperCase().trim() : null;
        if (normalizedCurrency && !SUPPORTED_CURRENCIES[normalizedCurrency]) {
            return NextResponse.json(
                { error: `Unsupported currency "${currency}"` },
                { status: 400 },
            );
        }

        // Validate symbol and fetch its default trading currency
        let assetInfo;
        try {
            assetInfo = await getLiveAssetInfo(symbol);
        } catch (e) {
            return NextResponse.json(
                {
                    error: `Could not validate ticker symbol "${symbol}". Is it correct?`,
                },
                { status: 400 },
            );
        }

        const transaction = await db.transaction.create({
            data: {
                portfolioId: id,
                symbol: symbol.toUpperCase(),
                type,
                quantity: parseFloat(quantity),
                pricePerShare: parseFloat(pricePerShare),
                currency: normalizedCurrency,
                transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
            },
        });

        return NextResponse.json(transaction, { status: 201 });
    } catch (error: any) {
        console.error("Error creating transaction:", error);
        return NextResponse.json(
            { error: error.message || "Failed to create transaction" },
            { status: 500 },
        );
    }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    try {
        await db.transaction.deleteMany({
            where: { portfolioId: id },
        });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Error clearing transactions:", error);
        return NextResponse.json(
            { error: error.message || "Failed to clear transactions" },
            { status: 500 },
        );
    }
}
