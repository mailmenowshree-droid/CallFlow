import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import type { EngineerRole } from "@/lib/callflow-types";
import { getDatabase } from "@/lib/mongodb";

export const SESSION_COOKIE = "callflow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: EngineerRole;
};

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function readSession(): Promise<SessionUser | null> {
  // Local development may use a fixed identity. Deployed preview and production
  // environments always require a valid signed-in user.
  if (process.env.NODE_ENV === "development") {
    return {
      id: "callflow-preview-manager",
      email: "preview-manager@callflow.local",
      name: "CallFlow Preview",
      role: "Manager",
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      !["Engineer", "SSE", "Team Lead", "Manager"].includes(String(payload.role))
    ) return null;
    const db = await getDatabase();
    const user = await db.collection<{ id: string; email: string; name: string; role: EngineerRole; active: boolean }>("users")
      .findOne({ id: payload.sub, active: true });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function requireSession(allowedRoles?: EngineerRole[]): Promise<SessionUser> {
  const session = await readSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  if (allowedRoles && !allowedRoles.includes(session.role)) throw new Error("FORBIDDEN");
  return session;
}
