import { describe, expect, it } from "vitest";
import { validateLeaveTransition } from "../lib/leave-transition";

const base = {
  currentStatus: "Pending" as const,
  actorId: "engineer-1",
  engineerId: "engineer-1",
};
const reviewerBase = { ...base, actorId: "reviewer-1" };

describe("validateLeaveTransition", () => {
  it("allows a team lead or manager to review pending leave", () => {
    expect(validateLeaveTransition({ ...reviewerBase, nextStatus: "Approved", actorRole: "Team Lead" })).toBeNull();
    expect(validateLeaveTransition({ ...reviewerBase, nextStatus: "Rejected", actorRole: "Manager" })).toBeNull();
  });

  it("prevents Managers and Team Leads from approving or rejecting their own leave", () => {
    expect(validateLeaveTransition({ ...base, nextStatus: "Approved", actorRole: "Team Lead" })).toBe("FORBIDDEN");
    expect(validateLeaveTransition({ ...base, nextStatus: "Rejected", actorRole: "Manager" })).toBe("FORBIDDEN");
  });

  it("allows a user to cancel their own pending or approved leave", () => {
    expect(validateLeaveTransition({ ...base, nextStatus: "Cancelled", actorRole: "Engineer" })).toBeNull();
    expect(validateLeaveTransition({ ...base, currentStatus: "Approved", nextStatus: "Cancelled", actorRole: "SSE" })).toBeNull();
  });

  it("allows a manager to cancel another person's pending or approved leave", () => {
    expect(validateLeaveTransition({
      ...base,
      engineerId: "engineer-2",
      nextStatus: "Cancelled",
      actorRole: "Manager",
    })).toBeNull();
  });

  it("prevents non-reviewers from approving and users from cancelling another person's leave", () => {
    expect(validateLeaveTransition({ ...base, nextStatus: "Approved", actorRole: "Engineer" })).toBe("FORBIDDEN");
    expect(validateLeaveTransition({
      ...base,
      engineerId: "engineer-2",
      nextStatus: "Cancelled",
      actorRole: "Team Lead",
    })).toBe("FORBIDDEN");
  });

  it("prevents re-reviewing approved or closed leave and cancelling rejected leave", () => {
    expect(validateLeaveTransition({ ...reviewerBase, currentStatus: "Approved", nextStatus: "Rejected", actorRole: "Manager" }))
      .toBe("ALREADY_REVIEWED");
    expect(validateLeaveTransition({ ...reviewerBase, currentStatus: "Rejected", nextStatus: "Cancelled", actorRole: "Manager" }))
      .toBe("CLOSED");
    expect(validateLeaveTransition({ ...reviewerBase, currentStatus: "Cancelled", nextStatus: "Approved", actorRole: "Manager" }))
      .toBe("ALREADY_REVIEWED");
  });
});
