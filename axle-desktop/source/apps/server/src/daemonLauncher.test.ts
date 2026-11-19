import { describe, expect, it } from "vite-plus/test";

import {
  DaemonLauncherUnstableError,
  resolveDaemonLauncher,
  type DaemonLauncherEnvironment,
} from "./daemonLauncher.ts";

const environment = (overrides: Partial<DaemonLauncherEnvironment>): DaemonLauncherEnvironment => ({
  isPackaged: false,
  platform: "linux",
  execPath: "/usr/bin/node",
  entryScript: "/opt/axle/dist/bin.mjs",
  appImagePath: undefined,
  ...overrides,
});

describe("resolveDaemonLauncher", () => {
  it("uses node plus the entry script when running from the CLI", () => {
    expect(resolveDaemonLauncher(environment({}))).toEqual({
      command: "/usr/bin/node",
      args: ["/opt/axle/dist/bin.mjs"],
      env: {},
    });
  });

  it("starts the AppImage itself on packaged Linux, not the per-launch mount", () => {
    const launcher = resolveDaemonLauncher(
      environment({
        isPackaged: true,
        execPath: "/tmp/.mount_Axle.A5eM0PZ/axle",
        entryScript: undefined,
        appImagePath: "/home/user/Applications/Axle.AppImage",
      }),
    );
    expect(launcher.command).toBe("/home/user/Applications/Axle.AppImage");
    expect(launcher.args).toEqual([]);
    // Without this the launcher would open a window instead of serving.
    expect(launcher.env).toEqual({ AXLE_DAEMON: "1" });
  });

  it("refuses to install when a packaged Linux app has no APPIMAGE path", () => {
    expect(() =>
      resolveDaemonLauncher(
        environment({
          isPackaged: true,
          execPath: "/tmp/.mount_Axle.A5eM0PZ/axle",
          entryScript: undefined,
          appImagePath: undefined,
        }),
      ),
    ).toThrow(DaemonLauncherUnstableError);
  });

  it("refuses an APPIMAGE path that is itself a per-launch mount", () => {
    expect(() =>
      resolveDaemonLauncher(
        environment({
          isPackaged: true,
          appImagePath: "/tmp/.mount_Axle.A5eM0PZ/Axle.AppImage",
          entryScript: undefined,
        }),
      ),
    ).toThrow(DaemonLauncherUnstableError);
  });

  it("uses the installed binary on packaged macOS", () => {
    expect(
      resolveDaemonLauncher(
        environment({
          isPackaged: true,
          platform: "darwin",
          execPath: "/Applications/Axle.app/Contents/MacOS/Axle",
          entryScript: undefined,
        }),
      ),
    ).toEqual({
      command: "/Applications/Axle.app/Contents/MacOS/Axle",
      args: [],
      env: { AXLE_DAEMON: "1" },
    });
  });

  it("uses the installed binary on packaged Windows", () => {
    expect(
      resolveDaemonLauncher(
        environment({
          isPackaged: true,
          platform: "win32",
          execPath: "C:\\Program Files\\Axle\\Axle.exe",
          entryScript: undefined,
        }),
      ).command,
    ).toBe("C:\\Program Files\\Axle\\Axle.exe");
  });

  it("refuses an unpackaged entry script inside a per-launch mount", () => {
    expect(() =>
      resolveDaemonLauncher(
        environment({ entryScript: "/tmp/.mount_Axle.A5eM0PZ/resources/bin.mjs" }),
      ),
    ).toThrow(DaemonLauncherUnstableError);
  });

  it("refuses when there is no entry script to run", () => {
    expect(() => resolveDaemonLauncher(environment({ entryScript: undefined }))).toThrow(
      DaemonLauncherUnstableError,
    );
  });
});
