"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { DashboardPayload } from "./data-types";

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardPayload };

interface MetricsContextValue {
  data: DashboardPayload;
  refresh: () => void;
}

const MetricsContext = createContext<MetricsContextValue | null>(null);

export function useMetrics(): MetricsContextValue {
  const value = useContext(MetricsContext);
  if (value === null) {
    throw new Error("useMetrics must be used inside <Shell>.");
  }
  return value;
}

const NAV = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/providers", label: "Providers", icon: "providers" },
] as const;

async function loadDashboard(): Promise<State> {
  let response: Response;
  try {
    response = await fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" });
  } catch {
    return { status: "error", message: "Could not reach the dashboard API." };
  }

  if (response.status === 401) return { status: "signed-out" };

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const message =
    body !== null && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `Request failed (${response.status}).`;

  if (response.status === 503) return { status: "unconfigured", message };
  if (!response.ok) return { status: "error", message };

  return { status: "ready", data: body as DashboardPayload };
}

export function Shell({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const pathname = usePathname();

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    void loadDashboard().then(setState);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadDashboard().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the dashboard live without a manual reload. Failures are ignored so a
  // transient blip never wipes good data off the screen.
  useEffect(() => {
    if (state.status !== "ready") return;
    const timer = setInterval(() => {
      void loadDashboard().then((next) => {
        if (next.status === "ready") setState(next);
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, [state.status]);

  const handleSignOut = useCallback(() => {
    void fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).then(() => setState({ status: "signed-out" }));
  }, []);

  if (state.status !== "ready") {
    return (
      <div className="content">
        {state.status === "loading" ? (
          <div className="loading-state">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/axle-logo.png" alt="Axle" />
            <span className="loading-spinner" aria-hidden="true" />
            <span className="muted">Loading analytics…</span>
          </div>
        ) : null}
        {state.status === "signed-out" ? <LoginCard onSignedIn={refresh} /> : null}
        {state.status === "unconfigured" ? (
          <div className="card center-card">
            <h2>Dashboard not configured</h2>
            <p className="muted small">{state.message}</p>
            <pre>{`ANALYTICS_ADMIN_USERNAME=axleadmin
ANALYTICS_ADMIN_PASSCODE=<your passcode>
MONGODB_URI=mongodb://…/axle`}</pre>
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="card error center-card">
            <h2>Unable to load metrics</h2>
            <p className="muted small">{state.message}</p>
            <button type="button" className="ghost" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <MetricsContext.Provider value={{ data: state.data, refresh }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/axle-logo.png" alt="Axle" />
            <div className="brand-text">
              <strong>Axle</strong>
              <span>Analytics</span>
            </div>
          </div>

          <div className="nav-group-label">Dashboard</div>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${pathname === item.href ? " active" : ""}`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          ))}

          <div className="sidebar-footer">
            <button type="button" className="ghost" onClick={refresh}>
              Refresh
            </button>
            <button type="button" className="ghost" onClick={handleSignOut}>Sign out</button>
          </div>
        </aside>

        <div className="content">{children}</div>
      </div>
    </MetricsContext.Provider>
  );
}

function LoginCard({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, passcode }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(body !== null && typeof body === "object" && "error" in body ? String(body.error) : "Sign in failed.");
        return;
      }
      setUsername("");
      setPasscode("");
      onSignedIn();
    } catch {
      setError("Could not reach the dashboard API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="auth-logo" src="/axle-logo.png" alt="Axle" />
      <div className="auth-copy">
        <h1>Axle Analytics</h1>
        <p className="muted">Private operations dashboard</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" required />
        <input value={passcode} onChange={(event) => setPasscode(event.target.value)} placeholder="Passcode" type="password" autoComplete="current-password" required />
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      {error !== null ? <p className="warn small">{error}</p> : null}
      <p className="auth-note">Private Axle administrator access</p>
    </div>
  );
}

function NavIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
        <path d="M16 11a3 3 0 1 0 0-6" />
        <path d="M18 20c0-2.4-1-4.2-2.6-5.1" />
      </svg>
    );
  }
  if (name === "providers") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="13" width="7" height="7" rx="1.5" />
        <path d="M10 7.5h4a3 3 0 0 1 3 3v2.5" />
      </svg>
    );
  }
  if (name === "revenue") {
    return (
      <svg {...common}>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M21 19H3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
