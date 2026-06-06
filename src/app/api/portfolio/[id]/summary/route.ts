import { auth } from "@/auth";
import { getPortfolioSummary } from "@/lib/portfolio";
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

  try {
    const summary = await getPortfolioSummary(id, displayCurrency);
    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Error generating portfolio summary:", error);
    return NextResponse.json({ error: error.message || "Failed to load summary" }, { status: 500 });
  }
}
