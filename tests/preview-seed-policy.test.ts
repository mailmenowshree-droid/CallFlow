import { describe, expect, it } from "vitest";
import { isPreviewSeedEnabled } from "../lib/preview-seed-policy";

describe("isPreviewSeedEnabled", () => {
  it("requires preview environment, explicit opt-in, and a dedicated preview database", () => {
    expect(isPreviewSeedEnabled({
      vercelEnv: "preview",
      enabled: "true",
      databaseName: "callflow-preview",
    })).toBe(true);
    expect(isPreviewSeedEnabled({
      vercelEnv: "preview",
      enabled: "true",
      databaseName: "callflow_preview",
    })).toBe(true);
  });

  it("rejects production, missing opt-in, and the default database name", () => {
    expect(isPreviewSeedEnabled({
      vercelEnv: "production",
      enabled: "true",
      databaseName: "callflow-preview",
    })).toBe(false);
    expect(isPreviewSeedEnabled({
      vercelEnv: "preview",
      enabled: "false",
      databaseName: "callflow-preview",
    })).toBe(false);
    expect(isPreviewSeedEnabled({
      vercelEnv: "preview",
      enabled: "true",
      databaseName: "callflow",
    })).toBe(false);
    expect(isPreviewSeedEnabled({
      vercelEnv: "preview",
      enabled: "true",
    })).toBe(false);
  });
});
