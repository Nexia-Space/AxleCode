import { describe, expect, it } from "vitest";

import {
  isMissingMacNotarizationCredentials,
  resolveMacNotarizationCredentials,
} from "./mac-notarization.ts";

describe("resolveMacNotarizationCredentials", () => {
  it("accepts a complete App Store Connect API key", () => {
    expect(
      resolveMacNotarizationCredentials({
        APPLE_API_KEY: "/tmp/AuthKey.p8",
        APPLE_API_KEY_ID: "KEYID12345",
        APPLE_API_ISSUER: "00000000-0000-0000-0000-000000000000",
      }),
    ).toEqual({ method: "api-key" });
  });

  it("accepts a complete Apple ID credential set", () => {
    expect(
      resolveMacNotarizationCredentials({
        APPLE_ID: "release@axle.test",
        APPLE_APP_SPECIFIC_PASSWORD: "app-specific-password",
        APPLE_TEAM_ID: "TEAM123456",
      }),
    ).toEqual({ method: "apple-id" });
  });

  it("accepts a notarytool keychain profile", () => {
    expect(
      resolveMacNotarizationCredentials({ APPLE_KEYCHAIN_PROFILE: "axle-notary" }),
    ).toEqual({ method: "keychain-profile" });
  });

  it("reports the missing API key variables instead of silently skipping", () => {
    const resolution = resolveMacNotarizationCredentials({
      APPLE_API_KEY: "/tmp/AuthKey.p8",
    });

    expect(isMissingMacNotarizationCredentials(resolution)).toBe(true);
    if (isMissingMacNotarizationCredentials(resolution)) {
      expect(resolution.missing).toEqual(["APPLE_API_KEY_ID", "APPLE_API_ISSUER"]);
    }
  });

  it("reports the full API key set when no credentials are configured", () => {
    const resolution = resolveMacNotarizationCredentials({});

    expect(isMissingMacNotarizationCredentials(resolution)).toBe(true);
    if (isMissingMacNotarizationCredentials(resolution)) {
      expect(resolution.missing).toEqual([
        "APPLE_API_KEY",
        "APPLE_API_KEY_ID",
        "APPLE_API_ISSUER",
      ]);
    }
  });
});
