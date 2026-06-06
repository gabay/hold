import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getPortfolioHistory } from "@/lib/portfolio";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const displayCurrency = searchParams.get("currency") || "USD";
  const range = searchParams.get("days") || "30";
  
  let days = 30;
  if (range === "ytd") {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const diffTime = Math.abs(now.getTime() - startOfYear.getTime());
    days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  } else if (range === "max") {
    const firstTx = await db.transaction.findFirst({
      where: { portfolioId: id },
      orderBy: { transactionDate: "asc" },
    });
    if (firstTx) {
      const diffTime = Math.abs(new Date().getTime() - new Date(firstTx.transactionDate).getTime());
      days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    } else {
      days = 30;
    }
  } else {
    days = parseInt(range, 10) || 30;
  }

  try {
    const history = await getPortfolioHistory(id, displayCurrency, days);
    return NextResponse.json(history);
  } catch (error: any) {
    console.error("Error generating portfolio history:", error);
    return NextResponse.json({ error: error.message || "Failed to load history" }, { status: 500 });
  }
}
