import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";
import { parseLoginCredentials } from "@/lib/login-policy";
import type { EngineerRole } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

type LoginUser = {
  id: string;
  email: string;
  name: string;
  role: EngineerRole;
  active: boolean;
  passwordHash?: string;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const credentials = parseLoginCredentials(body);
  if (!credentials) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400, headers: noStore });
  }

  try {
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const user = await db.collection<LoginUser>("users").findOne({
      email: credentials.email,
      active: true,
    });

    let passwordMatches = false;
    if (user?.passwordHash) {
      try {
        passwordMatches = await compare(credentials.password, user.passwordHash);
      } catch {
        passwordMatches = false;
      }
    }
    if (!user || !passwordMatches) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401, headers: noStore });
    }

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }, { headers: noStore });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
