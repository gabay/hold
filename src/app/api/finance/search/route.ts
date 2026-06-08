import { auth } from "@/auth";
import { searchAssets } from "@/lib/finance";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
        return NextResponse.json([]);
    }

    try {
        const results = await searchAssets(query);
        return NextResponse.json(results);
    } catch (error: any) {
        console.error("Error in finance search api route:", error);
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
