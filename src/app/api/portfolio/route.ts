import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    let portfolios = await db.portfolio.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
    });

    if (portfolios.length === 0) {
        const defaultPortfolio = await db.portfolio.create({
            data: {
                name: "My Portfolio",
                userId,
            },
        });
        portfolios = [defaultPortfolio];
    }

    return NextResponse.json(portfolios);
}

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    try {
        const body = await req.json();
        const { name } = body;

        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 });
        }

        const portfolio = await db.portfolio.create({
            data: {
                name,
                userId,
            },
        });

        return NextResponse.json(portfolio, { status: 201 });
    } catch (_e) {
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
}
