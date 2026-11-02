import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_COOKIE, readAdminToken, timingSafeEqual } from "@/lib/auth";
import { loadBachsRevenue } from "@/lib/bachs";
import { loadClerkRoster } from "@/lib/clerk";
import { buildDashboard, getDb } from "@/lib/db";
import { loadDownloadBreakdown } from "@/lib/github";
import { loadAccountMetrics, loadProviderBreakdown, loadUserBreakdown } from "@/lib/mongo";

export async function GET() {
  const expected = readAdminToken();
  if (!expected) {
    return NextResponse.json(
      { error: "Server is not configured. Set ANALYTICS_DASHBOARD_TOKEN." },
      { status: 503 },
    );
  }

  const token = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  if (!token || !timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let account;
  let users;
  let providerBreakdown;
  try {
    [account, users, providerBreakdown] = await Promise.all([
      loadAccountMetrics(),
      loadUserBreakdown(),
      loadProviderBreakdown(),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mongo query failed.";
    console.error("Account metrics query failed", error);
    return NextResponse.json(
      { error: message.includes("MONGODB_URI") ? message : "Mongo query failed." },
      { status: 502 },
    );
  }

  // The roster lives in Clerk, downloads in GitHub, revenue in Bachs. None of them
  // may take the dashboard down, so every source degrades independently.
  const [roster, github, bachs] = await Promise.all([
    loadClerkRoster().catch(() => ({
      configured: false,
      error: "Roster lookup failed.",
      users: [] as Array<{
        id: string;
        name: string | null;
        email: string | null;
        createdAt: string | null;
      }>,
    })),
    loadDownloadBreakdown().catch(() => null),
    loadBachsRevenue().catch(() => null),
  ]);

  const rosterNameById = new Map(
    roster.users.map((entry) => [entry.id, entry.name ?? entry.email ?? ""]),
  );

  const usersWithNames = users.map((user) => ({
    ...user,
    displayName: user.displayName ?? rosterNameById.get(user.userId) ?? null,
  }));

  // Anyone Clerk knows about who has never touched account-api still belongs here.
  const knownUserIds = new Set(usersWithNames.map((user) => user.userId));
  for (const entry of roster.users) {
    if (knownUserIds.has(entry.id)) continue;
    usersWithNames.push({
      userId: entry.id,
      displayName: entry.name ?? entry.email,
      plan: null,
      requests: 0,
      totalTokens: 0,
      costUsd: 0,
      lastActiveAt: null,
      providers: [],
      topModel: null,
    });
  }
  usersWithNames.sort((a, b) => {
    if (b.requests !== a.requests) return b.requests - a.requests;
    return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
  });

  const namedUsers = usersWithNames;

  // `users.total` comes from the profile count; the roster is the real answer.
  const accountWithRoster = {
    ...account,
    // Only replace the Mongo account count when the Clerk roster completed.
    // A partial Clerk response must never make the dashboard undercount users.
    users: {
      ...account.users,
      total: roster.configured && roster.error === null ? namedUsers.length : account.users.total,
    },
  };

  const namedProviderUsers = providerBreakdown.providerUsers.map((entry) => ({
    ...entry,
    users: entry.users.map((user) => ({
      ...user,
      displayName: user.displayName ?? rosterNameById.get(user.userId) ?? null,
    })),
  }));

  // Event-level download counters come from the local ingest store; the real
  // installer totals come from GitHub release assets.
  let downloads = {
    total: 0,
    clicks: 0,
    requests: 0,
    errors: 0,
    byPlatform: [] as Array<{ platform: string; clicks: number; requests: number; errors: number }>,
  };
  try {
    const local = buildDashboard(getDb());
    downloads = {
      total: local.totals.downloads,
      clicks: local.totals.downloadClicks,
      requests: local.totals.downloadRequests,
      errors: local.totals.downloadErrors,
      byPlatform: local.downloadBreakdown,
    };
  } catch (error) {
    console.error("Local download metrics unavailable", error);
  }

  return NextResponse.json(
    {
      account: accountWithRoster,
      users: namedUsers,
      providers: providerBreakdown.providers,
      providerUsers: namedProviderUsers,
      names: { configured: roster.configured, error: roster.error },
      today: new Date().toISOString().slice(0, 10),
      downloads,
      github,
      bachs,
      sources: [
        { key: "mongo", label: "Account database", status: "connected", detail: "MongoDB account-api" },
        {
          key: "clerk",
          label: "Identity roster",
          status: roster.configured && roster.error === null ? "connected" : roster.configured ? "degraded" : "missing",
          detail: roster.error ?? "Clerk user roster",
        },
        {
          key: "github",
          label: "Installer downloads",
          status: github?.reachable ? "connected" : "degraded",
          detail: github?.error ?? "GitHub release assets",
        },
        {
          key: "bachs",
          label: "Payments",
          status: bachs?.reachable ? "connected" : bachs?.configured ? "degraded" : "missing",
          detail: bachs?.error ?? "Bachs completed checkouts",
        },
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
