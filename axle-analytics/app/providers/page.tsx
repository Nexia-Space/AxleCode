"use client";

import { BarChart } from "@/components/BarChart";

import { compactFmt, numberFmt, relativeTime, shortId } from "../format";
import { useMetrics } from "../shell";

export default function ProvidersPage() {
  const { data } = useMetrics();
  const providers = data.providers;
  const providerUsers = new Map(data.providerUsers.map((entry) => [entry.provider, entry.users]));
  const mostRequests = [...providers].sort((a, b) => b.requests - a.requests)[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Providers</h1>
          <p className="page-sub">
            {numberFmt.format(providers.length)}{" "}
            {providers.length === 1 ? "provider" : "providers"} · most requests:{" "}
            {mostRequests
              ? `${mostRequests.name} (${numberFmt.format(mostRequests.requests)})`
              : "—"}
          </p>
        </div>
      </div>

      <section className="section card">
        <div className="card-head">
          <h2>Requests by provider</h2>
          <span className="muted small">real upstream, from model prefixes</span>
        </div>
        <BarChart
          data={providers.map((row) => ({ label: row.name, value: row.requests }))}
          tone="a"
          valueLabel="requests"
        />
      </section>

      <section className="section card">
        <div className="card-head">
          <h2>Provider endpoints</h2>
          <span className="muted small">name and base URL</span>
        </div>
        {providers.length === 0 ? (
          <p className="muted small">No provider usage recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Base URL</th>
                <th className="num">Requests</th>
                <th className="num">Today</th>
                <th className="num">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((row) => (
                <tr key={row.provider}>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <span>{row.name}</span>
                      {row.provider === mostRequests?.provider ? (
                        <span className="pill pro">Most requests</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="muted small url">
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noreferrer">
                        {row.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{numberFmt.format(row.requests)}</td>
                  <td className="num">{numberFmt.format(row.requestsToday)}</td>
                  <td className="num">{compactFmt.format(row.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {providers.length === 0 ? (
        <section className="section card">
          <p className="muted small">No provider usage recorded yet.</p>
        </section>
      ) : (
        <section className="section stack">
          {providers.map((provider) => {
            const users = providerUsers.get(provider.provider) ?? [];
            return (
              <div className="card" key={provider.provider}>
                <div className="card-head" style={{ alignItems: "flex-start" }}>
                  <div>
                    <h2>{provider.name}</h2>
                    <span className="muted small url">
                      {provider.url ? (
                        <a href={provider.url} target="_blank" rel="noreferrer">
                          {provider.url}
                        </a>
                      ) : (
                        provider.provider
                      )}
                    </span>
                  </div>
                  <span className="muted small">
                    {numberFmt.format(provider.users)} users ·{" "}
                    {numberFmt.format(provider.models)} models ·{" "}
                    {compactFmt.format(provider.totalTokens)} tokens
                  </span>
                </div>
                {users.length === 0 ? (
                  <p className="muted small">No per-user rows.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th className="num">Requests</th>
                        <th className="num">Tokens</th>
                        <th>Last active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.userId}>
                          <td>
                            <div className="stack" style={{ gap: 0 }}>
                              <span>{user.displayName ?? "Unnamed"}</span>
                              <span className="muted small">{shortId(user.userId)}</span>
                            </div>
                          </td>
                          <td className="num">{numberFmt.format(user.requests)}</td>
                          <td className="num">{compactFmt.format(user.tokens)}</td>
                          <td className="muted small">{relativeTime(user.lastActiveAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
