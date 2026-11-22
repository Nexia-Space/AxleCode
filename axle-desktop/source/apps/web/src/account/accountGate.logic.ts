import type { SignInProvider } from "./clerkRuntime";

/** Shown before the worker answers, so the buttons never pop in late. */
export const FALLBACK_SIGN_IN_PROVIDERS: ReadonlyArray<SignInProvider> = [
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
];

/**
 * Button order on the sign-in screen. The first provider is rendered as the
 * primary action, so it has to be stable rather than whatever order the worker
 * happens to report.
 */
const PROVIDER_DISPLAY_ORDER: ReadonlyArray<string> = ["github", "google"];

export type AccountGateView = "app" | "loading" | "sign-in";

/**
 * What the gate should render. Anything short of a signed-in account stops the
 * app from mounting, except the hosted static app, which pairs with a server
 * through its own flow and has no desktop sign-in to complete.
 */
export function resolveAccountGateView(input: {
  readonly hostedStatic: boolean;
  readonly status: "loading" | "signed-out" | "signed-in" | "error";
}): AccountGateView {
  if (input.hostedStatic || input.status === "signed-in") {
    return "app";
  }
  return input.status === "loading" ? "loading" : "sign-in";
}

/**
 * Providers to offer, newest worker answer first. An empty or failed provider
 * fetch keeps the fallback list so the screen is never a dead end: starting a
 * provider the deployment has not configured surfaces the worker's own error
 * instead of hiding the button.
 */
export function resolveSignInProviders(
  configured: ReadonlyArray<SignInProvider>,
): ReadonlyArray<SignInProvider> {
  const offered = configured.length > 0 ? configured : FALLBACK_SIGN_IN_PROVIDERS;
  const rank = (provider: SignInProvider) => {
    const index = PROVIDER_DISPLAY_ORDER.indexOf(provider.id);
    return index === -1 ? PROVIDER_DISPLAY_ORDER.length : index;
  };
  return [...offered].sort((left, right) => rank(left) - rank(right));
}
