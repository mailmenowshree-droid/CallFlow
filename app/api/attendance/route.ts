import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord } from "@/lib/callflow-types";
import { reserveWfhDay } from "@/lib/wfh-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession();
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
    if (value.action !== "check-in" && value.action !== "check-out") {
      return NextResponse.json({ error: "Action must be check-in or check-out." }, { status: 400, headers: noStore });
    }
    const workMode = value.action === "check-in" ? (value.workMode === "WFH" ? "WFH" : "Office") : undefined;
    const isPrivileged = actor.role === "Team Lead" || actor.role === "Manager";
    const engineerId = isPrivileged && typeof value.engineerId === "string" ? value.engineerId : actor.id;
    if (!isPrivileged && value.engineerId !== undefined && value.engineerId !== actor.id) {
      return NextResponse.json({ error: "You can only update your own attendance." }, { status: 403, headers: noStore });
    }
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const now = new Date();
    const checkIn = value.action === "check-in";
    const istParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const ist = Object.fromEntries(istParts.map((part) => [part.type, part.value]));
    const todayKey = `${ist.year}-${ist.month}-${ist.day}`;
    let wfhResponse: { usedThisQuarter: number; allowanceAvailableToDate: number; remaining: number } | undefined;
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (checkIn && workMode === "WFH") {
          const quarterStartMonth = Math.floor((Number(ist.month) - 1) / 3) * 3 + 1;
          const quarterStart = `${ist.year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
          const monthsElapsedInQuarter = Number(ist.month) - quarterStartMonth + 1;
          const reservation = await reserveWfhDay(db, session, { engineerId, quarterStart, todayKey, monthsElapsedInQuarter, now });
          if (!reservation.ok) {
            throw new Error(reservation.reason === "already-recorded"
              ? "WFH_ALREADY_RECORDED"
              : `WFH_LIMIT:${reservation.usedThisQuarter}:${reservation.allowanceAvailableToDate}:${reservation.remaining}:${quarterStart}`);
          }
          wfhResponse = { usedThisQuarter: reservation.usedThisQuarter, allowanceAvailableToDate: reservation.allowanceAvailableToDate, remaining: reservation.remaining };
        }
        const update = await db.collection<EngineerRecord>("engineers").updateOne(
          { id: engineerId, active: true },
          { $set: {
            attendanceStatus: checkIn ? "Present" : "Not checked in",
            ...(checkIn ? { attendanceWorkMode: workMode } : {}),
            absent: false,
            ...(checkIn ? { checkedInAt: now } : { checkedOutAt: now }),
            updatedAt: now,
          } },
          { session },
        );
        if (update.matchedCount !== 1) throw new Error("ACTIVE_TEAM_MEMBER_NOT_FOUND");
        await db.collection("attendance_events").insertOne({
          id: crypto.randomUUID(),
          engineerId,
          eventType: checkIn ? (workMode === "WFH" ? "WFH_CHECKED_IN" : "CHECKED_IN") : "CHECKED_OUT",
          workMode: checkIn ? workMode : undefined,
          attendanceDate: todayKey,
          actorId: actor.id,
          occurredAt: now,
        }, { session });
        await db.collection("audit_events").insertOne({
          eventType: checkIn ? "ATTENDANCE_CHECKED_IN" : "ATTENDANCE_CHECKED_OUT",
          entityId: engineerId,
          actorId: actor.id,
          occurredAt: now,
          metadata: { attendanceStatus: checkIn ? "Present" : "Not checked in" },
        }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } catch (error) {
      if (error instanceof Error && error.message === "WFH_ALREADY_RECORDED") {
        return NextResponse.json({ error: "WFH is already recorded for you today." }, { status: 409, headers: noStore });
      }
      if (error instanceof Error && error.message.startsWith("WFH_LIMIT:")) {
        const [, used, allowance, remaining, quarterStart] = error.message.split(":");
        return NextResponse.json({
          error: "Your available WFH allowance is used for this month. Unused allowance carries forward within the quarter, up to 6 WFH days per quarter.",
          wfh: { usedThisQuarter: Number(used), allowanceAvailableToDate: Number(allowance), remaining: Number(remaining), quarterStart },
        }, { status: 409, headers: noStore });
      }
      if (error instanceof Error && error.message === "ACTIVE_TEAM_MEMBER_NOT_FOUND") {
        return NextResponse.json({ error: "Active team member not found." }, { status: 404, headers: noStore });
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ ok: true, attendanceStatus: checkIn ? "Present" : "Not checked in", workMode: checkIn ? workMode : undefined, attendanceDate: todayKey, occurredAt: now, ...(wfhResponse ? { wfh: wfhResponse } : {}) }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
    return NextResponse.json({ error: "Could not update attendance." }, { status: 503, headers: noStore });
  }
}
