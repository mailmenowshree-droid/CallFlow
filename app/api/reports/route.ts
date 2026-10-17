import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";
import type { AssignmentRecord, EngineerRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

import { isValidDateKey } from "@/lib/date-key";

export async function GET(request: Request) {
  try {
    await requireSession(["Team Lead", "Manager"]);
    await ensureCallFlowIndexes();
    const url = new URL(request.url);
    const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const todayValues = Object.fromEntries(todayParts.map(part => [part.type, part.value]));
    const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
    const start = url.searchParams.get("start") || today;
    const end = url.searchParams.get("end") || start;
    if (!isValidDateKey(start) || !isValidDateKey(end) || end < start) {
      return NextResponse.json({ error: "Choose a valid report date range." }, { status: 400, headers });
    }
    const db = await getDatabase();
    const startAt = new Date(start + "T00:00:00+05:30");
    const endAt = new Date(end + "T00:00:00+05:30");
    endAt.setUTCDate(endAt.getUTCDate() + 1);
    const [assignments, engineers, leaves] = await Promise.all([
      db.collection<AssignmentRecord>("assignments").find({ scheduledStartAt: { $gte: startAt, $lt: endAt } }).sort({ scheduledStartAt: 1 }).toArray(),
      db.collection<EngineerRecord>("engineers").find({ active: true }).toArray(),
      db.collection("leave_requests").find({ status: "Approved", startDate: { $lte: end }, endDate: { $gte: start } }).toArray(),
    ]);
    const byId = new Map(engineers.map(engineer => [engineer.id, engineer]));
    const counts = { total: assignments.length, completed: 0, scheduled: 0, inProgress: 0, needsAttention: 0, cancelled: 0, lateOrMissed: 0 };
    const now = new Date();
    const rows = assignments.map(assignment => {
      const engineer = byId.get(assignment.engineerId);
      // Completed calls are late when they were finished after their scheduled end.
      // Open calls are overdue once their scheduled end has passed.
      const late = assignment.status === "Completed"
        ? Boolean(assignment.completedAt && assignment.completedAt > assignment.scheduledEndAt)
        : assignment.status !== "Cancelled" && assignment.scheduledEndAt < now;
      if (assignment.status === "Completed") counts.completed++;
      else if (assignment.status === "Scheduled") counts.scheduled++;
      else if (assignment.status === "In Progress") counts.inProgress++;
      else if (assignment.status === "Needs attention") counts.needsAttention++;
      else if (assignment.status === "Cancelled") counts.cancelled++;
      if (late) counts.lateOrMissed++;
      return { id: assignment.id, caseNumber: assignment.caseNumber, kind: assignment.kind, engineer: engineer?.name ?? "Unknown", engineerId: assignment.engineerId, scheduledStartAt: assignment.scheduledStartAt, scheduledEndAt: assignment.scheduledEndAt, status: assignment.status, manual: Boolean(assignment.manual), lateOrMissed: late, notes: assignment.notes ?? "" };
    });
    const days = Math.max(1, Math.round((new Date(end + "T12:00:00Z").getTime() - new Date(start + "T12:00:00Z").getTime()) / 86400000) + 1);
    const teamCapacity = engineers.length * days;
    const leavePersonDays = leaves.reduce((sum: number, leave: any) => {
      const from = leave.startDate < start ? start : leave.startDate;
      const to = leave.endDate > end ? end : leave.endDate;
      return sum + Math.max(0, Math.round((new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) / 86400000) + 1);
    }, 0);
    const checkedIn = engineers.filter(e => e.attendanceStatus === "Present").length;
    const absent = engineers.filter(e => e.attendanceStatus === "Absent" || e.absent).length;
    const shrinkagePercent = teamCapacity ? Math.round(leavePersonDays / teamCapacity * 1000) / 10 : 0;
    return NextResponse.json({ period: { start, end }, counts, rows, team: { activeMembers: engineers.length, checkedIn, absent, notCheckedIn: Math.max(0, engineers.length - checkedIn - absent), approvedLeavePersonDays: leavePersonDays, capacityPersonDays: teamCapacity, shrinkagePercent }, leaveRequests: leaves }, { headers });
  } catch (error) {
    const unauthenticated = error instanceof Error && error.message === "UNAUTHENTICATED";
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return NextResponse.json({ error: unauthenticated ? "Sign in required." : forbidden ? "Manager or Team Lead access required." : "Could not generate report." }, { status: unauthenticated ? 401 : forbidden ? 403 : 503, headers });
  }
}
