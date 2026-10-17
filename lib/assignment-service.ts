import { randomUUID } from "node:crypto";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { AssignmentRecord, EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export class AssignmentServiceError extends Error {
  constructor(
    public readonly code: "INVALID_REQUEST" | "NO_ELIGIBLE_ENGINEER" | "DUPLICATE_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentServiceError";
  }
}

export type CreateAssignmentInput = {
  requestId: string;
  rotation: RotationKey;
  kind: "FE" | "CRU" | "Event" | "FTS";
  caseNumber: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  notes?: string;
  createdBy: string;
  /** Explicit TL/Manager choice. SSE is eligible only through this path. */
  manualEngineerId?: string;
};

function isEligible(
  engineer: EngineerRecord,
  rotation: RotationKey,
  start: Date,
  end: Date,
  manual: boolean,
): boolean {
  if (!engineer.active || engineer.absent || start >= end) return false;
  if (engineer.role === "Team Lead" || engineer.role === "Manager") return false;
  if (engineer.leaveUntil && engineer.leaveUntil > start) return false;
  if (engineer.role === "SSE" && !manual) return false;
  if (rotation === "FTS" ? !engineer.ftsQueue : !engineer.callQueue) return false;
  return true;
}

/** Persist assignment, pointer changes, and audit in a single transaction. */
export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentRecord> {
  if (
    !input.requestId?.trim() || input.requestId.length > 128 ||
    !input.caseNumber?.trim() || input.caseNumber.length > 128 ||
    !input.createdBy?.trim() ||
    !(input.scheduledStartAt instanceof Date) ||
    !(input.scheduledEndAt instanceof Date) ||
    Number.isNaN(input.scheduledStartAt.getTime()) ||
    Number.isNaN(input.scheduledEndAt.getTime()) ||
    input.scheduledEndAt <= input.scheduledStartAt ||
    input.scheduledEndAt.getTime() - input.scheduledStartAt.getTime() > 12 * 60 * 60 * 1000 ||
    (input.rotation === "FTS" ? input.kind !== "FTS" : input.kind === "FTS") ||
    (input.notes !== undefined && input.notes.length > 4000)
  ) {
    throw new AssignmentServiceError("INVALID_REQUEST", "The assignment request is invalid.");
  }

  await ensureCallFlowIndexes();
  const db = await getDatabase();
  const client = await getMongoClient();
  const session = client.startSession();
  const now = new Date();
  let created: AssignmentRecord | undefined;

  try {
    await session.withTransaction(async () => {
      const assignments = db.collection<AssignmentRecord>("assignments");
      if (await assignments.findOne({ requestId: input.requestId }, { session })) {
        throw new AssignmentServiceError("DUPLICATE_REQUEST", "This request ID has already been used.");
      }

      const rotations = db.collection<RotationRecord>("rotation_state");
      const rotation = await rotations.findOne({ _id: input.rotation }, { session });
      if (!rotation || rotation.engineerIds.length === 0) {
        throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "No eligible engineer is configured for this rotation.");
      }

      const engineersCollection = db.collection<EngineerRecord>("engineers");
      let selected: EngineerRecord | undefined;
      let selectedIndex = -1;
      const manual = Boolean(input.manualEngineerId);

      if (manual) {
        selected = await engineersCollection.findOne({ id: input.manualEngineerId }, { session }) ?? undefined;
        if (!selected || !isEligible(selected, input.rotation, input.scheduledStartAt, input.scheduledEndAt, true)) {
          throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "The manually selected engineer is not eligible for this assignment.");
        }
        if (selected.role !== "SSE" && rotation.engineerIds.includes(selected.id)) {
          selectedIndex = rotation.engineerIds.indexOf(selected.id);
        }
      } else {
        const engineers = await engineersCollection.find({ id: { $in: rotation.engineerIds } }, { session }).toArray();
        const byId = new Map(engineers.map((engineer) => [engineer.id, engineer]));
        const startIndex = ((rotation.nextIndex % rotation.engineerIds.length) + rotation.engineerIds.length) % rotation.engineerIds.length;

        for (let offset = 0; offset < rotation.engineerIds.length; offset += 1) {
          const index = (startIndex + offset) % rotation.engineerIds.length;
          const engineer = byId.get(rotation.engineerIds[index]);
          if (!engineer || !isEligible(engineer, input.rotation, input.scheduledStartAt, input.scheduledEndAt, false)) continue;
          if (engineer.skipUntilCompletion !== undefined && rotation.completedAssignments < engineer.skipUntilCompletion) continue;
          const busy = await assignments.findOne({
            engineerId: engineer.id,
            status: { $in: ["Scheduled", "In Progress", "Needs attention"] },
            scheduledStartAt: { $lt: input.scheduledEndAt },
            scheduledEndAt: { $gt: input.scheduledStartAt },
          }, { session });
          if (busy) continue;
          selected = engineer;
          selectedIndex = index;
          break;
        }
      }

      if (!selected) {
        throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "No eligible engineer is available in this time window.");
      }

      const busy = await assignments.findOne({
        engineerId: selected.id,
        status: { $in: ["Scheduled", "In Progress", "Needs attention"] },
        scheduledStartAt: { $lt: input.scheduledEndAt },
        scheduledEndAt: { $gt: input.scheduledStartAt },
      }, { session });
      if (busy) {
        throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "The selected engineer already has an overlapping assignment.");
      }

      const assignment: AssignmentRecord = {
        id: randomUUID(),
        requestId: input.requestId,
        rotation: input.rotation,
        kind: input.kind,
        caseNumber: input.caseNumber.trim(),
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        engineerId: selected.id,
        status: "Scheduled",
        notes: input.notes?.trim() || undefined,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      await assignments.insertOne(assignment, { session });

      // Manual assignments do not move the automatic pointer. A manual choice
      // of an ordinary rotation member does not silently alter round-robin order.
      if (!manual) {
        const update = await rotations.updateOne(
          { _id: input.rotation, nextIndex: rotation.nextIndex, completedAssignments: rotation.completedAssignments },
          { $set: { nextIndex: (selectedIndex + 1) % rotation.engineerIds.length, updatedAt: now } },
          { session },
        );
        if (update.modifiedCount !== 1) throw new Error("Rotation state changed concurrently; retry the request.");
      }

      await db.collection("audit_events").insertOne({
        eventType: manual ? "ASSIGNMENT_MANUALLY_CREATED" : "ASSIGNMENT_CREATED",
        entityId: assignment.id,
        actorId: input.createdBy,
        occurredAt: now,
        metadata: {
          rotation: input.rotation,
          engineerId: selected.id,
          caseNumber: assignment.caseNumber,
          assignmentMode: manual ? "manual" : "round_robin",
        },
      }, { session });
      created = assignment;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }

  if (!created) throw new Error("Assignment transaction completed without a result.");
  return created;
}

export async function initializeRotation(rotation: RotationKey, engineerIds: string[]): Promise<void> {
  const db = await getDatabase();
  await db.collection<RotationRecord>("rotation_state").updateOne(
    { _id: rotation },
    { $setOnInsert: { engineerIds, nextIndex: 0, completedAssignments: 0, updatedAt: new Date() } },
    { upsert: true },
  );
}
