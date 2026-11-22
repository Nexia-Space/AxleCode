import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AuthLoadingScreen } from "../components/auth/AuthSurfaceShell";
import { SignInScreen } from "../components/auth/SignInScreen";
import { isHostedStaticApp } from "../hostedPairing";
import { useAccountActions, useAccountState } from "./AccountAuthProvider";
import { resolveAccountGateView, resolveSignInProviders } from "./accountGate.logic";
import { fetchSignInProviders, type SignInProvider } from "./clerkRuntime";

/**
 * Holds the app back until an Axle account is signed in. The router never
 * mounts while signed out, so no workspace, thread, or settings surface can be
 * reached before sign-in.
 *
 * The hosted static app is the one exception: it reaches a server through its
 * own pairing flow and has no desktop sign-in to complete.
 */
export function AccountGate({ children }: { readonly children: ReactNode }) {
  const account = useAccountState();
  const { signIn } = useAccountActions();
  const [hostedStatic] = useState(() => isHostedStaticApp());
  const [configuredProviders, setConfiguredProviders] = useState<ReadonlyArray<SignInProvider>>([]);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const view = resolveAccountGateView({ hostedStatic, status: account.status });

  useEffect(() => {
    if (view !== "sign-in") return;
    let active = true;
    void fetchSignInProviders().then((providers) => {
      if (active) setConfiguredProviders(providers);
    });
    return () => {
      active = false;
    };
  }, [view]);

  // A finished or failed hand-off is no longer pending, whichever way it went.
  useEffect(() => {
    if (account.status === "signed-in" || account.status === "error") {
      setPendingProviderId(null);
    }
  }, [account.status]);

  const startSignIn = useCallback(
    (providerId: string) => {
      setPendingProviderId(providerId);
      signIn(providerId);
    },
    [signIn],
  );

  if (view === "app") {
    return children;
  }

  if (view === "loading") {
    return <AuthLoadingScreen />;
  }

  return (
    <SignInScreen
      error={account.status === "error" ? account.error : null}
      onSignIn={startSignIn}
      pendingProviderId={pendingProviderId}
      providers={resolveSignInProviders(configuredProviders)}
    />
  );
}
