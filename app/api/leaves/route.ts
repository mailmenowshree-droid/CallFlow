import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDateKeysInRange, isValidDateKey } from "@/lib/date-key";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const user = await requireSession();
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const filter = user.role === "Manager" || user.role === "Team Lead" ? {} : { engineerId: user.id };
    const leaves = await db.collection("leave_requests").find(filter).sort({ startDate: 1 }).limit(500).toArray();
    return NextResponse.json({ leaves }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "Sign in required." : "Could not load leave calendar." }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 503, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(["Engineer", "SSE", "Team Lead", "Manager"]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.startDate !== "string" || typeof body.endDate !== "string" || typeof body.reason !== "string" ||
        !isValidDateKey(body.startDate) || !isValidDateKey(body.endDate) || body.endDate < body.startDate || !body.reason.trim()) {
      return NextResponse.json({ error: "Choose a valid date range and enter a reason." }, { status: 400, headers });
    }
    const startDate = body.startDate;
    const endDate = body.endDate;
    const reason = body.reason;
    const dates = getDateKeysInRange(startDate, endDate);
    if (!dates) return NextResponse.json({ error: "A leave request can cover at most 31 days." }, { status: 400, headers });
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const engineer = await db.collection("engineers").findOne({ id: user.id, active: true });
    if (!engineer) return NextResponse.json({ error: "Active team profile not found." }, { status: 422, headers });
    const session = client.startSession();
    const now = new Date();
    const leave = { id: randomUUID(), engineerId: user.id, engineerName: user.name, startDate: startDate, endDate: endDate, reason: reason.trim().slice(0, 500), status: "Pending", createdAt: now, updatedAt: now };
    try {
      await session.withTransaction(async () => {
        // Each date document is a write lock. Concurrent applications for an overlapping
        // date conflict and retry against a fresh snapshot before capacity is evaluated.
        for (const day of dates) {
          await db.collection<{ _id: string; reservationVersion?: number; createdAt?: Date }>("leave_capacity").updateOne(
            { _id: day },
            { $inc: { reservationVersion: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true, session },
          );
        }
        const existing = await db.collection<{ startDate: string; endDate: string }>("leave_requests").find({
          status: { $in: ["Pending", "Approved"] },
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        }, { session }).toArray();
        for (const day of dates) {
          const count = existing.filter((item) => item.startDate <= day && item.endDate >= day).length;
          if (count >= 2) throw new Error("LEAVE_FULL:" + day);
        }
        await db.collection("leave_requests").insertOne(leave, { session });
        await db.collection("audit_events").insertOne({ eventType: "LEAVE_REQUESTED", entityId: leave.id, actorId: user.id, occurredAt: now, metadata: { startDate: startDate, endDate: endDate } }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("LEAVE_FULL:")) return NextResponse.json({ error: error.message.slice(11) + " is full: two people have already applied for or been approved for leave. Please choose another day." }, { status: 409, headers });
      throw error;
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ leave }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Only team members can submit leave requests." }, { status: 403, headers });
    return NextResponse.json({ error: "Could not submit leave request." }, { status: 503, headers });
  }
}
