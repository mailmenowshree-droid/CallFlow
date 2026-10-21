import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { AssignmentServiceError, createAssignment } from "@/lib/assignment-service";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";
import type { AssignmentRecord, RotationKey } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
  }
  if (error instanceof AssignmentServiceError) {
    const status = error.code === "INVALID_REQUEST" ? 400 : error.code === "DUPLICATE_REQUEST" ? 409 : 422;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: noStore });
  }
  return NextResponse.json({ error: "The assignment service is temporarily unavailable." }, { status: 503, headers: noStore });
}

export async function GET() {
  try {
    const user = await requireSession();
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const filter = user.role === "Team Lead" || user.role === "Manager" ? {} : { engineerId: user.id };
    const assignments = await db.collection<AssignmentRecord>("assignments")
      .find(filter)
      .sort({ scheduledStartAt: 1 })
      .limit(500)
      .toArray();
    return NextResponse.json({ assignments }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(["Team Lead", "Manager"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body is invalid." }, { status: 400, headers: noStore });
    }
    const value = body as Record<string, unknown>;
    const allowedKinds = ["FE", "CRU", "Event", "FTS"] as const;
    if (
      typeof value.kind !== "string" || !allowedKinds.includes(value.kind as typeof allowedKinds[number]) ||
      typeof value.caseNumber !== "string" ||
      typeof value.scheduledStartAt !== "string" ||
      (value.notes !== undefined && typeof value.notes !== "string") ||
      (value.manualEngineerId !== undefined && typeof value.manualEngineerId !== "string")
    ) {
      return NextResponse.json({ error: "Required assignment fields are missing or invalid." }, { status: 400, headers: noStore });
    }
    const start = new Date(value.scheduledStartAt);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: "Scheduled start must be a valid ISO-8601 timestamp including timezone." }, { status: 400, headers: noStore });
    }
    const kind = value.kind as "FE" | "CRU" | "Event" | "FTS";
    const rotation: RotationKey = kind === "FTS" ? "FTS" : "FE_CRU_EVENT";
    const assignment = await createAssignment({
      requestId: typeof value.requestId === "string" && value.requestId.trim() ? value.requestId.trim() : randomUUID(),
      rotation,
      kind,
      caseNumber: value.caseNumber,
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + 30 * 60 * 1000),
      notes: typeof value.notes === "string" ? value.notes : undefined,
      createdBy: user.id,
      manualEngineerId: typeof value.manualEngineerId === "string" && value.manualEngineerId.trim()
        ? value.manualEngineerId.trim()
        : undefined,
    });
    return NextResponse.json({ assignment }, { status: 201, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
