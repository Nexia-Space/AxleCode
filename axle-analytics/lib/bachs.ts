/**
 * Bachs billing read model for the Revenue page.
 *
 * The API base URL is derived from the key prefix, exactly like account-api does
 * (`sk_sandbox_*` → sandbox, `sk_live_*` → production). Only
 * `POST /v1/checkout-sessions` is used elsewhere in this repo, so the read
 * endpoint is parsed defensively: unknown shapes degrade to empty results rather
 * than inventing numbers.
 *
 * Semantics used by the UI:
 *  - `amount`    → the checkout total (`amount` / `total`).
 *  - `collected` → what actually landed (`amount_paid`), falling back to `amount`.
 *  - `fees`      → processor fees, when the payload exposes them.
 *  - only completed checkouts count; the rest are reported as `excludedPayments`.
 */

const SANDBOX_API_URL = "https://sandbox-api.bachs.io";
const LIVE_API_URL = "https://api.bachs.io";
const MAX_PAGES = 5;

export interface BachsCurrencyTotal {
  currency: string;
  amount: number;
  collected: number;
  fees: number;
  payments: number;
}

export interface BachsStatusCount {
  status: string;
  count: number;
}

export interface BachsRecentPayment {
  id: string;
  transactionDate: string;
  customerName: string | null;
  planId: string | null;
  purpose: string | null;
  amount: number;
  currency: string;
  status: string;
}

export interface BachsRevenue {
  configured: boolean;
  reachable: boolean;
  mode: "live" | "sandbox" | null;
  error: string | null;
  totalPayments: number;
  excludedPayments: number;
  fetchedAt: string;
  byCurrency: BachsCurrencyTotal[];
  byStatus: BachsStatusCount[];
  recent: BachsRecentPayment[];
  amountNote: string | null;
}

const COMPLETED_STATUSES = new Set([
  "completed",
  "complete",
  "paid",
  "succeeded",
  "successful",
  "captured",
]);

function baseUrl(apiKey: string): string {
  const override = process.env.AXLE_BACHS_API_URL?.trim();
  if (override) return override.replace(/\/+$/u, "");
  return apiKey.startsWith("sk_sandbox_") ? SANDBOX_API_URL : LIVE_API_URL;
}

function asItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === "object") {
    for (const key of ["data", "items", "results", "payments"]) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function nextCursor(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const pagination =
    record.pagination !== null && typeof record.pagination === "object"
      ? (record.pagination as Record<string, unknown>)
      : record;
  if (pagination.has_more !== true && record.has_more !== true) return null;
  for (const container of [pagination, record]) {
    for (const key of ["next_cursor", "next", "next_page_token", "cursor"]) {
      const value = container[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return key.endsWith("_cents") ? value / 100 : value;
    }
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/u.test(value)) {
      const parsed = Number(value);
      return key.endsWith("_cents") ? parsed / 100 : parsed;
    }
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function nested(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function getJson(
  url: string,
  apiKey: string,
): Promise<{ ok: true; payload: unknown } | { ok: false; status: number }> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: true, payload: null };
  }
}

export async function loadBachsRevenue(): Promise<BachsRevenue> {
  const apiKey = process.env.AXLE_BACHS_API_KEY?.trim();
  const base: BachsRevenue = {
    configured: false,
    reachable: false,
    mode: null,
    error: "AXLE_BACHS_API_KEY is not configured.",
    totalPayments: 0,
    excludedPayments: 0,
    fetchedAt: new Date().toISOString(),
    byCurrency: [],
    byStatus: [],
    recent: [],
    amountNote: null,
  };
  if (!apiKey) return base;

  const result: BachsRevenue = {
    ...base,
    configured: true,
    mode: apiKey.startsWith("sk_sandbox_") ? "sandbox" : "live",
    error: null,
  };
  result.fetchedAt = new Date().toISOString();

  const apiBase = baseUrl(apiKey);
  const payments: unknown[] = [];

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor !== null) query.set("cursor", cursor);
    let response: Awaited<ReturnType<typeof getJson>>;
    try {
      response = await getJson(`${apiBase}/v1/payments?${query.toString()}`, apiKey);
    } catch {
      result.error = "Could not reach the Bachs API.";
      return result;
    }
    if (!response.ok) {
      result.error =
        response.status === 401
          ? "Bachs rejected the API key (401). It may be rotated or belong to the sandbox."
          : `Bachs payments request failed (${response.status}).`;
      return result;
    }
    result.reachable = true;
    payments.push(...asItems(response.payload));
    cursor = nextCursor(response.payload);
    if (cursor === null) break;
  }

  const currencies = new Map<string, BachsCurrencyTotal>();
  const statuses = new Map<string, number>();
  const recent: BachsRecentPayment[] = [];
  let excluded = 0;
  let unparsedAmounts = 0;

  for (const item of payments) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const status = (pickString(record, ["status", "payment_status", "state"]) ?? "unknown").toLowerCase();
    if (!COMPLETED_STATUSES.has(status)) {
      excluded += 1;
      continue;
    }

    const meta = { ...nested(record, "metadata"), ...nested(record, "meta") };
    const customer = nested(record, "customer");
    const currency = (pickString(record, ["currency", "currency_code"]) ?? "USD").toUpperCase();

    const amount = pickNumber(record, ["amount", "total", "amount_total", "gross_amount", "price"]);
    const collected =
      pickNumber(record, ["amount_paid", "amount_received", "net_amount", "amount_paid_cents"]) ??
      amount;
    const fees = pickNumber(record, ["fees", "fee", "amount_fees", "processing_fee"]) ?? 0;

    if (amount === null && collected === null) unparsedAmounts += 1;

    const bucket = currencies.get(currency) ?? {
      currency,
      amount: 0,
      collected: 0,
      fees: 0,
      payments: 0,
    };
    bucket.amount += amount ?? collected ?? 0;
    bucket.collected += collected ?? 0;
    bucket.fees += fees;
    bucket.payments += 1;
    currencies.set(currency, bucket);

    statuses.set(status, (statuses.get(status) ?? 0) + 1);

    recent.push({
      id: pickString(record, ["id", "_id", "payment_id", "checkout_id"]) ?? `payment-${recent.length}`,
      transactionDate:
        pickString(record, ["created_at", "createdAt", "transaction_date", "date", "paid_at"]) ??
        new Date().toISOString(),
      customerName:
        pickString(customer, ["name", "full_name"]) ??
        pickString(record, ["customer_name", "customer_email", "email"]) ??
        pickString(customer, ["email"]),
      planId: pickString(meta, ["plan_id"]) ?? pickString(record, ["plan_id"]),
      purpose: pickString(meta, ["purpose"]) ?? pickString(record, ["purpose"]),
      amount: amount ?? collected ?? 0,
      currency,
      status,
    });
  }

  recent.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  result.totalPayments = payments.length - excluded;
  result.excludedPayments = excluded;
  result.byCurrency = [...currencies.values()].sort((a, b) => b.collected - a.collected);
  result.byStatus = [...statuses.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  result.recent = recent.slice(0, 20);
  result.amountNote =
    unparsedAmounts > 0
      ? `${unparsedAmounts} completed checkout(s) had no recognised amount field.`
      : null;

  return result;
}