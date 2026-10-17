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
};

function isEligible(engineer: EngineerRecord, rotation: RotationKey, start: Date, end: Date): boolean {
  if (!engineer.active || engineer.absent) return false;
  if (engineer.role === "Team Lead" || engineer.role === "Manager") return false;
  if (engineer.leaveUntil && engineer.leaveUntil > start) return false;
  if (engineer.role === "SSE") return false;
  if (rotation === "FTS" ? !engineer.ftsQueue : !engineer.callQueue) return false;
  return start < end;
}

/**
 * Persist assignment, advance the independent rotation pointer, and write an
 * audit event in one MongoDB transaction. Call only behind authenticated,
 * role-authorized server code.
 */
export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentRecord> {
  if (
    !input.requestId?.trim() ||
    !input.caseNumber?.trim() ||
    !input.createdBy?.trim() ||
    !(input.scheduledStartAt instanceof Date) ||
    !(input.scheduledEndAt instanceof Date) ||
    Number.isNaN(input.scheduledStartAt.getTime()) ||
    Number.isNaN(input.scheduledEndAt.getTime()) ||
    input.scheduledEndAt <= input.scheduledStartAt ||
    (input.rotation === "FTS" ? input.kind !== "FTS" : input.kind === "FTS")
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
      const existing = await assignments.findOne({ requestId: input.requestId }, { session });
      if (existing) {
        throw new AssignmentServiceError("DUPLICATE_REQUEST", "This request ID has already been used.");
      }

      const rotation = await db.collection<RotationRecord>("rotation_state").findOne(
        { _id: input.rotation },
        { session },
      );
      if (!rotation || rotation.engineerIds.length === 0) {
        throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "No eligible engineer is configured for this rotation.");
      }

      const engineerIds = rotation.engineerIds;
      const engineers = await db.collection<EngineerRecord>("engineers").find(
        { id: { $in: engineerIds } },
        { session },
      ).toArray();
      const byId = new Map(engineers.map((engineer) => [engineer.id, engineer]));
      const startIndex = ((rotation.nextIndex % engineerIds.length) + engineerIds.length) % engineerIds.length;
      let selectedIndex = -1;
      let selected: EngineerRecord | undefined;

      for (let offset = 0; offset < engineerIds.length; offset += 1) {
        const index = (startIndex + offset) % engineerIds.length;
        const engineer = byId.get(engineerIds[index]);
        if (!engineer || !isEligible(engineer, input.rotation, input.scheduledStartAt, input.scheduledEndAt)) continue;
        if (
          engineer.skipUntilCompletion !== undefined &&
          rotation.completedAssignments < engineer.skipUntilCompletion
        ) continue;

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

      if (!selected || selectedIndex < 0) {
        throw new AssignmentServiceError("NO_ELIGIBLE_ENGINEER", "No eligible engineer is available in this time window.");
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
      const update = await db.collection<RotationRecord>("rotation_state").updateOne(
        { _id: input.rotation, nextIndex: rotation.nextIndex, completedAssignments: rotation.completedAssignments },
        { $set: { nextIndex: (selectedIndex + 1) % engineerIds.length, updatedAt: now } },
        { session },
      );
      if (update.modifiedCount !== 1) {
        throw new Error("Rotation state changed during assignment; retry the request.");
      }
      await db.collection("audit_events").insertOne({
        eventType: "ASSIGNMENT_CREATED",
        entityId: assignment.id,
        actorId: input.createdBy,
        occurredAt: now,
        metadata: { rotation: input.rotation, engineerId: selected.id, caseNumber: assignment.caseNumber },
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
