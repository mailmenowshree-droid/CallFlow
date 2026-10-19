import { compare } from "bcryptjs";
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

const validRoles: EngineerRole[] = ["Manager", "Team Lead", "Engineer", "SSE"];

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string" ||
      !input.email.trim() || !input.password || input.password.length > 1024) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const db = await getDatabase();
    const user = await db.collection<UserRecord>("users").findOne({
      email: input.email.trim().toLowerCase(),
      active: true,
    });
    const validRecord = !!user &&
      typeof user.id === "string" && !!user.id.trim() &&
      typeof user.email === "string" && !!user.email.trim() &&
      typeof user.name === "string" && !!user.name.trim() &&
      typeof user.passwordHash === "string" && user.passwordHash.startsWith("$2") &&
      validRoles.includes(user.role);
    const validPassword = validRecord && user ? await compare(input.password, user.passwordHash) : false;
    if (!user || !validRecord || !validPassword) {
      return NextResponse.json({ error: "Invalid email or password." }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const token = await createSessionToken({
      id: user.id,
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
