import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Electron from "electron";

/**
 * Running the packaged app as a background daemon instead of a window.
 *
 * A service unit cannot name the server bundle directly: inside an AppImage it
 * lives under a `/tmp/.mount_<name><random>` directory that is different on
 * every launch. The stable thing to record is the app itself, so the unit
 * starts the app with `AXLE_DAEMON=1` and this module turns that into a
 * headless backend.
 *
 * It must run before anything touches Electron's lifecycle. The daemon takes
 * no single-instance lock and opens no window, so starting it can never stop
 * the real app from opening - the failure mode that makes a login-time service
 * dangerous.
 */
export const isDaemonMode = (): boolean => process.env.AXLE_DAEMON === "1";

/**
 * Run the bundled server in a child process and resolve with its exit code.
 *
 * The child is this same binary re-entered as plain Node via
 * `ELECTRON_RUN_AS_NODE`, which is how the app already starts its own backend.
 * Nothing here constructs an Electron app, so no window, dock icon, or
 * instance lock is ever created.
 */
export function runDaemon(dirname: string): Promise<number> {
  // Mirrors DesktopEnvironment's appRoot: the asar path when packaged, the
  // repository root in development.
  const appRoot = Electron.app.isPackaged
    ? Electron.app.getAppPath()
    : NodePath.resolve(dirname, "../../..");
  const serverEntry = NodePath.join(appRoot, "apps/server/dist/bin.mjs");

  return new Promise<number>((resolve) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [serverEntry, "daemon", "run", "--no-browser"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          // Re-enter the Electron binary as Node rather than as an app.
          ELECTRON_RUN_AS_NODE: "1",
          AXLE_DAEMON: "1",
        },
      },
    );
    // The service manager watches this process, so stay alive for the child
    // and hand its exit status back up rather than exiting early.
    child.once("error", (error) => {
      process.stderr.write(`Axle daemon failed to start: ${error.message}\n`);
      resolve(1);
    });
    child.once("close", (code, signal) => {
      resolve(signal !== null ? 1 : (code ?? 0));
    });
    for (const forwarded of ["SIGINT", "SIGTERM"] as const) {
      process.once(forwarded, () => child.kill(forwarded));
    }
  });
}
