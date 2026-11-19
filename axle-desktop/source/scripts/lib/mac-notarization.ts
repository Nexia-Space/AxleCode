/**
 * Credential detection for macOS notarization.
 *
 * electron-builder hands notarization to `@electron/notarize`, which accepts
 * three credential shapes. Keep this list in sync with
 * `MacTargetHelper.getNotarizeOptions` in app-builder-lib: if none of them is
 * present, electron-builder only logs a warning and publishes an un-notarized
 * app, which Gatekeeper then blocks.
 */

export type MacNotarizationMethod = "api-key" | "apple-id" | "keychain-profile";

export interface MacNotarizationResolution {
  readonly method: MacNotarizationMethod;
}

export interface MissingMacNotarizationCredentials {
  readonly missing: ReadonlyArray<string>;
}

const API_KEY_VARIABLES = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;
const APPLE_ID_VARIABLES = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
] as const;

function present(env: NodeJS.ProcessEnv, key: string): boolean {
  return (env[key] ?? "").trim().length > 0;
}

export function resolveMacNotarizationCredentials(
  env: NodeJS.ProcessEnv,
): MacNotarizationResolution | MissingMacNotarizationCredentials {
  if (present(env, "APPLE_KEYCHAIN_PROFILE")) {
    return { method: "keychain-profile" };
  }

  if (API_KEY_VARIABLES.some((key) => present(env, key))) {
    const missing = API_KEY_VARIABLES.filter((key) => !present(env, key));
    if (missing.length === 0) {
      return { method: "api-key" };
    }
    // A partial key configuration is still an API-key attempt. Report the
    // missing variables instead of silently trying the Apple ID flow.
    return { missing };
  }

  if (APPLE_ID_VARIABLES.some((key) => present(env, key))) {
    const missing = APPLE_ID_VARIABLES.filter((key) => !present(env, key));
    if (missing.length === 0) {
      return { method: "apple-id" };
    }
    return { missing };
  }

  return { missing: [...API_KEY_VARIABLES] };
}

export function isMissingMacNotarizationCredentials(
  resolution: MacNotarizationResolution | MissingMacNotarizationCredentials,
): resolution is MissingMacNotarizationCredentials {
  return "missing" in resolution;
}

export function describeMacNotarizationRequirements(): string {
  return [
    "macOS notarization needs one of these credential sets:",
    "  APPLE_API_KEY (path to AuthKey_*.p8), APPLE_API_KEY_ID, APPLE_API_ISSUER;",
    "  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID;",
    "  APPLE_KEYCHAIN_PROFILE (or notarytool keychain profile).",
    "Add them as CI secrets, or pass --skip-notarization for a signed local build that will not be distributed.",
  ].join("\n");
}
