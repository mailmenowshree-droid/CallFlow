import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { AssignmentRecord, AssignmentStatus, RotationKey, RotationRecord } from "@/lib/callflow-types";

export class LifecycleError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

const allowedTransitions: Record<AssignmentStatus, AssignmentStatus[]> = {
  Scheduled: ["In Progress", "Cancelled", "Needs attention"],
  "In Progress": ["Completed", "Needs attention", "Cancelled"],
  "Needs attention": ["In Progress", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

/**
 * Change status atomically and advance completed-assignment cooldowns only
 * when a previously non-completed assignment transitions to Completed.
 */
export async function transitionAssignment(
  assignmentId: string,
  nextStatus: AssignmentStatus,
  actorId: string,
): Promise<AssignmentRecord> {
  if (!assignmentId.trim() || !actorId.trim()) {
    throw new LifecycleError("NOT_FOUND", "Assignment and actor are required.");
  }

  await ensureCallFlowIndexes();
  const db = await getDatabase();
  const client = await getMongoClient();
  const session = client.startSession();
  const now = new Date();
  let result: AssignmentRecord | undefined;

  try {
    await session.withTransaction(async () => {
      const assignments = db.collection<AssignmentRecord>("assignments");
      const current = await assignments.findOne({ id: assignmentId }, { session });
      if (!current) throw new LifecycleError("NOT_FOUND", "Assignment was not found.");
      if (!allowedTransitions[current.status].includes(nextStatus)) {
        throw new LifecycleError("INVALID_TRANSITION", `Cannot transition from ${current.status} to ${nextStatus}.`);
      }

      const updateFields: Partial<AssignmentRecord> = { status: nextStatus, updatedAt: now };
      if (nextStatus === "Completed") updateFields.completedAt = now;
      const updated = await assignments.findOneAndUpdate(
        { id: assignmentId, status: current.status },
        { $set: updateFields },
        { session, returnDocument: "after" },
      );
      if (!updated) throw new Error("Assignment changed concurrently; retry the operation.");
      result = updated;

      if (nextStatus === "Completed") {
        const rotation = await db.collection<RotationRecord>("rotation_state").findOne(
          { _id: current.rotation as RotationKey },
          { session },
        );
        if (rotation) {
          await db.collection<RotationRecord>("rotation_state").updateOne(
            { _id: rotation._id, completedAssignments: rotation.completedAssignments },
            { $inc: { completedAssignments: 1 }, $set: { updatedAt: now } },
            { session },
          );
        }
      }

      await db.collection("audit_events").insertOne({
        eventType: "ASSIGNMENT_STATUS_CHANGED",
        entityId: assignmentId,
        actorId,
        occurredAt: now,
        metadata: { from: current.status, to: nextStatus },
      }, { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }

  if (!result) throw new Error("Assignment lifecycle transaction completed without a result.");
  return result;
}
