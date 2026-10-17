import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.MONGODB_URI) {
    return NextResponse.json(
      { status: "not_configured", database: "callflow" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });
    return NextResponse.json(
      { status: "connected", database: process.env.MONGODB_DB ?? "callflow" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Never return connection strings, driver errors, or network details to callers.
    return NextResponse.json(
      { status: "unavailable", database: process.env.MONGODB_DB ?? "callflow" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
