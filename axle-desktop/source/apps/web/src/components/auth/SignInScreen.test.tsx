import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { FALLBACK_SIGN_IN_PROVIDERS } from "../../account/accountGate.logic";
import { SignInScreen } from "./SignInScreen";

function renderScreen(overrides: Partial<Parameters<typeof SignInScreen>[0]> = {}): string {
  return renderToStaticMarkup(
    <SignInScreen
      error={null}
      onSignIn={() => undefined}
      pendingProviderId={null}
      providers={FALLBACK_SIGN_IN_PROVIDERS}
      {...overrides}
    />,
  );
}

describe("SignInScreen", () => {
  it("offers a button per provider, primary first", () => {
    const html = renderScreen();

    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Continue with Google");
    expect(html.indexOf("Continue with GitHub")).toBeLessThan(html.indexOf("Continue with Google"));
  });

  it("says why the app is gated", () => {
    expect(renderScreen()).toContain("Axle needs an account before it can open a workspace");
  });

  it("reports a sign-in that did not finish without hiding the retry buttons", () => {
    const html = renderScreen({ error: "Sign-in was not completed in the browser." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Sign-in was not completed in the browser.");
    expect(html).toContain("Continue with GitHub");
  });

  it("keeps the alert out of the markup when nothing failed", () => {
    expect(renderScreen()).not.toContain('role="alert"');
  });

  it("names the provider it is waiting for and keeps the other one reachable", () => {
    const html = renderScreen({ pendingProviderId: "github" });

    expect(html).toContain("Waiting for GitHub");
    expect(html).toContain("Open it again");
    // `disabled:` utility classes are always in the markup; the attribute is not.
    expect(html).not.toContain('disabled=""');
  });

  it("announces nothing while no hand-off is open", () => {
    expect(renderScreen()).not.toContain("Waiting for");
  });
});
