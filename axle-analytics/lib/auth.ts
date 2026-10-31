export const ADMIN_COOKIE = "axle_admin";

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Server-only dashboard token. When unset, the dashboard stays locked. */
export function readAdminToken(): string | null {
  return process.env.ANALYTICS_DASHBOARD_TOKEN?.trim() || null;
}