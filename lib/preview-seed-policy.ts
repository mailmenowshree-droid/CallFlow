export function isPreviewSeedEnabled(input: {
  vercelEnv?: string;
  enabled?: string;
  databaseName?: string;
}): boolean {
  const databaseName = input.databaseName?.trim().toLowerCase() ?? "";
  return input.vercelEnv === "preview" &&
    input.enabled === "true" &&
    /(?:^|[-_])preview$/.test(databaseName);
}
