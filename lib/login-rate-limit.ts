import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Collection, Document } from "mongodb";

export const LOGIN_RATE_LIMITS = {
  account: { limit: 10, windowMs: 15 * 60 * 1000 },
  ip: { limit: 30, windowMs: 15 * 60 * 1000 },
} as const;

export type LoginRateLimitRecord = {
  _id: string;
  count: number;
  expiresAt: Date;
  updatedAt: Date;
};

export type LoginRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/** Return a validated client address from platform-provided proxy headers. */
export function getClientAddress(headers: Headers): string {
  const candidates = [
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];

  for (const candidate of candidates) {
    const address = candidate?.trim();
    if (address && isIP(address)) return address.toLowerCase();
  }
  return "unknown";
}

/** HMAC identifiers so raw email addresses and IP addresses are not stored. */
export function createLoginRateLimitKey(
  secret: string,
  scope: "account" | "ip",
  value: string,
): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return createHmac("sha256", secret)
    .update("callflow:login-rate-limit:v1\0")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex");
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000;
}

/**
 * Atomically consume one attempt in a MongoDB-backed fixed window.
 * The TTL index is cleanup only; expiry is also enforced in the update itself.
 */
export async function consumeLoginRateLimit(
  collection: Collection<LoginRateLimitRecord>,
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<LoginRateLimitResult> {
  if (!key || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1000) {
    throw new Error("Invalid login rate-limit configuration");
  }

  const expiresAt = new Date(now.getTime() + windowMs);
  const expired = { $lte: [{ $ifNull: ["$expiresAt", new Date(0)] }, now] };
  const update: Document[] = [{
    $set: {
      count: {
        $cond: [
          expired,
          1,
          { $add: [{ $ifNull: ["$count", 0] }, 1] },
        ],
      },
      expiresAt: { $cond: [expired, expiresAt, "$expiresAt"] },
      updatedAt: now,
    },
  }];

  const options = {
    upsert: true,
    returnDocument: "after" as const,
    includeResultMetadata: false as const,
  };

  let record: LoginRateLimitRecord | null;
  try {
    record = await collection.findOneAndUpdate({ _id: key }, update, options);
  } catch (error) {
    // Two first requests can race to upsert the same _id. Retry as an update.
    if (!isDuplicateKeyError(error)) throw error;
    record = await collection.findOneAndUpdate(
      { _id: key },
      update,
      { ...options, upsert: false },
    );
  }

  if (!record) throw new Error("Unable to record login attempt");
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: record.count <= limit,
    retryAfterSeconds,
  };
}
