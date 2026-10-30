export const PASSWORD_MIN_LENGTH = 14;
export const PASSWORD_MAX_LENGTH = 1024;

/** Shared password bounds for account creation and initial Manager bootstrap. */
export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH;
}
