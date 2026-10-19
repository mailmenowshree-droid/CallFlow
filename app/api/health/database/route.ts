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
  } catch (error: unknown) {
    // Log only safe error metadata for diagnosis. Never log connection strings,
    // full driver messages, hostnames, or credentials.
    const diagnostic =
      error && typeof error === "object"
        ? {
            name: "name" in error && typeof error.name === "string" ? error.name : "UnknownError",
            code: "code" in error && (typeof error.code === "string" || typeof error.code === "number")
              ? error.code
              : undefined,
            codeName: "codeName" in error && typeof error.codeName === "string"
              ? error.codeName
              : undefined,
          }
        : { name: "UnknownError" };
    console.error("CallFlow database health check failed", diagnostic);

    return NextResponse.json(
      { status: "unavailable", database: process.env.MONGODB_DB ?? "callflow" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
