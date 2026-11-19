// @effect-diagnostics nodeBuiltinImport:off - runs before the Effect runtime exists
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Electron from "electron";

/**
 * Registering the background service on behalf of the user.
 *
 * The daemon is what keeps a phone connected after the window closes, so it is
 * not something the user opts into — the app registers it on launch. The work
 * is delegated to the bundled server's `daemon ensure`, which owns every
 * platform's service format and only writes when the service is missing or
 * names an app that no longer exists.
 *
 * Deliberately best-effort. A user whose session forbids login services (no
 * systemd user instance, a locked-down login agent) must still get a working
 * window, so a failure here is logged and otherwise ignored.
 */

/** Mirrors daemonMode's appRoot: the asar path when packaged, the repo root in development. */
const serverEntryPath = (dirname: string): string => {
  const appRoot = Electron.app.isPackaged
    ? Electron.app.getAppPath()
    : NodePath.resolve(dirname, "../../..");
  return NodePath.join(appRoot, "apps/server/dist/bin.mjs");
};

export interface EnsureDaemonServiceOptions {
  /** `__dirname` of the caller, used to locate the server bundle. */
  readonly dirname: string;
  /** Host the service should bind when this call is the one that installs it. */
  readonly host?: string | undefined;
}

/**
 * Resolves once the ensure attempt finishes. Never rejects.
 */
export function ensureDaemonService(options: EnsureDaemonServiceOptions): Promise<void> {
  const args = [serverEntryPath(options.dirname), "daemon", "ensure"];
  if (options.host !== undefined && options.host.length > 0) {
    args.push("--host", options.host);
  }

  return new Promise<void>((resolve) => {
    let child: NodeChildProcess.ChildProcess;
    try {
      child = NodeChildProcess.spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Re-enter the Electron binary as Node, the same way the app starts
          // its own backend.
          ELECTRON_RUN_AS_NODE: "1",
          // Tells the installer that execPath is a packaged app binary, so it
          // records the stable launcher path instead of a per-launch mount.
          ...(Electron.app.isPackaged ? { AXLE_PACKAGED: "1" } : {}),
          // Must not leak in, or the child would come up as a daemon itself.
          AXLE_DAEMON: undefined,
        },
      });
    } catch (error) {
      process.stderr.write(`Axle could not register its background service: ${String(error)}\n`);
      resolve();
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      process.stderr.write(`Axle could not register its background service: ${error.message}\n`);
      resolve();
    });
    child.once("close", (code) => {
      if (code !== 0) {
        process.stderr.write(
          `Axle could not register its background service (exit ${String(code)}). ${stderr.trim()}\n`,
        );
      }
      resolve();
    });
  });
}
