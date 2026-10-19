import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRole, EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const TEST_PASSWORD = "1234";
const roster: Array<{ name: string; role: EngineerRole; callQueue: boolean; ftsQueue: boolean }> = [
  { name: "Sreekanth", role: "Manager", callQueue: false, ftsQueue: false },
  { name: "Vasista Vardhan Gera", role: "Team Lead", callQueue: false, ftsQueue: false },
  { name: "Gottam Geethika", role: "SSE", callQueue: false, ftsQueue: false },
  { name: "Deepak Anbu", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Sakthivel Vellaichamy", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Ashik Abiragam Thangaraj", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Jeromechinnappan Anthonysamy", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Rinas Rafeeque", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Muhammed Sahad M B T", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Ramki Gajendran", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Karri Vamsi Krishna", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Suthish Ravichandran", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Reinhardt Benjamin Eptha Deva", role: "Engineer", callQueue: true, ftsQueue: true },
  { name: "Sanjay Rayan Vasanth", role: "Engineer", callQueue: true, ftsQueue: true },
];

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Enter your name and password." }, { status: 400, headers: noStore });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter your name and password." }, { status: 400, headers: noStore });
  }
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const identity = roster.find(person => person.name.toLowerCase() === name.toLowerCase());
  if (!identity || password !== TEST_PASSWORD) {
    return NextResponse.json({ error: "Name or password is incorrect." }, { status: 401, headers: noStore });
  }

  let stage = "database";
  try {
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const now = new Date();
    const email = identity.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") + "@callflow.test";
    const session = client.startSession();
    let id = "";
    try {
      stage = "user record transaction";
      await session.withTransaction(async () => {
        const users = db.collection<{ id: string; email: string; name: string; role: EngineerRole; active: boolean; passwordHash: string; createdAt: Date; updatedAt: Date }>("users");
        let user = await users.findOne({ name: identity.name }, { session });
        if (!user) {
          id = randomUUID();
          await users.insertOne({ id, email, name: identity.name, role: identity.role, active: true, passwordHash: await hash(TEST_PASSWORD, 8), createdAt: now, updatedAt: now }, { session });
        } else {
          id = user.id;
          await users.updateOne({ id }, { $set: { role: identity.role, active: true, updatedAt: now } }, { session });
        }
        if (identity.role === "Engineer" || identity.role === "SSE") {
          const engineers = db.collection<EngineerRecord>("engineers");
          const existing = await engineers.findOne({ id }, { session });
          const engineer: EngineerRecord = {
            ...(existing ?? {} as EngineerRecord), id, name: identity.name, email,
            role: identity.role, active: true,
            callQueue: identity.role === "Engineer" && identity.callQueue,
            ftsQueue: identity.role === "Engineer" && identity.ftsQueue,
            absent: existing?.absent ?? false,
            attendanceStatus: existing?.attendanceStatus ?? "Not checked in",
            createdAt: existing?.createdAt ?? now, updatedAt: now,
          };
          if (existing) await engineers.updateOne({ id }, { $set: engineer }, { session });
          else await engineers.insertOne(engineer, { session });
          for (const [key, enabled] of [["FE_CRU_EVENT", engineer.callQueue], ["FTS", engineer.ftsQueue]] as Array<[RotationKey, boolean]>) {
            if (!enabled) continue;
            const rotations = db.collection<RotationRecord>("rotation_state");
            const state = await rotations.findOne({ _id: key }, { session });
            if (state) await rotations.updateOne({ _id: key }, { $addToSet: { engineerIds: id }, $set: { updatedAt: now } }, { session });
            else await rotations.insertOne({ _id: key, engineerIds: [id], nextIndex: 0, completedAssignments: 0, updatedAt: now }, { session });
          }
        }
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally { await session.endSession(); }
    stage = "session token";
    const token = await createSessionToken({ id, email, name: identity.name, role: identity.role });
    const response = NextResponse.json({ user: { id, email, name: identity.name, role: identity.role } }, { headers: noStore });
    response.cookies.set("callflow_session", token, sessionCookieOptions());
    return response;
  } catch (error) {
    const err = error as { name?: string; code?: string | number; codeName?: string };
    console.error("CallFlow preview sign-in failed", { stage, name: err?.name, code: err?.code, codeName: err?.codeName });
    const diagnostic = process.env.NODE_ENV !== "production" ? { stage, reason: err?.codeName ?? err?.code ?? err?.name ?? "unknown" } : {};
    return NextResponse.json({ error: "Sign-in failed while preparing the test workspace.", ...diagnostic }, { status: 503, headers: noStore });
  }
}
