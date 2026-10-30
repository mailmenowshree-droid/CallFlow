import { describe, expect, it } from "vitest";
import { chooseEngineerToSkip } from "../lib/rotation-skip";
import type { EngineerRecord, RotationRecord } from "../lib/callflow-types";

const now = new Date("2026-10-30T12:00:00.000Z");
const rotation: RotationRecord = {
  _id: "FE_CRU_EVENT",
  engineerIds: ["a", "b", "c", "d"],
  nextIndex: 1,
  completedAssignments: 4,
  updatedAt: now,
};
const engineer = (id: string, overrides: Partial<EngineerRecord> = {}): EngineerRecord => ({
  id,
  name: id.toUpperCase(),
  role: "Engineer",
  active: true,
  callQueue: true,
  ftsQueue: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("chooseEngineerToSkip", () => {
  it("starts from the persisted pointer and returns the first eligible rotation member", () => {
    const selected = chooseEngineerToSkip(rotation, [
      engineer("a"),
      engineer("b", { absent: true }),
      engineer("c"),
      engineer("d"),
    ], "FE_CRU_EVENT", now);
    expect(selected?.id).toBe("c");
  });

  it("excludes inactive, absent, on-leave, wrong-role, wrong-queue, and cooling-down members", () => {
    const selected = chooseEngineerToSkip(rotation, [
      engineer("a", { active: false }),
      engineer("b", { leaveUntil: new Date(now.getTime() + 60_000) }),
      engineer("c", { role: "SSE" }),
      engineer("d", { skipUntilCompletionByRotation: { FE_CRU_EVENT: 5 } }),
    ], "FE_CRU_EVENT", now);
    expect(selected).toBeNull();
  });

  it("uses the selected rotation queue and does not affect the other queue", () => {
    const selected = chooseEngineerToSkip(
      { ...rotation, _id: "FTS", nextIndex: 0, engineerIds: ["a", "b"] },
      [engineer("a", { ftsQueue: false }), engineer("b", { ftsQueue: true, callQueue: false })],
      "FTS",
      now,
    );
    expect(selected?.id).toBe("b");
  });

  it("returns null for an empty rotation", () => {
    expect(chooseEngineerToSkip({ ...rotation, engineerIds: [] }, [], "FE_CRU_EVENT", now)).toBeNull();
  });
});
