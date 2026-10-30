import { describe, expect, it, vi } from "vitest";
import type { Collection } from "mongodb";
import {
  consumeLoginRateLimit,
  createLoginRateLimitKey,
  getClientAddress,
  LOGIN_RATE_LIMITS,
  type LoginRateLimitRecord,
} from "../lib/login-rate-limit";

describe("login rate-limit keys", () => {
  const secret = "a".repeat(32);

  it("creates stable, scoped hashes without exposing the source identifier", () => {
    const email = "person@example.com";
    const first = createLoginRateLimitKey(secret, "account", email);
    expect(first).toBe(createLoginRateLimitKey(secret, "account", email));
    expect(first).not.toContain(email);
    expect(first).not.toBe(createLoginRateLimitKey(secret, "ip", email));
  });

  it("rejects a missing or weak signing secret", () => {
    expect(() => createLoginRateLimitKey("short", "account", "person@example.com")).toThrow();
  });
});

describe("getClientAddress", () => {
  it("prefers the platform real-IP header", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.2, 203.0.113.1",
    });
    expect(getClientAddress(headers)).toBe("203.0.113.10");
  });

  it("uses the first forwarded address when real-IP is absent", () => {
    expect(getClientAddress(new Headers({
      "x-forwarded-for": "198.51.100.2, 203.0.113.1",
    }))).toBe("198.51.100.2");
  });

  it("does not trust malformed proxy header values", () => {
    expect(getClientAddress(new Headers({ "x-real-ip": "not-an-ip" }))).toBe("unknown");
  });
});

describe("consumeLoginRateLimit", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("uses an atomic MongoDB update and blocks attempts over the configured limit", async () => {
    const expiresAt = new Date(now.getTime() + LOGIN_RATE_LIMITS.account.windowMs);
    const findOneAndUpdate = vi.fn().mockResolvedValue({
      _id: "opaque-key",
      count: LOGIN_RATE_LIMITS.account.limit + 1,
      expiresAt,
      updatedAt: now,
    });
    const collection = { findOneAndUpdate } as unknown as Collection<LoginRateLimitRecord>;

    const result = await consumeLoginRateLimit(
      collection,
      "opaque-key",
      LOGIN_RATE_LIMITS.account.limit,
      LOGIN_RATE_LIMITS.account.windowMs,
      now,
    );

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 900 });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "opaque-key" },
      expect.any(Array),
      expect.objectContaining({
        upsert: true,
        returnDocument: "after",
        includeResultMetadata: false,
      }),
    );
  });

  it("allows attempts within the configured limit", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({
      _id: "opaque-key",
      count: 1,
      expiresAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    });
    const collection = { findOneAndUpdate } as unknown as Collection<LoginRateLimitRecord>;

    await expect(consumeLoginRateLimit(collection, "opaque-key", 10, 900_000, now))
      .resolves.toMatchObject({ allowed: true });
  });
});
