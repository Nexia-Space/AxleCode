import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";

import type { SignInProvider } from "../../account/clerkRuntime";
import { APP_STAGE_LABEL } from "../../branding";
import { isElectron } from "../../env";
import { cn } from "~/lib/utils";
import { AxleLogo } from "../AxleLogo";
import { GitHubIcon, GoogleIcon, type Icon } from "../Icons";
import { Button } from "../ui/button";

const PROVIDER_ICONS: Record<string, Icon> = {
  github: GitHubIcon,
  google: GoogleIcon,
};

function ProviderIcon({ providerId }: { readonly providerId: string }) {
  const Glyph = PROVIDER_ICONS[providerId];
  // The explicit size opts out of `buttonVariants`' default icon sizing, which
  // would shrink these marks to 16px next to the taller sign-in buttons.
  return Glyph ? <Glyph aria-hidden="true" className="size-4.5" focusable="false" /> : null;
}

/**
 * Soft monochrome backdrop. The app theme has no brand hue — `--primary` is the
 * foreground — so depth comes from a dot grid and a single foreground-tinted
 * glow, both of which invert correctly with the light and dark tokens.
 */
function SignInBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(currentColor_1px,transparent_1px)] [background-size:22px_22px] text-foreground opacity-[0.045]" />
      <div className="absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-foreground/[0.05] blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-background to-transparent" />
    </div>
  );
}

export function SignInScreen({
  error,
  onSignIn,
  pendingProviderId,
  providers,
}: {
  /** Message from a sign-in that started but did not finish. */
  readonly error: string | null;
  readonly onSignIn: (providerId: string) => void;
  /** Provider whose browser hand-off is still open, if any. */
  readonly pendingProviderId: string | null;
  readonly providers: ReadonlyArray<SignInProvider>;
}) {
  const pendingProvider = providers.find((provider) => provider.id === pendingProviderId) ?? null;

  return (
    <div className="relative flex h-dvh max-h-dvh flex-col overflow-y-auto bg-background text-foreground">
      <SignInBackdrop />
      {/* The gate replaces the whole app, titlebar included. Without a drag
          strip of its own a frameless window could not be moved while signed
          out. */}
      {isElectron ? (
        <div
          aria-hidden="true"
          className="drag-region h-[var(--workspace-topbar-height)] shrink-0"
        />
      ) : null}

      <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[25rem]">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-[var(--floating-shadow)]">
              <AxleLogo aria-label="Axle" className="size-8" role="img" />
            </div>
            <h1 className="mt-6 font-heading text-2xl font-semibold tracking-tight">
              Sign in to Axle
            </h1>
            <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">
              Axle needs an account before it can open a workspace. Pick a provider and finish up in
              your browser.
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-[var(--floating-shadow)] sm:p-6">
            {error ? (
              <div
                className="mb-4 flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/8 p-3 text-left"
                role="alert"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-destructive-foreground">
                    Sign-in didn&apos;t finish
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    {error}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2.5">
              {providers.map((provider, index) => (
                // Left enabled while a hand-off is open: a browser tab the user
                // closed or a blocked popup must not strand them until the
                // five-minute poll gives up.
                <Button
                  className="h-11! w-full justify-center gap-2.5 text-sm"
                  key={provider.id}
                  onClick={() => onSignIn(provider.id)}
                  size="lg"
                  variant={index === 0 ? "default" : "outline"}
                >
                  {pendingProviderId === provider.id ? (
                    <LoaderCircleIcon className="size-4.5 animate-spin" />
                  ) : (
                    <ProviderIcon providerId={provider.id} />
                  )}
                  Continue with {provider.label}
                </Button>
              ))}
            </div>

            <div
              aria-live="polite"
              className={cn(
                "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                pendingProvider ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0">
                {pendingProvider ? (
                  <p className="text-center text-xs leading-5 text-muted-foreground">
                    Waiting for {pendingProvider.label}…{" "}
                    <button
                      className="cursor-pointer rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSignIn(pendingProvider.id)}
                      type="button"
                    >
                      Open it again
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            Axle never sees your password.
          </p>
          <p className="mt-1 text-center text-[11px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            {APP_STAGE_LABEL}
          </p>
        </div>
      </main>
    </div>
  );
}
