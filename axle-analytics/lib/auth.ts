export const ADMIN_COOKIE = "axle_admin";

export const ADMIN_EMAIL = "fawassaka862@gmail.com";

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function readAdminIdentity(): Promise<
  { userId: string; email: string } | { userId: null; email: null }
> {
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return { userId: null, email: null };

  const user = await currentUser();
  const email = user?.emailAddresses
    .map((entry) => entry.emailAddress.trim().toLowerCase())
    .find((entry) => entry === ADMIN_EMAIL);
  return email ? { userId, email } : { userId: null, email: null };
}
