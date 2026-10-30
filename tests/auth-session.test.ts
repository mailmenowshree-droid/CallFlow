import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  findOne: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/mongodb", () => ({ getDatabase: mocks.getDatabase }));

import {
  createSessionToken,
  readSession,
  requireSession,
  SESSION_COOKIE,
} from "@/lib/auth";

const secret = "callflow-test-session-secret-32-bytes";
let cookieToken: string | null = null;

const activeManager = {
  id: "user-1",
  email: "manager@example.com",
  name: "Current Manager",
  role: "Manager",
  active: true,
};

function installCookie(token: string | null) {
  cookieToken = token;
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = secret;
  cookieToken = null;
  mocks.cookies.mockReset();
  mocks.cookies.mockImplementation(() => ({
    get: (name: string) => name === SESSION_COOKIE && cookieToken
      ? { value: cookieToken }
      : undefined,
  }));
  mocks.findOne.mockReset();
  mocks.findOne.mockResolvedValue(activeManager);
  mocks.getDatabase.mockReset();
  mocks.getDatabase.mockImplementation(async () => ({
    collection: () => ({ findOne: mocks.findOne }),
  }));
});

describe("readSession", () => {
  it("loads the active user from MongoDB instead of trusting role claims in the cookie", async () => {
    const token = await createSessionToken({
      id: "user-1",
      email: "old-email@example.com",
      name: "Old Name",
      role: "Engineer",
    });
    installCookie(token);

    await expect(readSession()).resolves.toEqual({
      id: "user-1",
      email: "manager@example.com",
      name: "Current Manager",
      role: "Manager",
    });
    expect(mocks.findOne).toHaveBeenCalledWith({ id: "user-1", active: true });
  });

  it("rejects a missing session cookie without querying the database", async () => {
    await expect(readSession()).resolves.toBeNull();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("rejects a tampered session token", async () => {
    const token = await createSessionToken({
      id: "user-1",
      email: activeManager.email,
      name: activeManager.name,
      role: "Manager",
    });
    installCookie(`${token}tampered`);

    await expect(readSession()).resolves.toBeNull();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("rejects an expired session token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email: activeManager.email,
      name: activeManager.name,
      role: "Manager",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(activeManager.id)
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(new TextEncoder().encode(secret));
    installCookie(token);

    await expect(readSession()).resolves.toBeNull();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("rejects a user whose account has been deactivated", async () => {
    const token = await createSessionToken({
      id: "user-1",
      email: activeManager.email,
      name: activeManager.name,
      role: "Manager",
    });
    installCookie(token);
    mocks.findOne.mockResolvedValue(null);

    await expect(readSession()).resolves.toBeNull();
    expect(mocks.findOne).toHaveBeenCalledWith({ id: "user-1", active: true });
  });
});

describe("requireSession", () => {
  it("rejects an authenticated user whose current database role is not allowed", async () => {
    const token = await createSessionToken({
      id: "user-1",
      email: activeManager.email,
      name: activeManager.name,
      role: "Manager",
    });
    installCookie(token);
    mocks.findOne.mockResolvedValue({ ...activeManager, role: "Engineer" });

    await expect(requireSession(["Manager"])).rejects.toThrow("FORBIDDEN");
  });

  it("returns the current database-backed user when the role is allowed", async () => {
    const token = await createSessionToken({
      id: "user-1",
      email: activeManager.email,
      name: activeManager.name,
      role: "Engineer",
    });
    installCookie(token);

    await expect(requireSession(["Manager"])).resolves.toMatchObject({
      id: "user-1",
      role: "Manager",
    });
  });
});
