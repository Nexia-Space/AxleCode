import type { BachsRevenue } from "@/lib/bachs";
import type { ProviderRow, ProviderUserRow, UserRow } from "@/lib/mongo";

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

export interface DownloadMetrics {
  total: number;
  clicks: number;
  requests: number;
  errors: number;
  byPlatform: Array<{
    platform: string;
    clicks: number;
    requests: number;
    errors: number;
  }>;
}

export interface DashboardPayload {
  account: AccountMetrics;
  users: UserRow[];
  providers: ProviderRow[];
  providerUsers: ProviderUserRow[];
  names: { configured: boolean; error: string | null };
  /** Server-side UTC day (YYYY-MM-DD), matching how daily metrics are bucketed. */
  today?: string;
  downloads: DownloadMetrics;
  github?: DownloadBreakdown | null;
  bachs?: BachsRevenue | null;
}

/** Safe fallback so a failed billing fetch cannot crash a page at render time. */
export const EMPTY_BACHS: BachsRevenue = {
  configured: false,
  reachable: false,
  mode: null,
  error: null,
  totalPayments: 0,
  excludedPayments: 0,
  fetchedAt: new Date(0).toISOString(),
  byCurrency: [],
  byStatus: [],
  recent: [],
  amountNote: null,
};

export interface DownloadBreakdown {
  site: "github";
  reachable: boolean;
  error: string | null;
  total: number;
  byPlatform: Array<{ platform: string; downloads: number }>;
  byRelease: Array<{ tag: string; publishedAt: string | null; downloads: number }>;
  latestTag: string | null;
}
