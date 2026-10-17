import { describe, expect, it } from "vitest";
import { getWfhAllowance } from "../lib/wfh-policy";

describe("quarterly WFH allowance", () => {
  it("allows two days in the first month", () => {
    expect(getWfhAllowance(1, 0)).toMatchObject({ allowanceAvailableToDate: 2, remaining: 2, allowed: true });
    expect(getWfhAllowance(1, 2).allowed).toBe(false);
  });

  it("carries unused monthly allowance forward within the quarter", () => {
    expect(getWfhAllowance(2, 0).remaining).toBe(4);
    expect(getWfhAllowance(2, 2).remaining).toBe(2);
    expect(getWfhAllowance(2, 4).allowed).toBe(false);
  });

  it("never permits more than six days in a quarter", () => {
    expect(getWfhAllowance(3, 5).allowed).toBe(true);
    expect(getWfhAllowance(3, 6)).toMatchObject({ allowanceAvailableToDate: 6, remaining: 0, allowed: false });
    expect(getWfhAllowance(3, 7).allowed).toBe(false);
  });

  it("clamps month index to a valid quarter range", () => {
    expect(getWfhAllowance(0, 0).allowanceAvailableToDate).toBe(2);
    expect(getWfhAllowance(4, 0).allowanceAvailableToDate).toBe(6);
  });
});
