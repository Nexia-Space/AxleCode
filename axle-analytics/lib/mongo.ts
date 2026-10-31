import { MongoClient, type Db } from "mongodb";

import { normalizeProviderId, providerInfo } from "./providers";

const globalForMongo = globalThis as unknown as {
  __axleMongoClientPromise?: Promise<MongoClient>;
};

const CLIENT_OPTIONS = {
  maxPoolSize: 10,
  // The account database is a remote cluster (mongodb+srv). The defaults used by
  // the account-api Worker (5s) are too tight for a cold server-to-server
  // connect from here, which surfaced as intermittent dashboard failures.
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
  socketTimeoutMS: 45_000,
} as const;

function connectionString(): string {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  return uri;
}

/** Same rule account-api uses: database name from the URI path, defaulting to `axle`. */
function databaseName(uri: string): string {
  try {
    return new URL(uri).pathname.replace(/^\//u, "").trim() || "axle";
  } catch {
    return "axle";
  }
}

/**
 * One shared connect promise per process. Caching the promise (not the client)
 * means concurrent requests during a cold start share a single handshake
 * instead of racing several. A failed connect clears the cache so the next
 * request can retry.
 */
function clientPromise(): Promise<MongoClient> {
  const uri = connectionString();
  let promise = globalForMongo.__axleMongoClientPromise;
  if (!promise) {
    const client = new MongoClient(uri, CLIENT_OPTIONS);
    promise = client.connect().catch((error: unknown) => {
      globalForMongo.__axleMongoClientPromise = undefined;
      throw error;
    });
    globalForMongo.__axleMongoClientPromise = promise;
  }
  return promise;
}

async function getDb(): Promise<Db> {
  const uri = connectionString();
  const client = await clientPromise();
  return client.db(databaseName(uri));
}

const PAID_PLANS = new Set(["pro", "pro-plus", "ultra"]);

/**
 * The analytics reporter stores the desktop provider instance (`axle`) on every
 * event. The real upstream is the model prefix (`tokenhabour/...`), so derive
 * it before grouping. Models without a prefix fall back to the recorded
 * provider.
 */
const REAL_PROVIDER_STAGE = {
  $addFields: {
    realProvider: {
      $cond: [
        { $gt: [{ $indexOfCP: ["$model", "/"] }, 0] },
        { $arrayElemAt: [{ $split: ["$model", "/"] }, 0] },
        "$provider",
      ],
    },
  },
} as const;

export interface AccountMetrics {
  users: {
    total: number;
    pro: number;
    byPlan: Array<{ plan: string; count: number }>;
  };
  requests: {
    total: number;
    totalTokens: number;
    perDay: Array<{ date: string; turns: number; tokens: number; costUsd: number }>;
    from: string | null;
    to: string | null;
  };
  providers: Array<{ provider: string; turns: number; totalTokens: number; models: number }>;
  revenue: {
    activeSubscriptions: number;
    subscriptionPlan: string | null;
    billingEvents: number;
    ledgerEntries: number;
    recordedCostUsd: number;
  };
}

/** Read-only aggregation over the account-api collections. Never writes. */
export async function loadAccountMetrics(): Promise<AccountMetrics> {
  const db = await getDb();

  const [userTotal, planRows, subscriptionRows, usageRows, dailyRows, providerRows, billingEvents, ledgerEntries] =
    await Promise.all([
      db.collection("axle_account_profiles").estimatedDocumentCount(),
      db
        .collection("axle_credit_accounts")
        .aggregate([{ $group: { _id: "$planId", count: { $sum: 1 } } }])
        .toArray(),
      db
        .collection("axle_billing_subscriptions")
        .find({ status: "active" }, { projection: { planId: 1 } })
        .toArray(),
      db
        .collection("axle_account_usage_events")
        .aggregate([
          {
            $group: {
              _id: null,
              turns: { $sum: 1 },
              tokens: { $sum: "$totalTokens" },
              costUsd: { $sum: "$costUsd" },
              from: { $min: "$occurredAt" },
              to: { $max: "$occurredAt" },
            },
          },
        ])
        .toArray(),
      db
        .collection("axle_account_usage_daily")
        .aggregate([
          {
            $group: {
              _id: "$usageDate",
              turns: { $sum: "$turnCount" },
              tokens: { $sum: "$totalTokens" },
              costUsd: { $sum: "$costUsd" },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      db
        .collection("axle_account_usage_models")
        .aggregate([
          REAL_PROVIDER_STAGE,
          {
            $group: {
              _id: "$realProvider",
              turns: { $sum: "$turnCount" },
              totalTokens: { $sum: "$totalTokens" },
              models: { $sum: 1 },
            },
          },
          { $sort: { turns: -1 } },
        ])
        .toArray(),
      db.collection("axle_billing_events").estimatedDocumentCount(),
      db.collection("axle_credit_ledger").estimatedDocumentCount(),
    ]);

  const byPlan = planRows
    .map((row) => ({ plan: String(row._id ?? "unknown"), count: Number(row.count ?? 0) }))
    .sort((a, b) => b.count - a.count);

  const proFromPlans = planRows
    .filter((row) => PAID_PLANS.has(String(row._id)))
    .reduce((total, row) => total + Number(row.count ?? 0), 0);

  const usage = usageRows[0] as
    | { turns: number; tokens: number; costUsd: number; from: Date; to: Date }
    | undefined;

  const providerMap = new Map<
    string,
    { provider: string; turns: number; totalTokens: number; models: number }
  >();
  for (const row of providerRows) {
    const provider = normalizeProviderId(String(row._id ?? "unknown"));
    const entry = providerMap.get(provider) ?? {
      provider,
      turns: 0,
      totalTokens: 0,
      models: 0,
    };
    entry.turns += Number(row.turns ?? 0);
    entry.totalTokens += Number(row.totalTokens ?? 0);
    entry.models += Number(row.models ?? 0);
    providerMap.set(provider, entry);
  }

  return {
    users: {
      total: userTotal,
      pro: Math.max(proFromPlans, subscriptionRows.length),
      byPlan,
    },
    requests: {
      total: Number(usage?.turns ?? 0),
      totalTokens: Number(usage?.tokens ?? 0),
      perDay: dailyRows.map((row) => ({
        date: String(row._id),
        turns: Number(row.turns ?? 0),
        tokens: Number(row.tokens ?? 0),
        costUsd: Number(row.costUsd ?? 0),
      })),
      from: usage?.from ? new Date(usage.from).toISOString().slice(0, 10) : null,
      to: usage?.to ? new Date(usage.to).toISOString().slice(0, 10) : null,
    },
    providers: [...providerMap.values()].sort((a, b) => b.turns - a.turns),
    revenue: {
      activeSubscriptions: subscriptionRows.length,
      subscriptionPlan: subscriptionRows[0] ? String(subscriptionRows[0].planId ?? "") || null : null,
      billingEvents,
      ledgerEntries,
      // `costUsd` on usage events is what Axle paid model providers, not revenue.
      recordedCostUsd: Number(usage?.costUsd ?? 0),
    },
  };
}
export interface UserRow {
  userId: string;
  displayName: string | null;
  plan: string | null;
  requests: number;
  totalTokens: number;
  costUsd: number;
  lastActiveAt: string | null;
  providers: string[];
  topModel: string | null;
}

export interface ProviderRow {
  provider: string;
  name: string;
  url: string | null;
  users: number;
  requests: number;
  /** Requests recorded in the current UTC day. */
  requestsToday: number;
  totalTokens: number;
  models: number;
}

export interface ProviderUserRow {
  provider: string;
  name: string;
  url: string | null;
  users: Array<{
    userId: string;
    displayName: string | null;
    requests: number;
    tokens: number;
    lastActiveAt: string | null;
  }>;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Per-user rollup: usage, plan, providers used and last activity. */
export async function loadUserBreakdown(): Promise<UserRow[]> {
  const db = await getDb();

  const [usageRows, profiles, accounts, topModels, sessionUsers, deviceUsers] = await Promise.all([
    db
      .collection("axle_account_usage_events")
      .aggregate([
        REAL_PROVIDER_STAGE,
        {
          $group: {
            _id: "$userId",
            requests: { $sum: 1 },
            totalTokens: { $sum: "$totalTokens" },
            costUsd: { $sum: "$costUsd" },
            lastActiveAt: { $max: "$occurredAt" },
            providers: { $addToSet: "$realProvider" },
          },
        },
        { $sort: { totalTokens: -1 } },
      ])
      .toArray(),
    db
      .collection("axle_account_profiles")
      .find({}, { projection: { displayName: 1 } })
      .toArray(),
    db
      .collection("axle_credit_accounts")
      .find({}, { projection: { planId: 1 } })
      .toArray(),
    db
      .collection("axle_account_usage_models")
      .aggregate([
        { $sort: { turnCount: -1, totalTokens: -1, lastUsedAt: -1 } },
        { $group: { _id: "$userId", model: { $first: "$model" } } },
      ])
      .toArray(),
    db.collection("axle_account_sessions").distinct("userId"),
    db.collection("axle_account_devices").distinct("userId"),
  ]);

  const nameById = new Map(profiles.map((row) => [String(row._id), String(row.displayName ?? "")]));
  const planById = new Map(accounts.map((row) => [String(row._id), String(row.planId ?? "")]));
  const modelById = new Map(topModels.map((row) => [String(row._id), String(row.model ?? "")]));

  // Every identity with real activity. Credit-account rows alone are not enough:
  // the collection also carries test fixtures (`test-user`, `probe-user`) and a
  // legacy id, which would otherwise show up as nameless "users".
  const identityIds = new Set<string>();
  for (const id of sessionUsers) identityIds.add(String(id));
  for (const id of deviceUsers) identityIds.add(String(id));
  for (const row of usageRows) identityIds.add(String(row._id));
  for (const row of profiles) {
    if (String(row.displayName ?? "").length > 0) identityIds.add(String(row._id));
  }

  const usageById = new Map(usageRows.map((row) => [String(row._id), row]));

  return [...identityIds]
    .map((userId) => {
      const row = usageById.get(userId);
      const displayName = nameById.get(userId);
      const plan = planById.get(userId);
      const topModel = modelById.get(userId);
      return {
        userId,
        displayName: displayName && displayName.length > 0 ? displayName : null,
        plan: plan && plan.length > 0 ? plan : null,
        requests: Number(row?.requests ?? 0),
        totalTokens: Number(row?.totalTokens ?? 0),
        costUsd: Number(row?.costUsd ?? 0),
        lastActiveAt: iso(row?.lastActiveAt),
        providers: Array.isArray(row?.providers)
          ? [
              ...new Set(
                (row.providers as unknown[])
                  .map(String)
                  .filter((value) => value.length > 0)
                  .map(normalizeProviderId),
              ),
            ]
          : [],
        topModel: topModel && topModel.length > 0 ? topModel : null,
      };
    })
    .sort((a, b) => {
      if (b.requests !== a.requests) return b.requests - a.requests;
      return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
    });
}

/** Provider rollup plus which users touch each provider. */
export async function loadProviderBreakdown(): Promise<{
  providers: ProviderRow[];
  providerUsers: ProviderUserRow[];
}> {
  const db = await getDb();

  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const [byProvider, byProviderUser, profiles, modelCounts, byProviderToday] = await Promise.all([
    db
      .collection("axle_account_usage_events")
      .aggregate([
        REAL_PROVIDER_STAGE,
        {
          $group: {
            _id: "$realProvider",
            users: { $addToSet: "$userId" },
            requests: { $sum: 1 },
            totalTokens: { $sum: "$totalTokens" },
          },
        },
        { $sort: { requests: -1 } },
      ])
      .toArray(),
    db
      .collection("axle_account_usage_events")
      .aggregate([
        REAL_PROVIDER_STAGE,
        {
          $group: {
            _id: { provider: "$realProvider", user: "$userId" },
            requests: { $sum: 1 },
            tokens: { $sum: "$totalTokens" },
            lastActiveAt: { $max: "$occurredAt" },
          },
        },
        { $sort: { requests: -1 } },
      ])
      .toArray(),
    db
      .collection("axle_account_profiles")
      .find({}, { projection: { displayName: 1 } })
      .toArray(),
    db
      .collection("axle_account_usage_models")
      .aggregate([REAL_PROVIDER_STAGE, { $group: { _id: "$realProvider", models: { $sum: 1 } } }])
      .toArray(),
    db
      .collection("axle_account_usage_events")
      .aggregate([
        { $match: { occurredAt: { $gte: todayStart } } },
        REAL_PROVIDER_STAGE,
        { $group: { _id: "$realProvider", requests: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const nameById = new Map(profiles.map((row) => [String(row._id), String(row.displayName ?? "")]));

  const todayById = new Map<string, number>();
  for (const row of byProviderToday) {
    const provider = normalizeProviderId(String(row._id ?? "unknown"));
    todayById.set(provider, (todayById.get(provider) ?? 0) + Number(row.requests ?? 0));
  }

  const modelsById = new Map<string, number>();
  for (const row of modelCounts) {
    const provider = normalizeProviderId(String(row._id ?? "unknown"));
    modelsById.set(provider, (modelsById.get(provider) ?? 0) + Number(row.models ?? 0));
  }

  const providerMap = new Map<
    string,
    { provider: string; users: Set<string>; requests: number; totalTokens: number }
  >();
  for (const row of byProvider) {
    const provider = normalizeProviderId(String(row._id ?? "unknown"));
    const entry = providerMap.get(provider) ?? {
      provider,
      users: new Set<string>(),
      requests: 0,
      totalTokens: 0,
    };
    for (const user of Array.isArray(row.users) ? row.users : []) entry.users.add(String(user));
    entry.requests += Number(row.requests ?? 0);
    entry.totalTokens += Number(row.totalTokens ?? 0);
    providerMap.set(provider, entry);
  }

  const grouped = new Map<
    string,
    Map<
      string,
      {
        userId: string;
        displayName: string | null;
        requests: number;
        tokens: number;
        lastActiveAt: string | null;
      }
    >
  >();
  for (const row of byProviderUser) {
    const provider = normalizeProviderId(
      String((row._id as { provider?: unknown }).provider ?? "unknown"),
    );
    const userId = String((row._id as { user?: unknown }).user ?? "unknown");
    const displayName = nameById.get(userId);
    const users = grouped.get(provider) ?? new Map();
    const existing = users.get(userId);
    const requests = Number(row.requests ?? 0);
    const tokens = Number(row.tokens ?? 0);
    const lastActiveAt = iso(row.lastActiveAt);
    if (existing) {
      existing.requests += requests;
      existing.tokens += tokens;
      if (
        lastActiveAt !== null &&
        (existing.lastActiveAt === null || lastActiveAt > existing.lastActiveAt)
      ) {
        existing.lastActiveAt = lastActiveAt;
      }
    } else {
      users.set(userId, {
        userId,
        displayName: displayName && displayName.length > 0 ? displayName : null,
        requests,
        tokens,
        lastActiveAt,
      });
    }
    grouped.set(provider, users);
  }

  return {
    providers: [...providerMap.values()]
      .map((entry) => {
        const info = providerInfo(entry.provider);
        return {
          provider: entry.provider,
          name: info.name,
          url: info.url,
          users: entry.users.size,
          requests: entry.requests,
          requestsToday: todayById.get(entry.provider) ?? 0,
          totalTokens: entry.totalTokens,
          models: modelsById.get(entry.provider) ?? 0,
        };
      })
      .sort((a, b) => b.requests - a.requests),
    providerUsers: [...grouped.entries()]
      .map(([provider, users]) => {
        const info = providerInfo(provider);
        return {
          provider,
          name: info.name,
          url: info.url,
          users: [...users.values()].sort((a, b) => b.requests - a.requests),
        };
      })
      .sort((a, b) => b.users.length - a.users.length),
  };
}
