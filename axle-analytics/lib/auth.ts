import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "axle_admin";

function credentials(): { username: string; passcode: string } {
  return {
    username: process.env.ANALYTICS_ADMIN_USERNAME?.trim() || "axleadmin",
    passcode: process.env.ANALYTICS_ADMIN_PASSCODE?.trim() || "",
  };
}

function sessionToken(username: string, passcode: string): string {
  return createHmac("sha256", passcode).update(username).digest("hex");
}

export function authenticateAdmin(username: string, passcode: string): boolean {
  const expected = credentials();
  return timingSafeEqual(username.trim(), expected.username) && timingSafeEqual(passcode, expected.passcode);
}

export function isAdminConfigured(): boolean {
  return credentials().passcode.length > 0;
}

export function createAdminSession(): string {
  const expected = credentials();
  return sessionToken(expected.username, expected.passcode);
}

export function isValidAdminSession(value: string): boolean {
  const expected = credentials();
  if (!expected.passcode || value.length === 0) return false;
  return timingSafeEqual(value, sessionToken(expected.username, expected.passcode));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && cryptoTimingSafeEqual(left, right);
}
