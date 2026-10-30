import { describe, expect, it } from "vitest";
import { getDateKeysInRange, isValidDateKey } from "../lib/date-key";

describe("isValidDateKey", () => {
  it("accepts valid ISO calendar dates", () => {
    expect(isValidDateKey("2026-10-17")).toBe(true);
    expect(isValidDateKey("2024-02-29")).toBe(true);
  });

  it("rejects impossible dates and malformed values", () => {
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2025-02-29")).toBe(false);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("17-10-2026")).toBe(false);
    expect(isValidDateKey("")).toBe(false);
  });
});

describe("getDateKeysInRange", () => {
  it("returns inclusive calendar days without local-time drift", () => {
    expect(getDateKeysInRange("2026-10-30", "2026-11-01"))
      .toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("rejects invalid, reversed, and overlong ranges", () => {
    expect(getDateKeysInRange("2026-10-31", "2026-10-30")).toBeNull();
    expect(getDateKeysInRange("2026-02-30", "2026-03-01")).toBeNull();
    expect(getDateKeysInRange("2026-01-01", "2026-02-01")).toBeNull();
  });
});
