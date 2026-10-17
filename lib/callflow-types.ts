export type RotationKey = "FE_CRU_EVENT" | "FTS";
export type AssignmentStatus = "Scheduled" | "In Progress" | "Completed" | "Needs attention" | "Cancelled";
export type EngineerRole = "Engineer" | "SSE" | "Team Lead" | "Manager";

export type EngineerRecord = {
  id: string;
  name: string;
  email?: string;
  role: EngineerRole;
  active: boolean;
  callQueue: boolean;
  ftsQueue: boolean;
  absent?: boolean;
  leaveUntil?: Date;
  /** Per-queue completion thresholds; a skip in FTS must not affect the shared call queue. */
  skipUntilCompletionByRotation?: Partial<Record<RotationKey, number>>;
  /** Legacy field retained for migration compatibility; new code should use the per-rotation map. */
  skipUntilCompletion?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AssignmentRecord = {
  id: string;
  requestId: string;
  rotation: RotationKey;
  kind: "FE" | "CRU" | "Event" | "FTS";
  caseNumber: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  engineerId: string;
  status: AssignmentStatus;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
};

export type RotationRecord = {
  _id: RotationKey;
  engineerIds: string[];
  nextIndex: number;
  completedAssignments: number;
  updatedAt: Date;
};
