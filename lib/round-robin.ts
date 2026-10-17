export type TimeInterval = { startAt: number; endAt: number };

export type RotationEngineer = {
  id: string;
  active: boolean;
  /** True when marked absent; absent engineers are excluded from assignment. */
  absent?: boolean;
  /** Timestamp through which leave excludes the engineer. */
  leaveUntil?: number;
  /** Scheduled calls or busy periods; intervals use [startAt, endAt). */
  busyIntervals?: TimeInterval[];
  /** Completion count at which the engineer becomes eligible again. */
  skipUntilCompletion?: number;
};

export type RotationState = {
  engineerIds: string[];
  nextIndex: number;
  completedAssignments: number;
};

export type AssignmentWindow = { startAt: number; endAt: number };

export type AssignmentDecision =
  | { assignedEngineerId: string; nextIndex: number }
  | { assignedEngineerId: null; nextIndex: number; reason: "NO_ELIGIBLE_ENGINEER" };

function overlaps(a: TimeInterval, b: TimeInterval): boolean {
  return a.startAt < b.endAt && a.endAt > b.startAt;
}

/**
 * Pure round-robin selection. Persist the returned nextIndex atomically with
 * the assignment in the server-side database before using this in production.
 */
export function chooseNextEngineer(
  rotation: RotationState,
  engineers: RotationEngineer[],
  window: AssignmentWindow,
): AssignmentDecision {
  const count = rotation.engineerIds.length;
  if (count === 0) {
    return { assignedEngineerId: null, nextIndex: 0, reason: "NO_ELIGIBLE_ENGINEER" };
  }

  const byId = new Map(engineers.map((engineer) => [engineer.id, engineer]));
  const startIndex = ((rotation.nextIndex % count) + count) % count;

  for (let offset = 0; offset < count; offset += 1) {
    const index = (startIndex + offset) % count;
    const id = rotation.engineerIds[index];
    const engineer = byId.get(id);
    if (!engineer || !engineer.active || engineer.absent) continue;
    if (engineer.leaveUntil !== undefined && engineer.leaveUntil > window.startAt) continue;
    if (
      engineer.skipUntilCompletion !== undefined &&
      rotation.completedAssignments < engineer.skipUntilCompletion
    ) continue;

    const hasConflict = (engineer.busyIntervals ?? []).some((busy) =>
      overlaps(busy, window),
    );
    if (hasConflict) continue;

    return {
      assignedEngineerId: id,
      nextIndex: (index + 1) % count,
    };
  }

  return {
    assignedEngineerId: null,
    nextIndex: startIndex,
    reason: "NO_ELIGIBLE_ENGINEER",
  };
}

/** A manual skip lasts until three assignments in this rotation are completed. */
export function skipForNextThreeCompletions(
  engineer: RotationEngineer,
  rotation: RotationState,
): RotationEngineer {
  return {
    ...engineer,
    skipUntilCompletion: rotation.completedAssignments + 3,
  };
}

/** Call only when an assignment in this rotation is marked Completed. */
export function recordCompletedAssignment(rotation: RotationState): RotationState {
  return { ...rotation, completedAssignments: rotation.completedAssignments + 1 };
}
