import bcrypt from "bcryptjs";

/** New credentials only. Legacy accounts may still authenticate with their old password. */
export function passwordError(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 15) return "password_too_short";
  if (Buffer.byteLength(value, "utf8") > 72) return "password_exceeds_bcrypt_limit";
  return null;
}
export async function hashPassword(value: string): Promise<string> {
  const error = passwordError(value);
  if (error) throw Object.assign(new Error(error), { code: error, statusCode: 400 });
  return bcrypt.hash(value, 12);
}
/** Bounded, per-application account throttle, in addition to the IP rate limiter. */
export function createLoginThrottle() {
  const attempts = new Map<string, { count: number; expires: number }>();
  return {
    take(key: string): boolean {
      for (const [name, value] of attempts) if (value.expires <= Date.now()) attempts.delete(name);
      const current = attempts.get(key);
      if (current) { current.count++; return current.count <= 10; }
      if (attempts.size >= 5000) return false;
      attempts.set(key, { count: 1, expires: Date.now() + 15 * 60_000 });
      return true;
    },
    reset(key: string) { attempts.delete(key); },
  };
}
