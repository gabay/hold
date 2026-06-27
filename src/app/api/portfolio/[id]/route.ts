import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    try {
        const { name } = await req.json();
        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 });
        }

        // Scope by userId so users can only rename their own portfolios
        const { count } = await db.portfolio.updateMany({
            where: { id, userId: session.user.id },
            data: { name },
        });

        if (count === 0) {
            return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
        }

        return NextResponse.json({ id, name });
    } catch (_e) {
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
}
