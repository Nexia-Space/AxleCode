import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/analytics.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitorId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  label TEXT,
  at INTEGER NOT NULL,
  engagedMs INTEGER,
  downloadId TEXT,
  requestId TEXT,
  environmentId TEXT,
  threadId TEXT,
  turnId TEXT,
  platform TEXT,
  release TEXT,
  file TEXT,
  outcome TEXT,
  referrer TEXT,
  browser TEXT,
  os TEXT,
  device TEXT,
  country TEXT,
  colo TEXT,
  language TEXT,
  timezone TEXT,
  viewport TEXT,
  status INTEGER,
  model TEXT,
  provider TEXT,
  inputTokens INTEGER,
  cachedInputTokens INTEGER,
  outputTokens INTEGER,
  reasoningOutputTokens INTEGER,
  totalTokens INTEGER,
  toolUses INTEGER,
  costUsd REAL
);
CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);
CREATE INDEX IF NOT EXISTS idx_events_request ON events (requestId);
CREATE INDEX IF NOT EXISTS idx_events_download ON events (downloadId, kind);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, at);

CREATE TABLE IF NOT EXISTS sessions (
  sessionId TEXT PRIMARY KEY,
  visitorId TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL,
  engagedMs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitors (
  visitorId TEXT PRIMARY KEY,
  firstSeenAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS installations (
  installationId TEXT PRIMARY KEY,
  firstSeenAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dailyMetrics (
  date TEXT PRIMARY KEY,
  uniqueVisitors INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  pageViews INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  downloadClicks INTEGER NOT NULL DEFAULT 0,
  downloadPageOpens INTEGER NOT NULL DEFAULT 0,
  downloadRequests INTEGER NOT NULL DEFAULT 0,
  downloadErrors INTEGER NOT NULL DEFAULT 0,
  demoInteractions INTEGER NOT NULL DEFAULT 0,
  engagedMs INTEGER NOT NULL DEFAULT 0,
  appUsers INTEGER NOT NULL DEFAULT 0,
  appLaunches INTEGER NOT NULL DEFAULT 0,
  modelRequests INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS metricTotals (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
`;

export const METRIC_KEYS = [
  "uniqueVisitors",
  "sessions",
  "pageViews",
  "downloads",
  "downloadClicks",
  "downloadPageOpens",
  "downloadRequests",
  "downloadErrors",
  "demoInteractions",
  "engagedMs",
  "appUsers",
  "appLaunches",
  "modelRequests",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;

const KIND_TO_METRIC: Record<string, MetricKey> = {
  page_view: "pageViews",
  download: "downloads",
  download_click: "downloadClicks",
  download_page_open: "downloadPageOpens",
  download_request: "downloadRequests",
  download_error: "downloadErrors",
  demo_interaction: "demoInteractions",
  desktop_render_interaction: "demoInteractions",
  model_request: "modelRequests",
  app_launch: "appLaunches",
};

export interface EventInput {
  visitorId: string;
  sessionId: string;
  source: string;
  kind: string;
  path: string;
  label?: string;
  at: number;
  engagedMs?: number;
  downloadId?: string;
  requestId?: string;
  environmentId?: string;
  threadId?: string;
  turnId?: string;
  platform?: string;
  release?: string;
  file?: string;
  outcome?: string;
  referrer?: string;
  browser?: string;
  os?: string;
  device?: string;
  country?: string;
  colo?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  status?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  toolUses?: number;
  costUsd?: number;
}

const globalForDb = globalThis as unknown as { __axleAnalyticsDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__axleAnalyticsDb) return globalForDb.__axleAnalyticsDb;

  const path = process.env.ANALYTICS_DB_PATH?.trim() || DEFAULT_DB_PATH;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  globalForDb.__axleAnalyticsDb = db;
  return db;
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isBackgroundUpdateEvent(source: string, path: string): boolean {
  return source === "edge" && (path === "/get/updates" || path.startsWith("/get/updates/"));
}

function clampText(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  return value.slice(0, max);
}

function ensureDailyRow(db: DatabaseSync, date: string): void {
  db.prepare("INSERT OR IGNORE INTO dailyMetrics (date) VALUES (?)").run(date);
}

function incrementDaily(db: DatabaseSync, date: string, increments: Partial<Metrics>): void {
  const entries = Object.entries(increments).filter(([, amount]) => (amount ?? 0) !== 0);
  if (entries.length === 0) return;
  ensureDailyRow(db, date);
  for (const [key, amount] of entries) {
    if (!METRIC_KEYS.includes(key as MetricKey)) continue;
    db.prepare(`UPDATE dailyMetrics SET ${key} = ${key} + ? WHERE date = ?`).run(
      Number(amount) || 0,
      date,
    );
  }
}

function incrementTotal(db: DatabaseSync, key: string, amount: number): void {
  if (amount === 0) return;
  db.prepare(
    "INSERT INTO metricTotals (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value",
  ).run(key, amount);
}

/** Records one analytics event and keeps the daily/all-time counters in sync. */
export function recordEvent(db: DatabaseSync, input: EventInput): void {
  if (isBackgroundUpdateEvent(input.source, input.path)) return;

  const at = Math.min(Date.now() + 60_000, Math.max(0, input.at));
  const date = utcDate(at);
  const daily: Partial<Metrics> = {};
  const shouldTrackSession = input.source !== "edge";

  if (input.kind !== "heartbeat") {
    const duplicate = input.requestId
      ? db.prepare("SELECT id FROM events WHERE requestId = ? LIMIT 1").get(input.requestId)
      : input.downloadId
        ? db
            .prepare("SELECT id FROM events WHERE downloadId = ? AND kind = ? LIMIT 1")
            .get(input.downloadId, input.kind)
        : null;
    if (duplicate) return;
  }

  const session = shouldTrackSession
    ? db.prepare("SELECT sessionId FROM sessions WHERE sessionId = ?").get(input.sessionId)
    : null;

  if (shouldTrackSession && !session) {
    db.prepare(
      "INSERT INTO sessions (sessionId, visitorId, source, path, startedAt, lastSeenAt, engagedMs) VALUES (?, ?, ?, ?, ?, ?, 0)",
    ).run(input.sessionId, input.visitorId, input.source, input.path.slice(0, 300), at, at);
    daily.sessions = 1;
    incrementTotal(db, "sessions", 1);
  } else if (session) {
    db.prepare("UPDATE sessions SET lastSeenAt = ?, path = ? WHERE sessionId = ?").run(
      at,
      input.path.slice(0, 300),
      input.sessionId,
    );
  }

  if (input.source === "site") {
    const visitor = db.prepare("SELECT visitorId FROM visitors WHERE visitorId = ?").get(input.visitorId);
    if (!visitor) {
      db.prepare("INSERT INTO visitors (visitorId, firstSeenAt, lastSeenAt) VALUES (?, ?, ?)").run(
        input.visitorId,
        at,
        at,
      );
      daily.uniqueVisitors = 1;
      incrementTotal(db, "uniqueVisitors", 1);
    } else {
      db.prepare("UPDATE visitors SET lastSeenAt = ? WHERE visitorId = ? AND lastSeenAt < ?").run(
        at,
        input.visitorId,
        at,
      );
    }
  }

  if (input.kind === "heartbeat") {
    const engagedMs = Math.min(Math.max(0, input.engagedMs ?? 0), 30_000);
    if (engagedMs > 0 && shouldTrackSession) {
      db.prepare("UPDATE sessions SET engagedMs = engagedMs + ?, lastSeenAt = ? WHERE sessionId = ?").run(
        engagedMs,
        at,
        input.sessionId,
      );
      daily.engagedMs = engagedMs;
      incrementTotal(db, "engagedMs", engagedMs);
    }
    incrementDaily(db, date, daily);
    return;
  }

  db.prepare(
    `INSERT INTO events (
      visitorId, sessionId, source, kind, path, label, at, engagedMs, downloadId, requestId,
      environmentId, threadId, turnId, platform, release, file, outcome, referrer, browser, os,
      device, country, colo, language, timezone, viewport, status, model, provider,
      inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens, toolUses, costUsd
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )`,
  ).run(
    input.visitorId,
    input.sessionId,
    input.source,
    input.kind,
    input.path.slice(0, 300),
    clampText(input.label, 200),
    at,
    input.engagedMs ?? null,
    clampText(input.downloadId, 100),
    clampText(input.requestId, 100),
    clampText(input.environmentId, 200),
    clampText(input.threadId, 200),
    clampText(input.turnId, 200),
    clampText(input.platform, 80),
    clampText(input.release, 80),
    clampText(input.file, 160),
    clampText(input.outcome, 80),
    clampText(input.referrer, 200),
    clampText(input.browser, 80),
    clampText(input.os, 80),
    clampText(input.device, 80),
    clampText(input.country, 20),
    clampText(input.colo, 20),
    clampText(input.language, 40),
    clampText(input.timezone, 80),
    clampText(input.viewport, 40),
    input.status ?? null,
    clampText(input.model, 200),
    clampText(input.provider, 100),
    input.inputTokens ?? null,
    input.cachedInputTokens ?? null,
    input.outputTokens ?? null,
    input.reasoningOutputTokens ?? null,
    input.totalTokens ?? null,
    input.toolUses ?? null,
    input.costUsd ?? null,
  );

  const metric = KIND_TO_METRIC[input.kind] ?? "appLaunches";
  daily[metric] = 1;
  incrementTotal(db, metric, 1);

  if (input.kind === "app_launch") {
    const installation = db
      .prepare("SELECT installationId FROM installations WHERE installationId = ?")
      .get(input.visitorId);
    if (!installation) {
      db.prepare(
        "INSERT INTO installations (installationId, firstSeenAt, lastSeenAt) VALUES (?, ?, ?)",
      ).run(input.visitorId, at, at);
      daily.appUsers = 1;
      incrementTotal(db, "appUsers", 1);
    } else {
      db.prepare(
        "UPDATE installations SET lastSeenAt = ? WHERE installationId = ? AND lastSeenAt < ?",
      ).run(at, input.visitorId, at);
    }
  }

  incrementDaily(db, date, daily);
}

const EMPTY_METRICS = (): Metrics =>
  Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as Metrics;

export interface DashboardPayload {
  totals: Metrics;
  daily: Array<Metrics & { date: string }>;
  recent: Array<Record<string, unknown>>;
  downloadBreakdown: Array<{ platform: string; clicks: number; requests: number; errors: number }>;
  environmentBreakdown: Array<{ browser: string; os: string; device: string; visitors: number }>;
}

export function buildDashboard(db: DatabaseSync): DashboardPayload {
  const totals = EMPTY_METRICS();
  for (const row of db.prepare("SELECT key, value FROM metricTotals").all() as Array<{
    key: string;
    value: number;
  }>) {
    if ((METRIC_KEYS as readonly string[]).includes(row.key)) {
      totals[row.key as MetricKey] = row.value;
    }
  }

  const dailyRows = db
    .prepare("SELECT * FROM dailyMetrics ORDER BY date DESC LIMIT 30")
    .all() as Array<Record<string, unknown>>;
  const daily = dailyRows.reverse().map((row) => {
    const metrics = EMPTY_METRICS();
    for (const key of METRIC_KEYS) {
      metrics[key] = Number(row[key] ?? 0);
    }
    return { date: String(row.date), ...metrics };
  });

  const recentRows = db
    .prepare(
      `SELECT kind, source, path, label, at, downloadId, requestId, platform, release, file,
              outcome, referrer, browser, os, device, country, colo, status, model, provider,
              inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens,
              toolUses, costUsd
       FROM events
       WHERE NOT (source = 'edge' AND (path = '/get/updates' OR path LIKE '/get/updates/%'))
         AND kind <> 'heartbeat'
       ORDER BY at DESC
       LIMIT 24`,
    )
    .all() as Array<Record<string, unknown>>;

  const downloadBreakdown = db
    .prepare(
      `SELECT COALESCE(platform, 'unknown') AS platform,
              SUM(CASE WHEN kind IN ('download', 'download_click') THEN 1 ELSE 0 END) AS clicks,
              SUM(CASE WHEN kind = 'download_request' THEN 1 ELSE 0 END) AS requests,
              SUM(CASE WHEN kind = 'download_error' THEN 1 ELSE 0 END) AS errors
       FROM events
       WHERE kind IN ('download', 'download_click', 'download_request', 'download_error')
       GROUP BY COALESCE(platform, 'unknown')
       ORDER BY clicks + requests DESC
       LIMIT 8`,
    )
    .all() as Array<{ platform: string; clicks: number; requests: number; errors: number }>;

  const environmentBreakdown = db
    .prepare(
      `SELECT COALESCE(browser, 'unknown') AS browser,
              COALESCE(os, 'unknown') AS os,
              COALESCE(device, 'unknown') AS device,
              COUNT(DISTINCT visitorId) AS visitors
       FROM events
       WHERE source = 'site' AND kind = 'page_view'
       GROUP BY COALESCE(browser, 'unknown'), COALESCE(os, 'unknown'), COALESCE(device, 'unknown')
       ORDER BY visitors DESC
       LIMIT 8`,
    )
    .all() as Array<{ browser: string; os: string; device: string; visitors: number }>;

  return {
    totals,
    daily,
    recent: recentRows,
    downloadBreakdown: downloadBreakdown.map((row) => ({
      platform: String(row.platform),
      clicks: Number(row.clicks ?? 0),
      requests: Number(row.requests ?? 0),
      errors: Number(row.errors ?? 0),
    })),
    environmentBreakdown: environmentBreakdown.map((row) => ({
      browser: String(row.browser),
      os: String(row.os),
      device: String(row.device),
      visitors: Number(row.visitors ?? 0),
    })),
  };
}