import { describe, expect, it } from "vitest";
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

describe("password policy", () => {
  it("rejects values shorter than the minimum", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isValidPassword("")).toBe(false);
  });

  it("accepts the minimum and maximum allowed lengths", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isValidPassword("a".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
  });

  it("rejects values longer than the maximum", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidPassword(null)).toBe(false);
    expect(isValidPassword(12345678901234)).toBe(false);
  });
});
