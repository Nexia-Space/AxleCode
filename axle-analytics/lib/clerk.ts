/**
 * Display names are not stored in Mongo — `axle_account_profiles.displayName` is
 * only written when a user edits their profile in the app, and none have. Clerk
 * is the identity provider, so it holds the real name.
 *
 * Requires CLERK_SECRET_KEY (Clerk Backend API). Without it we return no names
 * and the UI falls back to the user id.
 */

const CLERK_API = "https://api.clerk.com/v1/users";

export interface UserNameMap {
  configured: boolean;
  names: Map<string, string>;
  error: string | null;
}

interface ClerkUser {
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
  full_name?: unknown;
  primary_email_address_id?: unknown;
  email_addresses?: unknown;
}

function pickName(user: ClerkUser): string | null {
  if (typeof user.full_name === "string" && user.full_name.trim().length > 0) {
    return user.full_name.trim();
  }
  const first = typeof user.first_name === "string" ? user.first_name : "";
  const last = typeof user.last_name === "string" ? user.last_name : "";
  const combined = `${first} ${last}`.trim();
  if (combined.length > 0) return combined;
  if (typeof user.username === "string" && user.username.trim().length > 0) {
    return user.username.trim();
  }
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  const primaryId = typeof user.primary_email_address_id === "string" ? user.primary_email_address_id : null;
  const primary =
    emails.find((entry) => {
      if (entry === null || typeof entry !== "object") return false;
      return primaryId !== null && (entry as { id?: unknown }).id === primaryId;
    }) ?? emails[0];
  if (primary !== null && typeof primary === "object") {
    const address = (primary as { email_address?: unknown }).email_address;
    if (typeof address === "string" && address.length > 0) return address;
  }
  return null;
}

export async function loadUserNames(userIds: ReadonlyArray<string>): Promise<UserNameMap> {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    return {
      configured: false,
      names: new Map(),
      error: "Set CLERK_SECRET_KEY to resolve user names from Clerk.",
    };
  }
  if (userIds.length === 0) {
    return { configured: true, names: new Map(), error: null };
  }

  const names = new Map<string, string>();
  let error: string | null = null;

  await Promise.all(
    [...new Set(userIds)].map(async (userId) => {
      try {
        const response = await fetch(`${CLERK_API}/${encodeURIComponent(userId)}`, {
          headers: { authorization: `Bearer ${secret}` },
          next: { revalidate: 300 },
        });
        if (!response.ok) {
          error = `Clerk responded with ${response.status}.`;
          return;
        }
        const user = (await response.json()) as ClerkUser;
        const name = pickName(user);
        if (name !== null) names.set(userId, name);
      } catch {
        error = "Could not reach the Clerk Backend API.";
      }
    }),
  );

  return { configured: true, names, error };
}
export interface ClerkRosterEntry {
  id: string;
  name: string | null;
  createdAt: string | null;
}

export interface ClerkRoster {
  configured: boolean;
  error: string | null;
  users: ClerkRosterEntry[];
}

/**
 * The authoritative list of every signed-up account. Mongo only knows users who
 * have talked to account-api, so anyone who signed up and never used a model is
 * invisible there — Clerk is the source of truth for the roster.
 */
export async function loadClerkRoster(): Promise<ClerkRoster> {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    return {
      configured: false,
      error: "Set CLERK_SECRET_KEY to list every Clerk account, not just users with usage.",
      users: [],
    };
  }

  const users: ClerkRosterEntry[] = [];
  const pageSize = 100;
  const maxUsers = 5_000;

  for (let offset = 0; offset < maxUsers; offset += pageSize) {
    let response: Response;
    try {
      response = await fetch(
        `https://api.clerk.com/v1/users?limit=${pageSize}&offset=${offset}`,
        {
          headers: { authorization: `Bearer ${secret}` },
          next: { revalidate: 120 },
        },
      );
    } catch {
      return { configured: true, error: "Could not reach the Clerk Backend API.", users };
    }
    if (!response.ok) {
      return { configured: true, error: `Clerk responded with ${response.status}.`, users };
    }

    let batch: unknown;
    try {
      batch = await response.json();
    } catch {
      return { configured: true, error: "Clerk returned an unreadable payload.", users };
    }
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const entry of batch) {
      if (entry === null || typeof entry !== "object") continue;
      const record = entry as ClerkUser & { id?: unknown; created_at?: unknown };
      if (typeof record.id !== "string") continue;
      users.push({
        id: record.id,
        name: pickName(record),
        createdAt:
          typeof record.created_at === "number"
            ? new Date(record.created_at).toISOString()
            : null,
      });
    }

    if (batch.length < pageSize) break;
  }

  return { configured: true, error: null, users };
}
