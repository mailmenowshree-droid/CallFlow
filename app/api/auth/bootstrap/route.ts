import { randomUUID, timingSafeEqual } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import { isValidPassword } from "@/lib/password-policy";
import type { EngineerRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const expectedToken = process.env.CALLFLOW_BOOTSTRAP_TOKEN;
  const expectedEmail = process.env.BOOTSTRAP_MANAGER_EMAIL?.trim().toLowerCase();
  if (!expectedToken || expectedToken.length < 32 || !expectedEmail) {
    return NextResponse.json({ error: "Initial setup is not enabled." }, { status: 404, headers: noStore });
  }

  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(expectedToken);
  const suppliedBytes = Buffer.from(suppliedToken);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  }
  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (email !== expectedEmail || !name || name.length > 120 || !isValidPassword(password)) {
    return NextResponse.json({ error: "Use the configured email, a valid name, and a password of at least 14 characters." }, { status: 400, headers: noStore });
  }

  try {
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    const id = randomUUID();
    const now = new Date();
    try {
      await session.withTransaction(async () => {
        const users = db.collection("users");
        const managerExists = await users.findOne({ role: "Manager" }, { session, projection: { _id: 1 } });
        if (managerExists) throw new Error("MANAGER_ALREADY_EXISTS");
        await users.insertOne({
          id, email, name, role: "Manager", active: true,
          passwordHash: await hash(password, 12),
          createdAt: now, updatedAt: now,
        }, { session });
        await db.collection<EngineerRecord>("engineers").insertOne({
          id, email, name, role: "Manager", active: true,
          callQueue: false, ftsQueue: false, absent: false,
          attendanceStatus: "Not checked in",
          createdAt: now, updatedAt: now,
        }, { session });
        await db.collection("audit_events").insertOne({
          eventType: "INITIAL_MANAGER_BOOTSTRAPPED",
          entityId: id,
          actorId: id,
          occurredAt: now,
          metadata: { role: "Manager", email, engineerProfileCreated: true },
        }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ status: "created", email, role: "Manager" }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "MANAGER_ALREADY_EXISTS") {
      return NextResponse.json({ error: "A Manager account already exists; initial setup is closed." }, { status: 409, headers: noStore });
    }
    if (error instanceof Error && (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ error: "Could not create the initial Manager account." }, { status: 503, headers: noStore });
  }
}
