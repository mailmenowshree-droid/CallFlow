import { describe, expect, it } from "vitest";
import { AssignmentServiceError, createAssignment } from "../lib/assignment-service";

describe("createAssignment request validation", () => {
  const base = {
    requestId: "req-1",
    rotation: "FE_CRU_EVENT" as const,
    kind: "FE" as const,
    caseNumber: "CASE-123",
    scheduledStartAt: new Date("2026-10-17T10:00:00.000Z"),
    scheduledEndAt: new Date("2026-10-17T11:00:00.000Z"),
    createdBy: "user-1",
  };

  it("rejects invalid date windows before attempting a database connection", async () => {
    await expect(createAssignment({
      ...base,
      scheduledEndAt: new Date("2026-10-17T09:00:00.000Z"),
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects mismatched rotation and request type before database access", async () => {
    await expect(createAssignment({
      ...base,
      rotation: "FTS",
      kind: "FE",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("requires a stable request ID", async () => {
    await expect(createAssignment({
      ...base,
      requestId: " ",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("uses a typed domain error for validation failures", async () => {
    try {
      await createAssignment({ ...base, caseNumber: "" });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AssignmentServiceError);
      expect((error as AssignmentServiceError).code).toBe("INVALID_REQUEST");
    }
  });
});
