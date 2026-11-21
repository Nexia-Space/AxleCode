import { describe, expect, it } from "vite-plus/test";

import { resolveDaemonArgs } from "./daemonMode.ts";

describe("resolveDaemonArgs", () => {
  it("forwards the host the service unit asked for", () => {
    // The unit records the full command; dropping --host left the daemon on
    // loopback and unreachable from the phone it exists to serve.
    expect(
      resolveDaemonArgs([
        "/home/me/Applications/Axle.AppImage",
        "daemon",
        "run",
        "--no-browser",
        "--host",
        "0.0.0.0",
      ]),
    ).toEqual(["daemon", "run", "--no-browser", "--host", "0.0.0.0"]);
  });

  it("forwards port and base-dir too", () => {
    expect(
      resolveDaemonArgs(["/app", "daemon", "run", "--port", "4000", "--base-dir", "/data"]),
    ).toEqual(["daemon", "run", "--port", "4000", "--base-dir", "/data"]);
  });

  it("drops Electron's own switches ahead of the subcommand", () => {
    expect(
      resolveDaemonArgs(["/app", "--no-sandbox", "daemon", "run", "--host", "0.0.0.0"]),
    ).toEqual(["daemon", "run", "--host", "0.0.0.0"]);
  });

  it("falls back to the defaults when argv carries no subcommand", () => {
    expect(resolveDaemonArgs(["/app"])).toEqual(["daemon", "run", "--no-browser"]);
  });

  it("falls back when 'daemon' is the final argument", () => {
    expect(resolveDaemonArgs(["/app", "daemon"])).toEqual(["daemon", "run", "--no-browser"]);
  });
});
