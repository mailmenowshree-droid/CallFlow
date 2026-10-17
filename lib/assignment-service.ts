import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import type { AssignmentRecord, EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export class AssignmentServiceError extends Error {
  constructor(
    public readonly code: "INVALID_REQUEST" | "NO_ELIGIBLE_ENGINEER" | "DUPLICATE_REQUEST" | "NOT_FOUND",
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

function isEligible(engineer: EngineerRecord, start: Date, end: Date): boolean {
  if (!engineer.active || engineer.absent) return false;
  if (engineer.role === "Team Lead" || engineer.role === "Manager") return false;
  if (engineer.leaveUntil && engineer.leaveUntil > start) return false;
  if (engineer.role === "SSE" && engineer.callQueue) return false;
  return !(start >= end);
}

/**
 * Persists an assignment and advances its rotation pointer in one MongoDB
 * transaction. MongoDB Atlas replica-set deployments support transactions.
 * Caller must be authenticated and authorized before invoking this service.
 */
export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentRecord> {
  if (
    !input.requestId.trim() ||
    !input.caseNumber.trim() ||
    !input.createdBy.trim() ||
    !(input.scheduledStartAt instanceof Date) ||
    !(input.scheduledEndAt instanceof Date) ||
    Number.isNaN(input.scheduledStartAt.getTime()) ||
    Number.isNaN(input.scheduledEndAt.getTime()) ||
    input.scheduledEndAt <= input.scheduledStartAt ||
    (input.rotation === "FTS" ? input.kind !== "FTS" : input.kind === "FTS")
  ) {
    throw new AssignmentServiceError("INVALID_REQUEST", "The assignment request is invalid.");
  }

  const db = await getDatabase();
  const client = new MongoClient(process.env.MONGODB_URI!);
  // Use the shared connection's client through the exported helper below instead
  // of opening a second client. This placeholder is replaced before use.
  await client.close();
  const clientForSession = await import("@/lib/mongodb").then((m) => m.getMongoClient());
  const session = clientForSession.startSession();
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
        if (!engineer || !isEligible(engineer, input.scheduledStartAt, input.scheduledEndAt)) continue;
        const queueEnabled = input.rotation === "FTS" ? engineer.ftsQueue : engineer.callQueue;
        if (!queueEnabled) continue;
        const busy = await assignments.findOne({
          engineerId: engineer.id,
          status: { $in: ["Scheduled", "In Progress", "Needs attention"] },
          scheduledStartAt: { $lt: input.scheduledEndAt },
          scheduledEndAt: { $gt: input.scheduledStartAt },
        }, { session });
        if (busy) continue;
        if (
          engineer.skipUntilCompletion !== undefined &&
          rotation.completedAssignments < engineer.skipUntilCompletion
        ) continue;
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

/** Initialize a rotation once. Does not overwrite existing pointer state. */
export async function initializeRotation(rotation: RotationKey, engineerIds: string[]): Promise<void> {
  const db = await getDatabase();
  await db.collection<RotationRecord>("rotation_state").updateOne(
    { _id: rotation },
    { $setOnInsert: { engineerIds, nextIndex: 0, completedAssignments: 0, updatedAt: new Date() } },
    { upsert: true },
  );
}

/** Acknowledge the ObjectId import for downstream collection helpers. */
export function isValidMongoId(value: string): boolean {
  return ObjectId.isValid(value);
}
