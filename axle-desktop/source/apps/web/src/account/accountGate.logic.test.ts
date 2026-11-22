import { describe, expect, it } from "vite-plus/test";

import {
  FALLBACK_SIGN_IN_PROVIDERS,
  resolveAccountGateView,
  resolveSignInProviders,
} from "./accountGate.logic";

describe("resolveAccountGateView", () => {
  it("holds the app back for every state short of a signed-in account", () => {
    expect(resolveAccountGateView({ hostedStatic: false, status: "signed-out" })).toBe("sign-in");
    expect(resolveAccountGateView({ hostedStatic: false, status: "error" })).toBe("sign-in");
  });

  it("waits for the restored session instead of flashing the sign-in screen", () => {
    expect(resolveAccountGateView({ hostedStatic: false, status: "loading" })).toBe("loading");
  });

  it("opens the app once an account is signed in", () => {
    expect(resolveAccountGateView({ hostedStatic: false, status: "signed-in" })).toBe("app");
  });

  it("leaves the hosted static app to its own pairing flow", () => {
    for (const status of ["loading", "signed-out", "signed-in", "error"] as const) {
      expect(resolveAccountGateView({ hostedStatic: true, status })).toBe("app");
    }
  });
});

describe("resolveSignInProviders", () => {
  it("offers both providers before the worker answers", () => {
    expect(resolveSignInProviders([])).toEqual([
      { id: "github", label: "GitHub" },
      { id: "google", label: "Google" },
    ]);
    expect(FALLBACK_SIGN_IN_PROVIDERS.map((provider) => provider.id)).toEqual(["github", "google"]);
  });

  it("keeps the button order stable however the worker reports them", () => {
    expect(
      resolveSignInProviders([
        { id: "google", label: "Google" },
        { id: "github", label: "GitHub" },
      ]).map((provider) => provider.id),
    ).toEqual(["github", "google"]);
  });

  it("shows only what the deployment configured", () => {
    expect(resolveSignInProviders([{ id: "google", label: "Google" }])).toEqual([
      { id: "google", label: "Google" },
    ]);
  });

  it("puts providers it has no opinion about after the known ones", () => {
    expect(
      resolveSignInProviders([
        { id: "gitlab", label: "GitLab" },
        { id: "google", label: "Google" },
      ]).map((provider) => provider.id),
    ).toEqual(["google", "gitlab"]);
  });
});
