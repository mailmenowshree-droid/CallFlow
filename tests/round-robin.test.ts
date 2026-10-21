import { describe, expect, it } from "vitest";
import {
  chooseNextEngineer,
  hasScheduleConflict,
  recordCompletedAssignment,
  skipForNextThreeCompletions,
  type RotationEngineer,
  type RotationState,
} from "../lib/round-robin";

const window = { startAt: 100, endAt: 200 };
const engineers: RotationEngineer[] = [
  { id: "a", active: true },
  { id: "b", active: true },
  { id: "c", active: true },
];
const rotation: RotationState = {
  engineerIds: ["a", "b", "c"],
  nextIndex: 0,
  completedAssignments: 0,
};

describe("chooseNextEngineer", () => {
  it("advances from the persisted rotation pointer", () => {
    expect(chooseNextEngineer({ ...rotation, nextIndex: 1 }, engineers, window))
      .toMatchObject({ assignedEngineerId: "b", nextIndex: 2 });
  });

  it("skips inactive, absent, on-leave, cooling-down, and busy engineers", () => {
    const candidates: RotationEngineer[] = [
      { id: "a", active: false },
      { id: "b", active: true, absent: true },
      { id: "c", active: true, leaveUntil: 150 },
      { id: "d", active: true, skipUntilCompletion: 3 },
      { id: "e", active: true, busyIntervals: [{ startAt: 150, endAt: 250 }] },
      { id: "f", active: true },
    ];
    const decision = chooseNextEngineer({
      engineerIds: ["a", "b", "c", "d", "e", "f"],
      nextIndex: 0,
      completedAssignments: 0,
    }, candidates, window);
    expect(decision).toMatchObject({ assignedEngineerId: "f", nextIndex: 0 });
  });

  it("returns a safe no-eligible result without advancing the pointer", () => {
    const decision = chooseNextEngineer({
      ...rotation,
      nextIndex: 2,
    }, engineers.map((engineer) => ({ ...engineer, active: false })), window);
    expect(decision).toEqual({
      assignedEngineerId: null,
      nextIndex: 2,
      reason: "NO_ELIGIBLE_ENGINEER",
    });
  });

  it("handles an empty rotation", () => {
    expect(chooseNextEngineer({ ...rotation, engineerIds: [] }, engineers, window))
      .toEqual({ assignedEngineerId: null, nextIndex: 0, reason: "NO_ELIGIBLE_ENGINEER" });
  });
});

describe("completion cooldown and schedule conflicts", () => {
  it("skips an engineer until three assignments in that rotation complete", () => {
    const skipped = skipForNextThreeCompletions(engineers[0], rotation);
    expect(skipped.skipUntilCompletion).toBe(3);
    expect(chooseNextEngineer(rotation, [skipped, engineers[1]], window).assignedEngineerId)
      .toBe("b");
    const afterThree = recordCompletedAssignment(
      recordCompletedAssignment(recordCompletedAssignment(rotation)),
    );
    expect(chooseNextEngineer(afterThree, [skipped, engineers[1]], window).assignedEngineerId)
      .toBe("a");
  });

  it("treats touching schedule boundaries as non-overlapping", () => {
    expect(hasScheduleConflict([{ startAt: 50, endAt: 100 }], window)).toBe(false);
    expect(hasScheduleConflict([{ startAt: 199, endAt: 250 }], window)).toBe(true);
  });
});
