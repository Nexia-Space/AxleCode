// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
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

const SERVICE_NAME = "com.axle.desktop-daemon";
const LINUX_SERVICE_NAME = "axle-daemon.service";
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

const daemonEntryPath = (): string => process.argv[1] ?? "axle";

const daemonInvocation = (flags: DaemonServiceFlags): ReadonlyArray<string> => {
  const args = [daemonEntryPath(), "daemon", "run", "--no-browser"];
  const host = Option.getOrUndefined(flags.host);
  const port = Option.getOrUndefined(flags.port);
  const baseDir = Option.getOrUndefined(flags.baseDir);
  if (host !== undefined) args.push("--host", host);
  if (port !== undefined) args.push("--port", String(port));
  if (baseDir !== undefined) args.push("--base-dir", baseDir);
  return args;
};

const daemonInvocationString = (flags: DaemonServiceFlags): string =>
  [process.execPath, ...daemonInvocation(flags)].map(shellQuote).join(" ");

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
  const taskName = "Axle Desktop Daemon";
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
    runCommand("schtasks.exe", ["/End", "/TN", "Axle Desktop Daemon"]);
    runCommand("schtasks.exe", ["/Delete", "/TN", "Axle Desktop Daemon", "/F"]);
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
    daemonUninstallCommand,
    daemonStatusCommand,
  ]),
);
