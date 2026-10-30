import type { EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

/** Select the next eligible engineer without mutating persisted rotation state. */
export function chooseEngineerToSkip(
  rotation: RotationRecord,
  engineers: EngineerRecord[],
  rotationKey: RotationKey,
  now: Date,
): EngineerRecord | null {
  if (rotation.engineerIds.length === 0) return null;

  const byId = new Map(engineers.map((engineer) => [engineer.id, engineer]));
  const startIndex = ((rotation.nextIndex % rotation.engineerIds.length) + rotation.engineerIds.length) %
    rotation.engineerIds.length;

  for (let offset = 0; offset < rotation.engineerIds.length; offset += 1) {
    const index = (startIndex + offset) % rotation.engineerIds.length;
    const candidate = byId.get(rotation.engineerIds[index]);
    if (!candidate || !candidate.active || candidate.absent || candidate.role !== "Engineer") continue;
    if (candidate.leaveUntil && candidate.leaveUntil > now) continue;
    if (rotationKey === "FTS" ? !candidate.ftsQueue : !candidate.callQueue) continue;

    const previousThreshold = candidate.skipUntilCompletionByRotation?.[rotationKey] ?? candidate.skipUntilCompletion;
    if (previousThreshold !== undefined && rotation.completedAssignments < previousThreshold) continue;
    return candidate;
  }

  return null;
}
