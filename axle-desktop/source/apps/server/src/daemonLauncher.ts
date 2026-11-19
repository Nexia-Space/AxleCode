/**
 * Choosing the executable a daemon service unit should start.
 *
 * `daemon install` writes a unit that the OS runs at boot, long after the
 * installing process is gone, so the recorded command has to stay valid
 * forever. Deriving it from `process.execPath` and `process.argv[1]` is only
 * safe when those are stable paths.
 *
 * They are not in a packaged app. A Linux AppImage mounts itself under a fresh
 * `/tmp/.mount_<name><random>` directory on every launch, so a unit recorded
 * from inside one points at a mount that no longer exists the next time the
 * machine boots — the service fails, or worse, silently never starts. The
 * stable handle is the AppImage file itself, which AppRun exposes as
 * `$APPIMAGE`.
 *
 * macOS and Windows keep their executables at an installed path, so
 * `execPath` is already stable there.
 */

/** Marker AppImage's AppRun uses for its per-launch mount directory. */
const APPIMAGE_MOUNT_PREFIX = "/tmp/.mount_";

export interface DaemonLauncherEnvironment {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  /** `process.execPath` — node in development, the app binary when packaged. */
  readonly execPath: string;
  /** `process.argv[1]` — the CLI entry script, absent for a packaged binary. */
  readonly entryScript: string | undefined;
  /** `process.env.APPIMAGE`, set by AppRun to the AppImage's own path. */
  readonly appImagePath: string | undefined;
}

export interface DaemonLauncherCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Env the unit must set so the launcher starts headless instead of windowed. */
  readonly env: Readonly<Record<string, string>>;
}

export class DaemonLauncherUnstableError extends Error {
  constructor(readonly attemptedPath: string) {
    super(
      `Refusing to install a daemon service that starts ${attemptedPath}: that path is a per-launch AppImage mount and will not exist on the next boot. Set APPIMAGE to the AppImage's own path, or install the daemon from the axle CLI instead.`,
    );
    this.name = "DaemonLauncherUnstableError";
  }
}

const isEphemeralMountPath = (candidate: string): boolean =>
  candidate.startsWith(APPIMAGE_MOUNT_PREFIX);

/**
 * The command a service unit should run, or a thrown
 * {@link DaemonLauncherUnstableError} when only an ephemeral path is available
 * — better to refuse than to record a unit that breaks on reboot.
 */
export function resolveDaemonLauncher(
  environment: DaemonLauncherEnvironment,
): DaemonLauncherCommand {
  // Development and the npm CLI: node plus the entry script, both stable.
  if (!environment.isPackaged) {
    const entryScript = environment.entryScript;
    if (entryScript === undefined) {
      throw new DaemonLauncherUnstableError(environment.execPath);
    }
    if (isEphemeralMountPath(entryScript) || isEphemeralMountPath(environment.execPath)) {
      throw new DaemonLauncherUnstableError(
        isEphemeralMountPath(entryScript) ? entryScript : environment.execPath,
      );
    }
    return { command: environment.execPath, args: [entryScript], env: {} };
  }

  // Packaged Linux: the mount is per-launch, so start the AppImage file.
  if (environment.platform === "linux") {
    const appImagePath = environment.appImagePath;
    if (appImagePath === undefined || appImagePath.length === 0) {
      throw new DaemonLauncherUnstableError(environment.execPath);
    }
    if (isEphemeralMountPath(appImagePath)) {
      throw new DaemonLauncherUnstableError(appImagePath);
    }
    // The packaged launcher has no CLI subcommands, so the env var below is
    // what tells it to come up as a headless backend.
    return { command: appImagePath, args: [], env: { AXLE_DAEMON: "1" } };
  }

  // Packaged macOS and Windows install to a fixed location.
  if (isEphemeralMountPath(environment.execPath)) {
    throw new DaemonLauncherUnstableError(environment.execPath);
  }
  return { command: environment.execPath, args: [], env: { AXLE_DAEMON: "1" } };
}

export function daemonLauncherEnvironmentFromProcess(
  isPackaged: boolean,
): DaemonLauncherEnvironment {
  return {
    isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    entryScript: process.argv[1],
    appImagePath: process.env.APPIMAGE,
  };
}
