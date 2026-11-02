"use client";

import { BarChart } from "@/components/BarChart";
import { providerInfo } from "@/lib/providers";

import { compactFmt, formatDate, numberFmt, planClass, relativeTime, shortId } from "../format";
import { useMetrics } from "../shell";

export default function UsersPage() {
  const { data } = useMetrics();
  const users = [...data.users].sort((a, b) => b.requests - a.requests);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="page-sub">
            {numberFmt.format(users.length)} accounts known to the database ·{" "}
            {numberFmt.format(data.account.users.pro)} on a paid plan
          </p>
        </div>
      </div>

      {!data.names.configured ? (
        <section className="section card">
          <h2>Roster is partial</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            {data.names.error} This list is the union of every account the database has
            seen (profiles, credit accounts, sessions, usage). Accounts that signed up but
            never reached account-api will not appear until <code>CLERK_SECRET_KEY</code>{" "}
            is set.
          </p>
        </section>
      ) : null}

      <section className="section card">
        <div className="card-head">
          <h2>Requests by user</h2>
          <span className="muted small">top {Math.min(users.length, 12)}</span>
        </div>
        <BarChart
          data={users.slice(0, 12).map((user) => ({
            label: user.displayName ?? shortId(user.userId),
            value: user.requests,
          }))}
          tone="b"
          valueLabel="requests"
        />
      </section>

      <section className="section card">
        <div className="card-head">
          <h2>All users</h2>
          <span className="muted small">axle_account_usage_events ⋈ profiles</span>
        </div>
        {users.length === 0 ? (
          <p className="muted small">No users have recorded usage yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th className="num">Requests</th>
                <th className="num">Tokens</th>
                <th>Top model</th>
                <th>Providers</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>
                    <div className="stack" style={{ gap: 0 }}>
                      <span>{user.displayName ?? "Account identity unavailable"}</span>
                      <span className="muted small">{shortId(user.userId)}</span>
                    </div>
                  </td>
                  <td>
                    <span className={planClass(user.plan)}>{user.plan ?? "—"}</span>
                  </td>
                  <td className="num">{numberFmt.format(user.requests)}</td>
                  <td className="num">{compactFmt.format(user.totalTokens)}</td>
                  <td className="muted small">{user.topModel ?? "—"}</td>
                  <td className="muted small">
                    {user.providers.length > 0
                      ? user.providers.map((id) => providerInfo(id).name).join(", ")
                      : "—"}
                  </td>
                  <td className="muted small" title={formatDate(user.lastActiveAt)}>
                    {relativeTime(user.lastActiveAt)}
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
