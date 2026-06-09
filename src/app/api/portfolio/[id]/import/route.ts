import { auth } from "@/auth";
import { db } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 1) {
            return NextResponse.json({ error: "Empty CSV file" }, { status: 400 });
        }

        const headers = lines[0]
            .toLowerCase()
            .split(",")
            .map((h) => h.replace(/"/g, "").trim());

        // Find column indexes
        const symbolIdx = headers.indexOf("symbol");
        const typeIdx = headers.indexOf("type");
        const quantityIdx = headers.indexOf("quantity");
        const priceIdx =
            headers.indexOf("pricepershare") !== -1
                ? headers.indexOf("pricepershare")
                : headers.indexOf("price");
        const currencyIdx = headers.indexOf("currency");
        const dateIdx =
            headers.indexOf("transactiondate") !== -1
                ? headers.indexOf("transactiondate")
                : headers.indexOf("date");

        if (symbolIdx === -1 || typeIdx === -1 || quantityIdx === -1 || priceIdx === -1) {
            return NextResponse.json(
                {
                    error: "Required columns missing. Expected header containing at least: symbol, type, quantity, pricePerShare",
                },
                { status: 400 },
            );
        }

        const newTransactions: any[] = [];

        // Parse all rows first
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(",").map((cell) => cell.replace(/"/g, "").trim());
            if (row.length < 4) continue; // Skip incomplete lines

            const symbol = row[symbolIdx].toUpperCase();
            const type = row[typeIdx].toUpperCase();
            const quantity = parseFloat(row[quantityIdx]);
            const pricePerShare = parseFloat(row[priceIdx]);
            const currency =
                currencyIdx !== -1 && row[currencyIdx]
                    ? row[currencyIdx].toUpperCase().trim()
                    : null;
            const transactionDate =
                dateIdx !== -1 && row[dateIdx] ? new Date(row[dateIdx]) : new Date();

            if (isNaN(quantity) || isNaN(pricePerShare) || (type !== "BUY" && type !== "SELL")) {
                return NextResponse.json(
                    { error: `Invalid numeric or action data at row ${i + 1}` },
                    { status: 400 },
                );
            }

            if (currency && !SUPPORTED_CURRENCIES[currency]) {
                return NextResponse.json(
                    { error: `Unsupported currency "${currency}" at row ${i + 1}` },
                    { status: 400 },
                );
            }

            newTransactions.push({
                portfolioId: id,
                symbol,
                type,
                quantity,
                pricePerShare,
                currency: currency || null,
                transactionDate,
            });
        }

        // Insert all in a transaction
        await db.$transaction(newTransactions.map((tx) => db.transaction.create({ data: tx })));

        return NextResponse.json({ success: true, count: newTransactions.length });
    } catch (error: any) {
        console.error("Error importing transactions:", error);
        return NextResponse.json(
            { error: error.message || "Failed to import transactions" },
            { status: 500 },
        );
    }
}
