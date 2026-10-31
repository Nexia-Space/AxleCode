"use client";

import { BarChart } from "@/components/BarChart";
import { providerInfo } from "@/lib/providers";

import { compactFmt, currencyFmt, numberFmt } from "./format";
import { useMetrics } from "./shell";
import { EMPTY_BACHS } from "./data-types";

export default function OverviewPage() {
  const { data } = useMetrics();
  const { account, providers, downloads, github } = data;
  const bachs = data.bachs ?? EMPTY_BACHS;
  const { users, requests, revenue } = account;
  const usdCollected = bachs.byCurrency.find((row) => row.currency === "USD");
  const collected = usdCollected
    ? currencyFmt(usdCollected.collected, "USD")
    : bachs.byCurrency[0]
      ? currencyFmt(bachs.byCurrency[0].collected, bachs.byCurrency[0].currency)
      : currencyFmt(0, "USD");
  // Bucketed by UTC day server-side; never trust the browser clock here.
  const today = data.today ?? new Date().toISOString().slice(0, 10);
  const todayRow = requests.perDay.find((day) => day.date === today);
  const topProviders = [...providers].sort((a, b) => b.totalTokens - a.totalTokens);

  const kpis = [
    { label: "Users", value: numberFmt.format(users.total), hint: "accounts" },
    { label: "Pro users", value: numberFmt.format(users.pro), hint: "paid plan" },
    {
      label: "Requests today",
      value: numberFmt.format(todayRow?.turns ?? 0),
      hint: todayRow
        ? `${numberFmt.format(requests.total)} all-time`
        : `No usage today · ${numberFmt.format(requests.total)} all-time`,
    },
    {
      label: "Tokens today",
      value: compactFmt.format(todayRow?.tokens ?? 0),
      hint: todayRow
        ? `${compactFmt.format(requests.totalTokens)} all-time`
        : `No usage today · ${compactFmt.format(requests.totalTokens)} all-time`,
    },
    {
      label: "Active subscriptions",
      value: numberFmt.format(revenue.activeSubscriptions),
      hint: revenue.subscriptionPlan ?? "none",
    },
    { label: "Collected", value: collected, hint: "Bachs, completed" },
    { label: "Providers", value: numberFmt.format(providers.length), hint: "in use" },
    {
      label: "Downloads",
      value: numberFmt.format(github?.total ?? downloads.requests),
      hint:
        github?.reachable === true
          ? `GitHub releases · latest ${github.latestTag ?? "—"}`
          : `${numberFmt.format(downloads.clicks)} clicks · ${numberFmt.format(downloads.errors)} errors`,
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="page-sub">
            {requests.from && requests.to
              ? `${requests.from} → ${requests.to} · ${requests.perDay.length} active days`
              : "No usage recorded yet"}
          </p>
        </div>
      </div>

      <section className="section kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card kpi">
            <span className="kpi-label">{kpi.label}</span>
            <span className="kpi-value">{kpi.value}</span>
            <span className="muted small">{kpi.hint}</span>
          </div>
        ))}
      </section>

      <section className="section card">
        <div className="card-head">
          <h2>Requests per day</h2>
          <span className="muted small">axle_account_usage_daily</span>
        </div>
        <BarChart
          data={requests.perDay.map((day) => ({ label: day.date, value: day.turns }))}
          tone="a"
          valueLabel="requests"
        />
      </section>

      <section className="section grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Top providers</h2>
            <span className="muted small">by tokens</span>
          </div>
          {providers.length === 0 ? (
            <p className="muted small">No provider usage recorded.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="num">Users</th>
                  <th className="num">Requests</th>
                  <th className="num">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {topProviders.slice(0, 6).map((row) => (
                  <tr key={row.provider}>
                    <td>{providerInfo(row.provider).name}</td>
                    <td className="num">{numberFmt.format(row.users)}</td>
                    <td className="num">{numberFmt.format(row.requests)}</td>
                    <td className="num">{compactFmt.format(row.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Plan distribution</h2>
            <span className="muted small">axle_credit_accounts</span>
          </div>
          {users.byPlan.length === 0 ? (
            <p className="muted small">No plan records.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="num">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {users.byPlan.map((row) => (
                  <tr key={row.plan}>
                    <td>{row.plan}</td>
                    <td className="num">{numberFmt.format(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="section card">
        <div className="card-head">
          <h2>Downloads by platform</h2>
          <span className="muted small">GitHub release assets</span>
        </div>
        {!github?.reachable ? (
          <p className="muted small">
            {github?.error ?? "GitHub download counts unavailable."}
          </p>
        ) : github.byPlatform.length === 0 ? (
          <p className="muted small">No installer assets have been downloaded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th className="num">Downloads</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {github.byPlatform.map((row) => (
                <tr key={row.platform}>
                  <td>{row.platform}</td>
                  <td className="num">{numberFmt.format(row.downloads)}</td>
                  <td className="muted small">
                    {github.total > 0 ? Math.round((row.downloads / github.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}