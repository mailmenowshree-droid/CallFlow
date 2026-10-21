import { describe, expect, it } from "vitest";
import {
  chooseNextEngineer,
  hasScheduleConflict,
  recordCompletedAssignment,
  skipForNextThreeCompletions,
  type RotationEngineer,
  type RotationState,
} from "./round-robin";

const window = { startAt: 1_000, endAt: 2_000 };
const base: RotationState = {
  engineerIds: ["A", "B", "C", "D", "E"],
  nextIndex: 0,
  completedAssignments: 0,
};
const team: RotationEngineer[] = base.engineerIds.map((id) => ({ id, active: true }));

describe("round-robin assignment rules", () => {
  it("assigns in order and advances the pointer after the selected engineer", () => {
    const first = chooseNextEngineer(base, team, window);
    expect(first).toEqual({ assignedEngineerId: "A", nextIndex: 1 });
    const second = chooseNextEngineer({ ...base, nextIndex: first.nextIndex }, team, window);
    expect(second).toEqual({ assignedEngineerId: "B", nextIndex: 2 });
  });

  it("skips an engineer with an overlapping busy interval but not one with a non-overlapping interval", () => {
    const busy = team.map((engineer) =>
      engineer.id === "A"
        ? { ...engineer, busyIntervals: [{ startAt: 1_500, endAt: 2_500 }] }
        : engineer,
    );
    expect(chooseNextEngineer(base, busy, window).assignedEngineerId).toBe("B");

    const notBusy = team.map((engineer) =>
      engineer.id === "A"
        ? { ...engineer, busyIntervals: [{ startAt: 2_000, endAt: 3_000 }] }
        : engineer,
    );
    expect(chooseNextEngineer(base, notBusy, window).assignedEngineerId).toBe("A");
  });

  it("flags an Event that overlaps an engineer's pre-scheduled call", () => {
    const scheduledCalls = [{ startAt: 1_500, endAt: 2_500 }];
    expect(hasScheduleConflict(scheduledCalls, { startAt: 2_000, endAt: 3_000 })).toBe(true);
    expect(hasScheduleConflict(scheduledCalls, { startAt: 2_500, endAt: 3_000 })).toBe(false);
  });

  it("excludes inactive engineers and engineers on leave through the scheduled start", () => {
    const unavailable = team.map((engineer) => {
      if (engineer.id === "A") return { ...engineer, active: false };
      if (engineer.id === "B") return { ...engineer, leaveUntil: 1_500 };
      return engineer;
    });
    expect(chooseNextEngineer(base, unavailable, window).assignedEngineerId).toBe("C");
  });

  it("excludes engineers marked absent from assignment eligibility", () => {
    const absent = team.map((engineer) =>
      engineer.id === "A" ? { ...engineer, absent: true } : engineer,
    );
    expect(chooseNextEngineer(base, absent, window).assignedEngineerId).toBe("B");
  });

  it("makes a manually skipped engineer eligible after three completed assignments", () => {
    const skippedB = skipForNextThreeCompletions(team[1], base);
    const roster = [team[0], skippedB, ...team.slice(2)];
    let state = { ...base, nextIndex: 1 };
    expect(chooseNextEngineer(state, roster, window).assignedEngineerId).toBe("C");

    state = recordCompletedAssignment(state);
    state = recordCompletedAssignment(state);
    expect(chooseNextEngineer({ ...state, nextIndex: 1 }, roster, window).assignedEngineerId).toBe("C");

    state = recordCompletedAssignment(state);
    expect(chooseNextEngineer({ ...state, nextIndex: 1 }, roster, window).assignedEngineerId).toBe("B");
  });

  it("returns a clear no-eligible result instead of assigning an unavailable engineer", () => {
    const unavailable = team.map((engineer) => ({
      ...engineer,
      active: false,
    }));
    expect(chooseNextEngineer(base, unavailable, window)).toEqual({
      assignedEngineerId: null,
      nextIndex: 0,
      reason: "NO_ELIGIBLE_ENGINEER",
    });
  });
});
