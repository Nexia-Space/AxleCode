/**
 * Letting a running daemon notice that its app has been uninstalled.
 *
 * Neither a Linux AppImage nor a macOS `.app` has an uninstall hook — both are
 * simply deleted — so nothing gets the chance to remove the login service on
 * the way out. A unit left behind cannot start, since its executable is gone,
 * but it still sits in the user's login services indefinitely.
 *
 * The daemon is the one process in a position to notice, so it watches its own
 * launcher and retires the service once the app stops existing.
 *
 * The streak threshold exists because an app upgrade replaces the binary: the
 * path can be absent for a moment while the new version is written. Retiring on
 * the first miss would uninstall the service during a routine update.
 */

export interface SelfRetireState {
  readonly consecutiveMisses: number;
}

export interface SelfRetireDecision {
  readonly state: SelfRetireState;
  /** True exactly once, on the check that crosses the threshold. */
  readonly retire: boolean;
}

export const SELF_RETIRE_MISS_THRESHOLD = 3;

export const initialSelfRetireState: SelfRetireState = { consecutiveMisses: 0 };

export function nextSelfRetireState(
  state: SelfRetireState,
  appPresent: boolean,
  threshold: number = SELF_RETIRE_MISS_THRESHOLD,
): SelfRetireDecision {
  if (appPresent) {
    return { state: initialSelfRetireState, retire: false };
  }
  const consecutiveMisses = state.consecutiveMisses + 1;
  return {
    state: { consecutiveMisses },
    // Equality, not >=, so a caller that keeps polling past the threshold asks
    // to retire once rather than on every subsequent check.
    retire: consecutiveMisses === threshold,
  };
}
