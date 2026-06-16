import { auth } from "@/auth";
import { getPortfolioData } from "@/lib/portfolio";
import { parseDays as getDates } from "@/lib/util";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const currency = searchParams.get("currency") || "USD";
    const chartDates = await getDates(id, searchParams.get("days") || "30");
    try {
        return NextResponse.json(await getPortfolioData(id, currency, chartDates));
    } catch (error: unknown) {
        console.error("Error generating portfolio data:", error);
        const message = (error as Error).message || "Failed to load data";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
