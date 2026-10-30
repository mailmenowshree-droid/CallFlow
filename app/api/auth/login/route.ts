import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import {
  consumeLoginRateLimit,
  createLoginRateLimitKey,
  getClientAddress,
  LOGIN_RATE_LIMITS,
} from "@/lib/login-rate-limit";
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

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many sign-in attempts. Try again later." },
    {
      status: 429,
      headers: { ...noStore, "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const credentials = parseLoginCredentials(body);
  if (!credentials) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400, headers: noStore });
  }

  try {
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const secret = process.env.SESSION_SECRET ?? "";
    const clientAddress = getClientAddress(request.headers);

    if (clientAddress !== "unknown") {
      const ipLimit = await consumeLoginRateLimit(
        db.collection("login_rate_limits"),
        createLoginRateLimitKey(secret, "ip", clientAddress),
        LOGIN_RATE_LIMITS.ip.limit,
        LOGIN_RATE_LIMITS.ip.windowMs,
      );
      if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);
    }

    const accountLimit = await consumeLoginRateLimit(
      db.collection("login_rate_limits"),
      createLoginRateLimitKey(secret, "account", credentials.email),
      LOGIN_RATE_LIMITS.account.limit,
      LOGIN_RATE_LIMITS.account.windowMs,
    );
    if (!accountLimit.allowed) return rateLimited(accountLimit.retryAfterSeconds);

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
