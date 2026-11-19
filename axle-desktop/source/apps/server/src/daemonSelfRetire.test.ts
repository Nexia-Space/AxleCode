import { describe, expect, it } from "vite-plus/test";

import {
  initialSelfRetireState,
  nextSelfRetireState,
  SELF_RETIRE_MISS_THRESHOLD,
} from "./daemonSelfRetire.ts";

describe("nextSelfRetireState", () => {
  it("does nothing while the app is present", () => {
    const decision = nextSelfRetireState(initialSelfRetireState, true);
    expect(decision).toEqual({ state: { consecutiveMisses: 0 }, retire: false });
  });

  it("does not retire on the first miss, so an upgrade swapping the binary is survivable", () => {
    const decision = nextSelfRetireState(initialSelfRetireState, false);
    expect(decision.retire).toBe(false);
    expect(decision.state.consecutiveMisses).toBe(1);
  });

  it("retires once the miss streak reaches the threshold", () => {
    let state = initialSelfRetireState;
    const retires: boolean[] = [];
    for (let check = 0; check < SELF_RETIRE_MISS_THRESHOLD; check += 1) {
      const decision = nextSelfRetireState(state, false);
      state = decision.state;
      retires.push(decision.retire);
    }
    expect(retires).toEqual([false, false, true]);
  });

  it("asks to retire only once even if polling continues", () => {
    let state = initialSelfRetireState;
    const retires: boolean[] = [];
    for (let check = 0; check < SELF_RETIRE_MISS_THRESHOLD + 3; check += 1) {
      const decision = nextSelfRetireState(state, false);
      state = decision.state;
      retires.push(decision.retire);
    }
    expect(retires.filter(Boolean)).toHaveLength(1);
  });

  it("resets the streak when the app reappears mid-upgrade", () => {
    let state = nextSelfRetireState(initialSelfRetireState, false).state;
    state = nextSelfRetireState(state, false).state;
    expect(state.consecutiveMisses).toBe(2);

    const recovered = nextSelfRetireState(state, true);
    expect(recovered.state.consecutiveMisses).toBe(0);
    expect(recovered.retire).toBe(false);

    // A later outage has to earn the full streak again.
    expect(nextSelfRetireState(recovered.state, false).retire).toBe(false);
  });

  it("honours an explicit threshold", () => {
    expect(nextSelfRetireState(initialSelfRetireState, false, 1).retire).toBe(true);
  });
});
