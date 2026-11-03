import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest, resolveUserId, usageScanner } from "./entry.js";
import { CreditsLedger, utcDate } from "./ledger.js";
import { DAILY_FREE_CREDITS } from "./pricing.js";
import { MemoryCreditsStore } from "./stores/memory.js";

const FIXED_NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = "axle_test_key";

function request(path, init = {}, token = TOKEN) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://axle-gateway.axle-download-worker.workers.dev/v1${path}`, {
    headers,
    ...init,
  });
}

function environment(store = new MemoryCreditsStore(), extra = {}) {
  return { ledgerStore: store, now: () => FIXED_NOW, ...extra };
}

async function withStubbedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("the daily grant renews instead of accumulating", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.ensureDailyGrant("user-1");
  assert.equal(first.granted, true);
  assert.equal(first.balance, DAILY_FREE_CREDITS);

  const second = await ledger.ensureDailyGrant("user-1");
  assert.equal(second.granted, false);
  assert.equal(second.balance, DAILY_FREE_CREDITS);

  // Spend most of the day's credits; a new UTC day resets the free bucket,
  // it does not add to whatever was left.
  await ledger.charge("user-1", 60);
  const tomorrow = new CreditsLedger(store, { now: () => FIXED_NOW + DAY_MS });
  const third = await tomorrow.ensureDailyGrant("user-1");
  assert.equal(third.granted, true);
  assert.equal(third.balance, DAILY_FREE_CREDITS);
  const fourth = await new CreditsLedger(store, { now: () => FIXED_NOW + 2 * DAY_MS }).ensureDailyGrant("user-1");
  assert.equal(fourth.balance, DAILY_FREE_CREDITS);
  assert.notEqual(utcDate(FIXED_NOW), utcDate(FIXED_NOW + DAY_MS));
});

test("spend draws the free bucket first, then plan credits, then paid credits", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant("user-1");
  await ledger.planCredit("user-1", 1_000, "evt_plan_1");
  await ledger.credit("user-1", 500, { kind: "purchase" }, "evt_topup_1");

  const bucketsBefore = await ledger.buckets("user-1");
  assert.deepEqual(bucketsBefore, { free: 100, plan: 1_000, paid: 500 });
  assert.equal(await ledger.balance("user-1"), 1_600);

  // 40 free + 40 of the plan bucket: spend draws free first.
  await ledger.charge("user-1", 140);
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 960, paid: 500 });

  // Then the remaining plan bucket, and finally paid credits.
  await ledger.charge("user-1", 1_060);
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 0, paid: 400 });

  const rejected = await ledger.charge("user-1", 500);
  assert.equal(rejected.charged, false);
  assert.equal(rejected.balance, 400);
  assert.equal(await ledger.balance("user-1"), 400);
});

test("plan grants set the bucket and are idempotent per reference", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.planCredit("user-1", 2_000, "evt_1");
  assert.equal(first.applied, true);
  const retry = await ledger.planCredit("user-1", 2_000, "evt_1");
  assert.equal(retry.applied, false);
  assert.equal(await ledger.balance("user-1"), 2_000);

  // A new event (next month, or an upgrade) replaces, never accumulates.
  const nextMonth = await ledger.planCredit("user-1", 4_000, "evt_2");
  assert.equal(nextMonth.applied, true);
  assert.equal(await ledger.balance("user-1"), 4_000);
});

test("purchased credits persist and are idempotent per reference", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });

  const first = await ledger.credit("user-1", 1_000, { kind: "purchase" }, "evt_topup_1");
  assert.equal(first.applied, true);
  const retry = await ledger.credit("user-1", 1_000, { kind: "purchase" }, "evt_topup_1");
  assert.equal(retry.applied, false);
  assert.equal(await ledger.balance("user-1"), 1_000);

  const buckets = await ledger.buckets("user-1");
  assert.deepEqual(buckets, { free: 0, plan: 0, paid: 1_000 });
});

test("a charge never overdraws the balance", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant("user-1");

  const ok = await ledger.charge("user-1", 60);
  assert.equal(ok.charged, true);
  assert.equal(ok.balance, 40);

  const rejected = await ledger.charge("user-1", 60);
  assert.equal(rejected.charged, false);
  assert.equal(rejected.balance, 40);
  assert.equal(await ledger.balance("user-1"), 40);
});

test("GET /v1/models is empty until a hosted provider is enabled", async () => {
  const response = await handleRequest(request("/models", { method: "GET" }), environment());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, []);
});

test("GET /v1/credits renews the free bucket and reports all three buckets", async () => {
  const store = new MemoryCreditsStore();
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  const userId = await resolveUserId(request("/credits"));
  await ledger.planCredit(userId, 2_000, "evt_plan_1");
  await ledger.credit(userId, 250, { kind: "purchase" }, "evt_topup_1");

  const response = await handleRequest(
    request("/credits", { method: "GET" }),
    environment(store),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.credits, DAILY_FREE_CREDITS + 2_000 + 250);
  assert.equal(body.free_credits, DAILY_FREE_CREDITS);
  assert.equal(body.plan_credits, 2_000);
  assert.equal(body.paid_credits, 250);
  assert.equal(body.daily_free_credits, DAILY_FREE_CREDITS);
});

test("requests without an Axle key are rejected", async () => {
  const anonymous = new Request("https://axle-gateway.axle-download-worker.workers.dev/v1/credits");
  const response = await handleRequest(anonymous, environment());
  assert.equal(response.status, 401);
});

test("GET /v1/usage reports the ledger behind the balance, newest first", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store);
  const userId = await resolveUserId(request("/usage"));

  // A grant, then a spend whose real cost was refunded down.
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant(userId);
  await ledger.charge(userId, 12.5, { model: "gemma-4", reserved: true });
  await ledger.credit(userId, 4, { model: "gemma-4", kind: "refund" });

  const response = await handleRequest(request("/usage", { method: "GET" }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, "axle.usage");
  assert.equal(body.credit_usd, 0.005);
  assert.equal(body.entries.length, 3);
  assert.deepEqual(
    body.entries.map((entry) => [entry.kind, entry.credits]),
    [
      ["top_up", 4],
      ["spend", -12.5],
      ["daily_grant", 100],
    ],
  );
  assert.equal(body.entries[1].model, "gemma-4");
  assert.equal(body.entries[0].balance_after, 91.5);
  assert.equal(body.entries[0].created_at, FIXED_NOW);
});

test("GET /v1/usage rejects an anonymous caller and clamps its limit", async () => {
  const anonymous = new Request("https://axle-gateway.axle-download-worker.workers.dev/v1/usage");
  assert.equal((await handleRequest(anonymous, environment())).status, 401);

  const store = new MemoryCreditsStore();
  const env = environment(store);
  const userId = await resolveUserId(request("/usage"));
  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  await ledger.ensureDailyGrant(userId);
  for (let index = 0; index < 5; index += 1) await ledger.charge(userId, 1);

  const limited = await handleRequest(request("/usage?limit=2", { method: "GET" }), env);
  assert.equal((await limited.json()).entries.length, 2);

  const absurd = await handleRequest(request("/usage?limit=9999", { method: "GET" }), env);
  assert.equal(absurd.status, 200);
  assert.ok((await absurd.json()).entries.length <= 100);
});

test("an unknown model is refused before any upstream call", async () => {
  const response = await handleRequest(
    request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    }),
    environment(),
  );
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /Unknown model/u);
});

test("the internal credit route applies purchases and plan grants idempotently", async () => {
  const store = new MemoryCreditsStore();
  const env = environment(store, { INTERNAL_API_TOKEN: "internal-secret" });
  const internal = (body, token = "internal-secret") =>
    handleRequest(
      request("/internal/credits", { method: "POST", body: JSON.stringify(body) }, token),
      env,
    );

  const unauthorized = await internal({ user_id: "user-1", amount: 100, bucket: "paid", reference: "evt_1" }, "wrong");
  assert.equal(unauthorized.status, 401);
  const unconfigured = await handleRequest(
    request("/internal/credits", {
      method: "POST",
      body: JSON.stringify({ user_id: "user-1", amount: 100, bucket: "paid", reference: "evt_1" }),
    }, "internal-secret"),
    environment(store),
  );
  assert.equal(unconfigured.status, 401);

  const invalid = await internal({ user_id: "user-1", amount: 100, bucket: "store", reference: "evt_1" });
  assert.equal(invalid.status, 400);
  const missing = await internal({ user_id: "user-1", amount: 100, bucket: "paid" });
  assert.equal(missing.status, 400);

  const purchase = await internal({ user_id: "user-1", amount: 1_000, bucket: "paid", reference: "evt_topup_1" });
  assert.equal(purchase.status, 200);
  assert.equal((await purchase.json()).applied, true);
  const purchaseRetry = await internal({ user_id: "user-1", amount: 1_000, bucket: "paid", reference: "evt_topup_1" });
  assert.equal((await purchaseRetry.json()).applied, false);

  const plan = await internal({ user_id: "user-1", amount: 2_000, bucket: "plan", reference: "evt_plan_1" });
  assert.equal((await plan.json()).applied, true);
  const planRetry = await internal({ user_id: "user-1", amount: 2_000, bucket: "plan", reference: "evt_plan_1" });
  assert.equal((await planRetry.json()).applied, false);

  const ledger = new CreditsLedger(store, { now: () => FIXED_NOW });
  assert.deepEqual(await ledger.buckets("user-1"), { free: 0, plan: 2_000, paid: 1_000 });
});

test("usageScanner ignores non-usage lines and tolerates split chunks", () => {
  const seen = [];
  const scanner = usageScanner((usage) => seen.push(usage));
  const writer = scanner.writable.getWriter();
  const parts = ['data: {"choices":[{"d', 'elta":{"content":"x"}}]}\n\n', 'data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n'];
  for (const part of parts) writer.write(new TextEncoder().encode(part));
  writer.close();
  return scanner.readable
    .pipeTo(new WritableStream({ write() {} }))
    .then(() => {
      assert.deepEqual(seen, [{ prompt_tokens: 1, completion_tokens: 2 }]);
    });
});
