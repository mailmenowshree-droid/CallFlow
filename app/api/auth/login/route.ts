import { compare } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { getDatabase } from "@/lib/mongodb";
import type { EngineerRole } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: EngineerRole;
  active: boolean;
  passwordHash: string;
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string" ||
      !input.email.trim() || !input.password || input.password.length > 1024) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  try {
    const db = await getDatabase();
    const user = await db.collection<UserRecord>("users").findOne({
      email: input.email.trim().toLowerCase(),
      active: true,
    });
    const valid = user ? await compare(input.password, user.passwordHash) : false;
    if (!user || !valid) {
      return NextResponse.json({ error: "Invalid email or password." }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const token = await createSessionToken({
      id: user.id || randomUUID(),
      email: user.email,
      name: user.name,
      role: user.role,
    });
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("callflow_session", token, sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
