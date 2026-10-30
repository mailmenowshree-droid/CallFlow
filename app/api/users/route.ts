import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import { isValidPassword } from "@/lib/password-policy";
import type { EngineerRecord, EngineerRole, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const roles: EngineerRole[] = ["Engineer", "SSE", "Team Lead", "Manager"];

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession(["Manager"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
    }
    const value = body as Record<string, unknown>;
    const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const password = typeof value.password === "string" ? value.password : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !name || name.length > 120 || !isValidPassword(password) ||
        typeof value.role !== "string" || !roles.includes(value.role as EngineerRole)) {
      return NextResponse.json({ error: "Provide a valid name, email, role, and password of at least 14 characters." }, { status: 400, headers: noStore });
    }
    const role = value.role as EngineerRole;
    const callQueue = value.callQueue === true;
    const ftsQueue = value.ftsQueue === true;
    if ((role !== "Engineer") && (callQueue || ftsQueue)) {
      return NextResponse.json({ error: "Only Engineers can join automatic rotations; SSE is manual-only." }, { status: 422, headers: noStore });
    }
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    const now = new Date();
    const id = randomUUID();
    const user = { id, email, name, role, active: true, passwordHash: await hash(password, 12), createdAt: now, updatedAt: now };
    const engineer: EngineerRecord | undefined = role === "Engineer" || role === "SSE" ? {
      id, email, name, role, active: true,
      callQueue: role === "Engineer" && callQueue,
      ftsQueue: role === "Engineer" && ftsQueue,
      absent: false, attendanceStatus: "Not checked in", createdAt: now, updatedAt: now,
    } : undefined;
    try {
      await session.withTransaction(async () => {
        await db.collection("users").insertOne(user, { session });
        if (engineer) {
          await db.collection<EngineerRecord>("engineers").insertOne(engineer, { session });
          const memberships: Array<[RotationKey, boolean]> = [
            ["FE_CRU_EVENT", engineer.callQueue],
            ["FTS", engineer.ftsQueue],
          ];
          for (const [key, enabled] of memberships) {
            if (!enabled) continue;
            const rotations = db.collection<RotationRecord>("rotation_state");
            const state = await rotations.findOne({ _id: key }, { session });
            if (state) await rotations.updateOne({ _id: key }, { $addToSet: { engineerIds: id }, $set: { updatedAt: now } }, { session });
            else await rotations.insertOne({ _id: key, engineerIds: [id], nextIndex: 0, completedAssignments: 0, updatedAt: now }, { session });
          }
        }
        await db.collection("audit_events").insertOne({
          eventType: "USER_CREATED",
          entityId: id,
          actorId: actor.id,
          occurredAt: now,
          metadata: { role, email, engineerCreated: Boolean(engineer) },
        }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ user: { id, email, name, role }, engineerCreated: Boolean(engineer) }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Only a Manager can create user accounts." }, { status: 403, headers: noStore });
    if (error instanceof Error && (error as { code?: number }).code === 11000) return NextResponse.json({ error: "An account with this email already exists." }, { status: 409, headers: noStore });
    return NextResponse.json({ error: "Could not create user account." }, { status: 503, headers: noStore });
  }
}
