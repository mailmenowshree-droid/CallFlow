import { describe, expect, it } from "vitest";
import { parseLoginCredentials } from "../lib/login-policy";

describe("parseLoginCredentials", () => {
  it("normalizes email without changing the password", () => {
    expect(parseLoginCredentials({ email: "  USER@Example.COM ", password: " pass word " }))
      .toEqual({ email: "user@example.com", password: " pass word " });
  });

  it("rejects missing, malformed, or oversized credentials", () => {
    expect(parseLoginCredentials(null)).toBeNull();
    expect(parseLoginCredentials([])).toBeNull();
    expect(parseLoginCredentials({ email: "not-an-email", password: "secret" })).toBeNull();
    expect(parseLoginCredentials({ email: "a@example.com", password: "" })).toBeNull();
    expect(parseLoginCredentials({ email: "a@example.com", password: "x".repeat(1025) })).toBeNull();
  });

  it("accepts existing passwords shorter than the new-account minimum", () => {
    expect(parseLoginCredentials({ email: "a@example.com", password: "legacy" }))
      .toEqual({ email: "a@example.com", password: "legacy" });
  });
});
