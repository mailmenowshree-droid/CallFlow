export type LoginCredentials = { email: string; password: string };

/** Parse and normalize login input without modifying the password. */
export function parseLoginCredentials(value: unknown): LoginCredentials | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length === 0 ||
    password.length > 1024
  ) return null;
  return { email, password };
}
