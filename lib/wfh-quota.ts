import type { ClientSession, Db } from "mongodb";
import { getWfhAllowance } from "./wfh-policy";

export type WfhReservationResult =
  | { ok: true; usedThisQuarter: number; allowanceAvailableToDate: number; remaining: number }
  | { ok: false; reason: "already-recorded" | "limit"; usedThisQuarter: number; allowanceAvailableToDate: number; remaining: number };

/**
 * Must be called inside a MongoDB transaction. The quota document is written before
 * reading attendance events so concurrent check-ins for the same quarter conflict
 * and retry against the latest snapshot.
 */
export async function reserveWfhDay(db: Db, session: ClientSession, input: {
  engineerId: string;
  quarterStart: string;
  todayKey: string;
  monthsElapsedInQuarter: number;
  now: Date;
}): Promise<WfhReservationResult> {
  const { engineerId, quarterStart, todayKey, monthsElapsedInQuarter, now } = input;
  await db.collection("wfh_quota").updateOne(
    { engineerId, quarterStart },
    { $inc: { reservationVersion: 1 }, $setOnInsert: { createdAt: now } },
    { upsert: true, session },
  );
  const events = await db.collection("attendance_events").find({
    engineerId,
    eventType: "WFH_CHECKED_IN",
    attendanceDate: { $gte: quarterStart, $lte: todayKey },
  }, { session }).toArray();
  const days = new Set(events.map(event => String(event.attendanceDate)));
  const usedThisQuarter = days.size;
  const allowance = getWfhAllowance(monthsElapsedInQuarter, usedThisQuarter);
  if (days.has(todayKey)) return { ok: false, reason: "already-recorded", usedThisQuarter, allowanceAvailableToDate: allowance.allowanceAvailableToDate, remaining: allowance.remaining };
  if (!allowance.allowed) return { ok: false, reason: "limit", usedThisQuarter, allowanceAvailableToDate: allowance.allowanceAvailableToDate, remaining: allowance.remaining };
  return { ok: true, usedThisQuarter, allowanceAvailableToDate: allowance.allowanceAvailableToDate, remaining: allowance.remaining - 1 };
}
