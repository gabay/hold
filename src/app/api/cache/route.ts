import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function DELETE() {
    const session = await auth();
    if (!session || !session.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await db.stockPrice.deleteMany({});
        await db.exchangeRate.deleteMany({});
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error("Error clearing cache:", error);
        return NextResponse.json(
            { error: (error as Error).message || "Failed to clear cache" },
            { status: 500 },
        );
    }
}
