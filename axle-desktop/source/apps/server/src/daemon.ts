// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalTimers:off
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "./config.ts";
import { runServerCommand } from "./cli/server.ts";
import { sharedServerCommandFlags, type CliServerFlags } from "./cli/config.ts";
import {
  daemonLauncherEnvironmentFromProcess,
  installedCommandFromLaunchdPlist,
  installedCommandFromSystemdUnit,
  resolveDaemonLauncher,
  type DaemonLauncherCommand,
} from "./daemonLauncher.ts";
import { initialSelfRetireState, nextSelfRetireState } from "./daemonSelfRetire.ts";

const SERVICE_NAME = "com.axle.desktop-daemon";
const LINUX_SERVICE_NAME = "axle-daemon.service";
const WINDOWS_TASK_NAME = "Axle Desktop Daemon";
const DEFAULT_DAEMON_BASE_DIR = NodePath.join(NodeOs.homedir(), ".axle-desktop");

const daemonHostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface for the daemon (127.0.0.1 by default)."),
  Flag.optional,
);
const daemonPortFlag = Flag.integer("port").pipe(
  Flag.withDescription("Port for the daemon HTTP/WebSocket server."),
  Flag.optional,
);
const daemonBaseDirFlag = Flag.string("base-dir").pipe(
  Flag.withDescription("Axle data directory used by the daemon."),
  Flag.optional,
);

const daemonServiceFlags = {
  host: daemonHostFlag,
  port: daemonPortFlag,
  baseDir: daemonBaseDirFlag,
} as const;

type DaemonServiceFlags = {
  readonly host: Option.Option<string>;
  readonly port: Option.Option<number>;
  readonly baseDir: Option.Option<string>;
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Throws DaemonLauncherUnstableError rather than recording a command that only
 * resolves for the lifetime of this process — see daemonLauncher.ts.
 */
const daemonLauncher = (): DaemonLauncherCommand =>
  // The bundled server has no Electron to ask, so the desktop app sets this
  // when it installs the service on our behalf. Absent means the standalone
  // CLI, where execPath and argv[1] are already stable paths.
  resolveDaemonLauncher(daemonLauncherEnvironmentFromProcess(process.env.AXLE_PACKAGED === "1"));

const daemonInvocation = (flags: DaemonServiceFlags): ReadonlyArray<string> => {
  const launcher = daemonLauncher();
  const args = [...launcher.args, "daemon", "run", "--no-browser"];
  const host = Option.getOrUndefined(flags.host);
  const port = Option.getOrUndefined(flags.port);
  const baseDir = Option.getOrUndefined(flags.baseDir);
  if (host !== undefined) args.push("--host", host);
  if (port !== undefined) args.push("--port", String(port));
  if (baseDir !== undefined) args.push("--base-dir", baseDir);
  return args;
};

const daemonInvocationString = (flags: DaemonServiceFlags): string =>
  [daemonLauncher().command, ...daemonInvocation(flags)].map(shellQuote).join(" ");

const resolveStatePath = (flags: DaemonServiceFlags): string => {
  const baseDir =
    Option.getOrUndefined(flags.baseDir) ??
    process.env.T3CODE_HOME ??
    process.env.AXLE_HOME ??
    DEFAULT_DAEMON_BASE_DIR;
  return NodePath.join(baseDir, "userdata", "server-runtime.json");
};

const resolveBaseDir = (flags: DaemonServiceFlags): string =>
  Option.getOrUndefined(flags.baseDir) ??
  process.env.T3CODE_HOME ??
  process.env.AXLE_HOME ??
  DEFAULT_DAEMON_BASE_DIR;

const ensureDesktopBootstrapToken = (flags: DaemonServiceFlags): string => {
  const tokenPath = NodePath.join(resolveBaseDir(flags), "userdata", "daemon-desktop-token");
  try {
    const existing = NodeFs.readFileSync(tokenPath, "utf8").trim();
    if (existing.length > 0) return existing;
  } catch {
    // The daemon creates the credential on first start.
  }
  const token = NodeCrypto.randomBytes(32).toString("hex");
  NodeFs.mkdirSync(NodePath.dirname(tokenPath), { recursive: true });
  NodeFs.writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    NodeFs.chmodSync(tokenPath, 0o600);
  } catch {
    // Windows does not support POSIX file modes; the user service still owns
    // the file inside the user's private data directory.
  }
  return token;
};

const writeText = (path: string, contents: string): void => {
  NodeFs.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFs.writeFileSync(path, contents, "utf8");
};

const runCommand = (command: string, args: ReadonlyArray<string>): void => {
  NodeChildProcess.spawnSync(command, args, { stdio: "inherit" });
};

const installMacService = (flags: DaemonServiceFlags): string => {
  const servicePath = NodePath.join(
    NodeOs.homedir(),
    "Library",
    "LaunchAgents",
    `${SERVICE_NAME}.plist`,
  );
  const programArguments = daemonInvocation(flags)
    .map(
      (argument) =>
        `    <string>${argument.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`,
    )
    .join("\n");
  writeText(
    servicePath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key><array>
${programArguments}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
`,
  );
  const domain = `gui/${process.getuid?.() ?? ""}`;
  runCommand("launchctl", ["bootout", domain, servicePath]);
  runCommand("launchctl", ["bootstrap", domain, servicePath]);
  runCommand("launchctl", ["enable", `${domain}/${SERVICE_NAME}`]);
  return servicePath;
};

const installLinuxService = (flags: DaemonServiceFlags): string => {
  const servicePath = NodePath.join(
    process.env.XDG_CONFIG_HOME ?? NodePath.join(NodeOs.homedir(), ".config"),
    "systemd",
    "user",
    LINUX_SERVICE_NAME,
  );
  writeText(
    servicePath,
    `[Unit]
Description=Axle desktop daemon
After=network-online.target

[Service]
ExecStart=${daemonInvocationString(flags)}
Restart=on-failure
RestartSec=2
Environment=AXLE_DAEMON=1

[Install]
WantedBy=default.target
`,
  );
  runCommand("systemctl", ["--user", "daemon-reload"]);
  runCommand("systemctl", ["--user", "enable", "--now", LINUX_SERVICE_NAME]);
  return servicePath;
};

const installWindowsService = (flags: DaemonServiceFlags): string => {
  const taskName = WINDOWS_TASK_NAME;
  const taskCommand = daemonInvocationString(flags);
  runCommand("schtasks.exe", [
    "/Create",
    "/TN",
    taskName,
    "/TR",
    taskCommand,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
  ]);
  runCommand("schtasks.exe", ["/Run", "/TN", taskName]);
  return taskName;
};

const installService = (flags: DaemonServiceFlags): string => {
  switch (process.platform) {
    case "darwin":
      return installMacService(flags);
    case "win32":
      return installWindowsService(flags);
    default:
      return installLinuxService(flags);
  }
};

const uninstallService = (): void => {
  if (process.platform === "darwin") {
    const servicePath = NodePath.join(
      NodeOs.homedir(),
      "Library",
      "LaunchAgents",
      `${SERVICE_NAME}.plist`,
    );
    const domain = `gui/${process.getuid?.() ?? ""}`;
    runCommand("launchctl", ["bootout", domain, servicePath]);
    NodeFs.rmSync(servicePath, { force: true });
    return;
  }
  if (process.platform === "win32") {
    runCommand("schtasks.exe", ["/End", "/TN", WINDOWS_TASK_NAME]);
    runCommand("schtasks.exe", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
    return;
  }
  runCommand("systemctl", ["--user", "disable", "--now", LINUX_SERVICE_NAME]);
  const servicePath = NodePath.join(
    process.env.XDG_CONFIG_HOME ?? NodePath.join(NodeOs.homedir(), ".config"),
    "systemd",
    "user",
    LINUX_SERVICE_NAME,
  );
  NodeFs.rmSync(servicePath, { force: true });
  runCommand("systemctl", ["--user", "daemon-reload"]);
};

/** Where this platform records the user service, or null on Windows (a task name). */
const serviceFilePath = (): string | null => {
  if (process.platform === "darwin") {
    return NodePath.join(NodeOs.homedir(), "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
  }
  if (process.platform === "win32") {
    return null;
  }
  return NodePath.join(
    process.env.XDG_CONFIG_HOME ?? NodePath.join(NodeOs.homedir(), ".config"),
    "systemd",
    "user",
    LINUX_SERVICE_NAME,
  );
};

type DaemonServiceHealth =
  | { readonly _tag: "absent" }
  | { readonly _tag: "healthy"; readonly command: string }
  /** The unit is correct but switched off, so nothing is actually serving. */
  | { readonly _tag: "stopped"; readonly command: string }
  /** Installed, but the app it starts is gone — an upgrade moved it, or it was deleted. */
  | { readonly _tag: "stale"; readonly command: string | null };

const commandSucceeds = (command: string, args: ReadonlyArray<string>): boolean => {
  try {
    return NodeChildProcess.spawnSync(command, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};

/**
 * Whether the service manager will actually keep the daemon running.
 *
 * A unit file on disk proves nothing: it can be present but disabled or
 * stopped, which is indistinguishable from uninstalled as far as the user's
 * phone is concerned.
 */
const serviceIsLive = (): boolean => {
  if (process.platform === "darwin") {
    const domain = `gui/${process.getuid?.() ?? ""}`;
    return commandSucceeds("launchctl", ["print", `${domain}/${SERVICE_NAME}`]);
  }
  if (process.platform === "win32") {
    return commandSucceeds("schtasks.exe", ["/Query", "/TN", WINDOWS_TASK_NAME]);
  }
  return (
    commandSucceeds("systemctl", ["--user", "is-active", "--quiet", LINUX_SERVICE_NAME]) &&
    commandSucceeds("systemctl", ["--user", "is-enabled", "--quiet", LINUX_SERVICE_NAME])
  );
};

/** Enable and start an existing unit without rewriting it. */
const startExistingService = (): void => {
  if (process.platform === "darwin") {
    const path = serviceFilePath();
    const domain = `gui/${process.getuid?.() ?? ""}`;
    if (path !== null) runCommand("launchctl", ["bootstrap", domain, path]);
    runCommand("launchctl", ["enable", `${domain}/${SERVICE_NAME}`]);
    return;
  }
  if (process.platform === "win32") {
    runCommand("schtasks.exe", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    return;
  }
  runCommand("systemctl", ["--user", "enable", "--now", LINUX_SERVICE_NAME]);
};

/**
 * Whether an installed service still points at an app that exists.
 *
 * A unit naming a missing executable is the signature of an app that was
 * deleted or replaced. systemd keeps retrying it until the start limit, so it
 * never serves anything; the useful response is to clear it out rather than
 * leave litter behind in the user's login services.
 */
const inspectDaemonService = (): DaemonServiceHealth => {
  const path = serviceFilePath();
  // Windows exposes no readable unit, so trust the scheduled task and leave it.
  if (path === null) return { _tag: "absent" };
  let contents: string;
  try {
    contents = NodeFs.readFileSync(path, "utf8");
  } catch {
    return { _tag: "absent" };
  }
  const command =
    process.platform === "darwin"
      ? installedCommandFromLaunchdPlist(contents)
      : installedCommandFromSystemdUnit(contents);
  if (command === null) return { _tag: "stale", command: null };
  if (!NodeFs.existsSync(command)) return { _tag: "stale", command };
  return serviceIsLive() ? { _tag: "healthy", command } : { _tag: "stopped", command };
};

export type DaemonEnsureOutcome =
  | { readonly _tag: "installed"; readonly service: string }
  | { readonly _tag: "repaired"; readonly service: string; readonly previousCommand: string | null }
  | { readonly _tag: "started"; readonly command: string }
  | { readonly _tag: "unchanged"; readonly command: string };

/**
 * Install the service when it is missing or broken, and otherwise leave it
 * exactly as it is.
 *
 * Deliberately not idempotent-by-rewrite: a unit the user installed by hand may
 * carry flags the app knows nothing about (a `--host`, a custom `--base-dir`),
 * and rewriting it on every launch would silently discard them.
 */
export const ensureDaemonService = (flags: DaemonServiceFlags): DaemonEnsureOutcome => {
  const health = inspectDaemonService();
  if (health._tag === "healthy") {
    return { _tag: "unchanged", command: health.command };
  }
  // Switch it back on, but keep the unit as-is: it may carry flags this call
  // knows nothing about, such as a --host the user chose.
  if (health._tag === "stopped") {
    startExistingService();
    return { _tag: "started", command: health.command };
  }
  if (health._tag === "stale") {
    uninstallService();
    return {
      _tag: "repaired",
      service: installService(flags),
      previousCommand: health.command,
    };
  }
  return { _tag: "installed", service: installService(flags) };
};

const SELF_RETIRE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Remove our own login service once the app that owns it is gone.
 *
 * Deleting an AppImage or a .app runs no uninstall hook, so this is the only
 * opportunity to clean up. The timer is unref'd: it must never be the reason
 * the process stays alive.
 */
const watchForUninstalledApp = (): void => {
  let state = initialSelfRetireState;
  const timer = setInterval(() => {
    const health = inspectDaemonService();
    // "absent" means someone already removed the unit; nothing left to retire.
    if (health._tag === "absent") return;
    const appPresent = health._tag !== "stale";
    const decision = nextSelfRetireState(state, appPresent);
    state = decision.state;
    if (!decision.retire) return;
    process.stderr.write(
      "Axle daemon: the app that installed this service no longer exists. Removing the service and exiting.\n",
    );
    try {
      uninstallService();
    } finally {
      clearInterval(timer);
      process.exit(0);
    }
  }, SELF_RETIRE_CHECK_INTERVAL_MS);
  timer.unref?.();
};

const daemonRunFlags = {
  ...sharedServerCommandFlags,
} as const;

const daemonRunCommand = Command.make("run", daemonRunFlags).pipe(
  Command.withDescription("Run the persistent Axle server daemon."),
  Command.withHandler((flags: CliServerFlags) =>
    Effect.sync(() => {
      process.env.AXLE_DAEMON = "1";
      if (!process.env.T3CODE_HOME && !process.env.AXLE_HOME && Option.isNone(flags.baseDir)) {
        process.env.T3CODE_HOME = DEFAULT_DAEMON_BASE_DIR;
      }
      process.env.AXLE_DESKTOP_BOOTSTRAP_TOKEN = ensureDesktopBootstrapToken(flags);
      watchForUninstalledApp();
    }).pipe(
      Effect.andThen(
        runServerCommand(flags, {
          startupPresentation: "headless",
          forceAutoBootstrapProjectFromCwd: false,
        }),
      ),
    ),
  ),
);

const daemonInstallCommand = Command.make("install", daemonServiceFlags).pipe(
  Command.withDescription("Install and start the Axle daemon for the current user."),
  Command.withHandler((flags) =>
    Effect.sync(() => {
      process.stdout.write(`Installed Axle daemon: ${installService(flags)}\n`);
    }),
  ),
);

const daemonEnsureCommand = Command.make("ensure", daemonServiceFlags).pipe(
  Command.withDescription(
    "Install the Axle daemon only if it is missing or points at an app that no longer exists.",
  ),
  Command.withHandler((flags) =>
    Effect.sync(() => {
      const outcome = ensureDaemonService(flags);
      switch (outcome._tag) {
        case "installed":
          process.stdout.write(`Installed Axle daemon: ${outcome.service}\n`);
          return;
        case "repaired":
          process.stdout.write(
            `Reinstalled Axle daemon (previous entry ${outcome.previousCommand ?? "unreadable"} is gone): ${outcome.service}\n`,
          );
          return;
        case "started":
          process.stdout.write(`Started the existing Axle daemon: ${outcome.command}\n`);
          return;
        case "unchanged":
          process.stdout.write(`Axle daemon already running: ${outcome.command}\n`);
          return;
      }
    }),
  ),
);

const daemonUninstallCommand = Command.make("uninstall").pipe(
  Command.withDescription("Stop and remove the Axle daemon user service."),
  Command.withHandler(() =>
    Effect.sync(() => {
      uninstallService();
      process.stdout.write("Removed Axle daemon service.\n");
    }),
  ),
);

const daemonStatusCommand = Command.make("status", daemonServiceFlags).pipe(
  Command.withDescription("Show the persistent Axle daemon runtime state."),
  Command.withHandler((flags) =>
    Effect.sync(() => {
      const statePath = resolveStatePath(flags);
      if (!NodeFs.existsSync(statePath)) {
        process.stdout.write("Axle daemon is not running.\n");
        return;
      }
      try {
        const state = JSON.parse(NodeFs.readFileSync(statePath, "utf8")) as {
          readonly pid?: number;
          readonly origin?: string;
          readonly startedAt?: string;
        };
        const running = typeof state.pid === "number" && NodeProcessIsAlive(state.pid);
        process.stdout.write(`${JSON.stringify({ running, ...state }, null, 2)}\n`);
      } catch {
        process.stdout.write(`Axle daemon state is unreadable: ${statePath}\n`);
      }
    }),
  ),
);

const NodeProcessIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const daemonCommand = Command.make("daemon").pipe(
  Command.withDescription("Manage the persistent Axle desktop daemon."),
  Command.withSubcommands([
    daemonRunCommand,
    daemonInstallCommand,
    daemonEnsureCommand,
    daemonUninstallCommand,
    daemonStatusCommand,
  ]),
);
