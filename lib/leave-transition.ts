import type { EngineerRole } from "@/lib/callflow-types";

export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type LeaveTransitionError = "FORBIDDEN" | "CLOSED" | "ALREADY_REVIEWED";

export function validateLeaveTransition(input: {
  currentStatus: LeaveStatus;
  nextStatus: LeaveStatus;
  actorRole: EngineerRole;
  actorId: string;
  engineerId: string;
}): LeaveTransitionError | null {
  const { currentStatus, nextStatus, actorRole, actorId, engineerId } = input;

  if (nextStatus === "Cancelled") {
    if (currentStatus !== "Pending" && currentStatus !== "Approved") return "CLOSED";
    if (actorRole !== "Manager" && actorId !== engineerId) return "FORBIDDEN";
    return null;
  }

  if (actorRole !== "Manager" && actorRole !== "Team Lead") return "FORBIDDEN";
  if (actorId === engineerId) return "FORBIDDEN";
  if (currentStatus !== "Pending") return "ALREADY_REVIEWED";
  return null;
}
