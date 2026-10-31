"use client";

import { currencyFmt, formatDate, numberFmt } from "../format";
import { useMetrics } from "../shell";
import { EMPTY_BACHS } from "../data-types";

export default function RevenuePage() {
  const { data } = useMetrics();
  const { revenue, users } = data.account;
  const bachs = data.bachs ?? EMPTY_BACHS;

  const usd = bachs.byCurrency.find((row) => row.currency === "USD");
  const otherCollected = bachs.byCurrency
    .filter((row) => row.currency !== "USD" && row.collected > 0)
    .map((row) => currencyFmt(row.collected, row.currency))
    .join(" · ");
  const collectedLabel = usd
    ? currencyFmt(usd.collected, "USD")
    : bachs.byCurrency[0]
      ? currencyFmt(bachs.byCurrency[0].collected, bachs.byCurrency[0].currency)
      : currencyFmt(0, "USD");
  const feesLabel =
    bachs.byCurrency
      .filter((row) => row.fees > 0)
      .map((row) => currencyFmt(row.fees, row.currency))
      .join(" · ") || "—";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Revenue</h1>
          <p className="page-sub">Completed Bachs checkouts plus billing records from account-api</p>
        </div>
      </div>

      <section className="section card">
        <div className="card-head">
          <h2>Bachs</h2>
          <span className="muted small">{bachs.configured ? "live API" : "not configured"}</span>
        </div>
        {!bachs.configured ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            Set <code>AXLE_BACHS_API_KEY</code> to load live payments.
          </p>
        ) : bachs.error ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            Could not load payments: {bachs.error}
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 6 }}>
            {numberFmt.format(bachs.totalPayments)} completed checkouts fetched{" "}
            {formatDate(bachs.fetchedAt)}.
            {bachs.excludedPayments > 0
              ? ` ${numberFmt.format(bachs.excludedPayments)} incomplete or failed checkouts excluded.`
              : ""}{" "}
            Amounts are checkout totals; collected uses Bachs <code>amount_paid</code>.
          </p>
        )}
      </section>

      <section className="section kpis">
        <div className="card kpi">
          <span className="kpi-label">Collected</span>
          <span className="kpi-value">{collectedLabel}</span>
          <span className="muted small">{otherCollected || "Bachs completed"}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Completed checkouts</span>
          <span className="kpi-value">{numberFmt.format(bachs.totalPayments)}</span>
          <span className="muted small">Bachs /v1/payments</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Excluded</span>
          <span className="kpi-value">{numberFmt.format(bachs.excludedPayments)}</span>
          <span className="muted small">not completed</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Fees</span>
          <span className="kpi-value">{feesLabel}</span>
          <span className="muted small">completed checkouts</span>
        </div>
      </section>

      <section className="section grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Bachs totals</h2>
            <span className="muted small">completed, by currency</span>
          </div>
          {bachs.byCurrency.length === 0 ? (
            <p className="muted small">No completed payments.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="num">Amount</th>
                  <th className="num">Collected</th>
                  <th className="num">Fees</th>
                </tr>
              </thead>
              <tbody>
                {bachs.byCurrency.map((row) => (
                  <tr key={row.currency}>
                    <td>{row.currency}</td>
                    <td className="num">{currencyFmt(row.amount, row.currency)}</td>
                    <td className="num">{currencyFmt(row.collected, row.currency)}</td>
                    <td className="num">{currencyFmt(row.fees, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Checkout status</h2>
            <span className="muted small">completed only</span>
          </div>
          {bachs.byStatus.length === 0 ? (
            <p className="muted small">No completed payments.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="num">Payments</th>
                </tr>
              </thead>
              <tbody>
                {bachs.byStatus.map((row) => (
                  <tr key={row.status}>
                    <td>{row.status}</td>
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
          <h2>Recent completed checkouts</h2>
          <span className="muted small">newest first</span>
        </div>
        {bachs.recent.length === 0 ? (
          <p className="muted small">No completed checkouts yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Plan / purpose</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bachs.recent.map((payment) => (
                <tr key={payment.id}>
                  <td className="muted small">{formatDate(payment.transactionDate)}</td>
                  <td>{payment.customerName ?? "—"}</td>
                  <td className="muted small">{payment.planId ?? payment.purpose ?? "—"}</td>
                  <td className="num">{currencyFmt(payment.amount, payment.currency)}</td>
                  <td className="muted small">{payment.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section card">
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
      </section>

      <section className="section card">
        <div className="card-head">
          <h2>Billing records</h2>
          <span className="muted small">account-api collections</span>
        </div>
        <table>
          <tbody>
            <tr>
              <td>Active subscriptions</td>
              <td className="num">{numberFmt.format(revenue.activeSubscriptions)}</td>
            </tr>
            <tr>
              <td>Current plan</td>
              <td className="num">{revenue.subscriptionPlan ?? "—"}</td>
            </tr>
            <tr>
              <td>Billing events</td>
              <td className="num">{numberFmt.format(revenue.billingEvents)}</td>
            </tr>
            <tr>
              <td>Ledger entries</td>
              <td className="num">{numberFmt.format(revenue.ledgerEntries)}</td>
            </tr>
            <tr>
              <td>Bachs fees</td>
              <td className="num">{feesLabel}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
