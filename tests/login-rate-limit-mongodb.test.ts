import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import {
  consumeLoginRateLimit,
  createLoginRateLimitKey,
  LOGIN_RATE_LIMITS,
  type LoginRateLimitRecord,
} from "@/lib/login-rate-limit";
import { POST as login } from "../app/api/auth/login/route";

const integration = describe.skipIf(!process.env.MONGODB_URI);
const sessionSecret = "callflow-integration-session-secret-32-bytes";

integration("MongoDB login rate-limit integration", () => {
  let db: Db;
  const cleanupKeys: string[] = [];

  beforeAll(async () => {
    process.env.SESSION_SECRET = sessionSecret;
    await ensureCallFlowIndexes();
    db = await getDatabase();
  });

  afterAll(async () => {
    if (db && cleanupKeys.length > 0) {
      await db.collection("login_rate_limits").deleteMany({
        _id: { $in: cleanupKeys },
      });
    }
    await (await getMongoClient()).close();
  });

  it("serializes concurrent first-use upserts and resets an expired fixed window", async () => {
    const key = createLoginRateLimitKey(sessionSecret, "account", randomUUID());
    cleanupKeys.push(key);
    const collection = db.collection<LoginRateLimitRecord>("login_rate_limits");
    const now = new Date();
    const attempts = await Promise.all(
      Array.from({ length: 40 }, () => consumeLoginRateLimit(
        collection,
        key,
        LOGIN_RATE_LIMITS.account.limit,
        LOGIN_RATE_LIMITS.account.windowMs,
        now,
      )),
    );

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(10);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(30);
    expect(await collection.findOne({ _id: key })).toMatchObject({
      count: 40,
      expiresAt: new Date(now.getTime() + LOGIN_RATE_LIMITS.account.windowMs),
    });

    const afterExpiry = new Date(now.getTime() + LOGIN_RATE_LIMITS.account.windowMs + 1);
    await expect(consumeLoginRateLimit(
      collection,
      key,
      LOGIN_RATE_LIMITS.account.limit,
      LOGIN_RATE_LIMITS.account.windowMs,
      afterExpiry,
    )).resolves.toEqual({ allowed: true, retryAfterSeconds: 900 });
    expect(await collection.findOne({ _id: key })).toMatchObject({ count: 1 });
  });

  it("enforces the account threshold through concurrent login route requests", async () => {
    const email = `missing-${randomUUID()}@example.test`;
    const clientAddress = `2001:db8::${randomUUID().replace(/-/g, "").slice(0, 4)}`;
    const accountKey = createLoginRateLimitKey(sessionSecret, "account", email);
    const ipKey = createLoginRateLimitKey(sessionSecret, "ip", clientAddress);
    cleanupKeys.push(accountKey, ipKey);

    const responses = await Promise.all(
      Array.from({ length: 11 }, () => login(new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": clientAddress,
        },
        body: JSON.stringify({ email, password: "incorrect-password" }),
      }))),
    );

    expect(responses.filter((response) => response.status === 401)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(await db.collection<LoginRateLimitRecord>("login_rate_limits").findOne({ _id: accountKey }))
      .toMatchObject({ count: 11 });
    expect(await db.collection<LoginRateLimitRecord>("login_rate_limits").findOne({ _id: ipKey }))
      .toMatchObject({ count: 11 });
  });
});
