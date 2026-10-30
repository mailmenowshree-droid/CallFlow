import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { transitionAssignment, LifecycleError } from "@/lib/assignment-lifecycle";
import { getDatabase } from "@/lib/mongodb";
import type { AssignmentRecord, AssignmentStatus } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const statuses: AssignmentStatus[] = ["Scheduled", "In Progress", "Completed", "Needs attention", "Cancelled"];

function failure(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
  }
  if (error instanceof LifecycleError) {
    const status = error.code === "NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: noStore });
  }
  return NextResponse.json({ error: "The assignment service is temporarily unavailable." }, { status: 503, headers: noStore });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireSession();
    const db = await getDatabase();
    const current = await db.collection<AssignmentRecord>("assignments").findOne({ id: id });
    if (!current) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404, headers: noStore });
    }
    const isPrivileged = user.role === "Team Lead" || user.role === "Manager";
    if (!isPrivileged && (user.role !== "Engineer" && user.role !== "SSE" || current.engineerId !== user.id)) {
      return NextResponse.json({ error: "You may only update assignments assigned to you." }, { status: 403, headers: noStore });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as Record<string, unknown>).status !== "string" ||
      !statuses.includes((body as Record<string, unknown>).status as AssignmentStatus)) {
      return NextResponse.json({ error: "A valid status is required." }, { status: 400, headers: noStore });
    }

    const assignment = await transitionAssignment(
      current.id,
      (body as { status: AssignmentStatus }).status,
      user.id,
    );
    return NextResponse.json({ assignment }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
