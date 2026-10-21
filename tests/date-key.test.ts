import { describe, expect, it } from "vitest";
import { isValidDateKey } from "../lib/date-key";

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
