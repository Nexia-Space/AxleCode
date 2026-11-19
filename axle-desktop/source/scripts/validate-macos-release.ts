#!/usr/bin/env node
/**
 * Validates a packaged Axle macOS release before it is published.
 *
 * Usage:
 *   node scripts/validate-macos-release.ts release/Axle-arm64.dmg --arch arm64
 *   node scripts/validate-macos-release.ts /Applications/Axle.app --allow-unsigned
 *
 * Strict mode (the default) requires a Developer ID signature, hardened
 * runtime, a stapled notarization ticket, and a passing Gatekeeper assessment.
 * `--allow-unsigned` is for local preview builds only; it still checks bundle
 * structure, architecture, llama.cpp resources, and DMG integrity.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

type Arch = "arm64" | "x64" | "universal";

interface Options {
  readonly input: string;
  readonly arch: Arch;
  readonly bundleId: string;
  readonly expectedVersion: string | undefined;
  readonly allowUnsigned: boolean;
  readonly json: boolean;
}

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly skipped?: boolean;
}

const DEFAULT_BUNDLE_ID = "com.axle.desktop";

function printUsage(): never {
  process.stderr.write(
    [
      "Usage: node scripts/validate-macos-release.ts <Axle-arm64.dmg|Axle.app> [options]",
      "",
      "Options:",
      "  --arch <arm64|x64|universal>  Expected architecture (inferred from the file name when omitted).",
      "  --bundle-id <id>              Expected CFBundleIdentifier (default: com.axle.desktop).",
      "  --version <version>           Expected CFBundleShortVersionString and CFBundleVersion.",
      "  --allow-unsigned              Preview mode: skip signature, Gatekeeper, and notarization checks.",
      "  --json                        Print the report as JSON.",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

function parseArgs(argv: ReadonlyArray<string>): Options {
  const positional: string[] = [];
  let arch: Arch | undefined;
  let bundleId = DEFAULT_BUNDLE_ID;
  let expectedVersion: string | undefined;
  let allowUnsigned = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === "--arch") {
      const value = argv[++index];
      if (value !== "arm64" && value !== "x64" && value !== "universal") {
        throw new Error("--arch must be arm64, x64, or universal.");
      }
      arch = value;
    } else if (argument === "--bundle-id") {
      bundleId = argv[++index] ?? bundleId;
    } else if (argument === "--version") {
      expectedVersion = argv[++index];
    } else if (argument === "--allow-unsigned") {
      allowUnsigned = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--help" || argument === "-h") {
      printUsage();
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length !== 1) {
    printUsage();
  }
  const [inputArgument] = positional;
  if (inputArgument === undefined) {
    printUsage();
  }

  const input = NodePath.resolve(inputArgument);
  const inferredArch = arch ?? inferArchFromName(NodePath.basename(input));
  if (inferredArch === undefined) {
    throw new Error("Pass --arch arm64 or --arch x64; the file name has no architecture.");
  }

  return {
    input,
    arch: inferredArch,
    bundleId,
    expectedVersion,
    allowUnsigned,
    json,
  };
}

function inferArchFromName(name: string): Arch | undefined {
  if (/universal/iu.test(name)) return "universal";
  if (/arm64/iu.test(name)) return "arm64";
  if (/(?:x64|x86_64|intel)/iu.test(name)) return "x64";
  return undefined;
}

function expectedArchitectures(arch: Arch): ReadonlyArray<"arm64" | "x86_64"> {
  return arch === "universal" ? ["arm64", "x86_64"] : arch === "arm64" ? ["arm64"] : ["x86_64"];
}

interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: ReadonlyArray<string>): CommandResult {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function runOrThrow(command: string, args: ReadonlyArray<string>): CommandResult {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = NodeCrypto.createHash("sha256");
    const stream = NodeFS.createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function walk(
  root: string,
  visitor: (path: string, entry: import("node:fs").Dirent) => Promise<void> | void,
): Promise<void> {
  const entries = await NodeFSP.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = NodePath.join(root, entry.name);
    await visitor(entryPath, entry);
    if (entry.isDirectory()) {
      await walk(entryPath, visitor);
    }
  }
}

interface SymlinkReport {
  readonly dangling: ReadonlyArray<string>;
  readonly absolute: ReadonlyArray<string>;
}

async function inspectSymlinks(root: string): Promise<SymlinkReport> {
  const dangling: string[] = [];
  const absolute: string[] = [];
  await walk(root, async (entryPath, entry) => {
    if (!entry.isSymbolicLink()) return;
    const target = await NodeFSP.readlink(entryPath);
    if (NodePath.isAbsolute(target)) {
      absolute.push(entryPath);
    }
    const resolved = NodePath.isAbsolute(target)
      ? target
      : NodePath.resolve(NodePath.dirname(entryPath), target);
    if (!(await exists(resolved))) {
      dangling.push(entryPath);
    }
  });
  return { dangling, absolute };
}

interface InfoPlist {
  readonly CFBundleIdentifier?: string;
  readonly CFBundleExecutable?: string;
  readonly CFBundleShortVersionString?: string;
  readonly CFBundleVersion?: string;
}

function readInfoPlist(appPath: string): InfoPlist {
  const result = runOrThrow("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    NodePath.join(appPath, "Contents/Info.plist"),
  ]);
  return JSON.parse(result.stdout) as InfoPlist;
}

function lipoArchitectures(binaryPath: string): ReadonlyArray<string> {
  const result = runOrThrow("lipo", ["-archs", binaryPath]);
  return result.stdout.trim().split(/\s+/u).filter(Boolean);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checks: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail: string, skipped = false): void => {
    checks.push({ name, ok, detail, skipped });
  };

  if (process.platform !== "darwin") {
    throw new Error("macOS release validation requires a macOS host.");
  }

  if (!(await exists(options.input))) {
    throw new Error(`Input does not exist: ${options.input}`);
  }

  const isDiskImage = /\.dmg$/iu.test(options.input);
  let mountedAt: string | undefined;
  let appPath: string;

  try {
    if (isDiskImage) {
      const verify = run("hdiutil", ["verify", options.input]);
      record("DMG integrity", verify.status === 0, verify.status === 0
        ? "hdiutil verify passed"
        : (verify.stderr || verify.stdout).trim());

      const mountPoint = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "axle-validate-"));
      mountedAt = mountPoint;
      const attach = run("hdiutil", [
        "attach",
        "-nobrowse",
        "-readonly",
        "-noautoopen",
        "-mountpoint",
        mountPoint,
        options.input,
      ]);
      if (attach.status !== 0) {
        record("DMG mounts", false, (attach.stderr || attach.stdout).trim());
        throw new Error("Could not mount the DMG.");
      }
      record("DMG mounts", true, `mounted at ${mountPoint}`);

      const entries = await NodeFSP.readdir(mountPoint);
      const apps = entries.filter((entry) => entry.endsWith(".app"));
      const [appName] = apps;
      record(
        "DMG contains one app",
        apps.length === 1,
        appName !== undefined ? appName : `found: ${apps.join(", ") || "none"}`,
      );
      if (apps.length !== 1 || appName === undefined) {
        throw new Error("Expected exactly one .app in the DMG.");
      }
      const applicationsLink = NodePath.join(mountPoint, "Applications");
      const linkStat = await NodeFSP.lstat(applicationsLink).catch(() => undefined);
      record(
        "DMG /Applications link",
        linkStat?.isSymbolicLink() === true,
        linkStat?.isSymbolicLink() === true ? "Applications -> /Applications" : "missing Applications symlink",
      );
      appPath = NodePath.join(mountPoint, appName);
    } else {
      if (!options.input.endsWith(".app")) {
        throw new Error("Expected a .dmg or .app path.");
      }
      appPath = options.input;
    }

    const info = readInfoPlist(appPath);
    const executableName = info.CFBundleExecutable ?? "Axle";
    const executablePath = NodePath.join(appPath, "Contents/MacOS", executableName);
    const resourcesPath = NodePath.join(appPath, "Contents/Resources");
    const appAsarPath = NodePath.join(resourcesPath, "app.asar");

    const structureProblems: string[] = [];
    if (!(await exists(executablePath))) structureProblems.push("missing Contents/MacOS executable");
    if (!(await exists(appAsarPath))) structureProblems.push("missing Contents/Resources/app.asar");
    if (!(await exists(NodePath.join(appPath, "Contents/Info.plist")))) {
      structureProblems.push("missing Contents/Info.plist");
    }
    record(
      "Bundle structure",
      structureProblems.length === 0,
      structureProblems.length === 0 ? "Info.plist, executable, and app.asar present" : structureProblems.join("; "),
    );

    record(
      "Bundle identifier",
      info.CFBundleIdentifier === options.bundleId,
      `CFBundleIdentifier=${info.CFBundleIdentifier ?? "missing"}`,
    );

    if (options.expectedVersion !== undefined) {
      const versionMatches =
        info.CFBundleShortVersionString === options.expectedVersion &&
        info.CFBundleVersion === options.expectedVersion;
      record(
        "Bundle version",
        versionMatches,
        `CFBundleShortVersionString=${info.CFBundleShortVersionString ?? "missing"}, CFBundleVersion=${info.CFBundleVersion ?? "missing"} (expected ${options.expectedVersion})`,
      );
    }

    if (await exists(executablePath)) {
      const actualArchitectures = lipoArchitectures(executablePath);
      const missingArchitectures = expectedArchitectures(options.arch).filter(
        (architecture) => !actualArchitectures.includes(architecture),
      );
      record(
        "Application architecture",
        missingArchitectures.length === 0,
        `lipo -archs: ${actualArchitectures.join(" ") || "unknown"} (expected ${options.arch})`,
      );
    }

    const llamaRoot = NodePath.join(resourcesPath, "axle", "llama");
    const runtimeArchitectures = options.arch === "universal" ? ["arm64", "x64"] : [options.arch];
    const expectedRuntimes = runtimeArchitectures.map((architecture) => `darwin-${architecture}`);
    const llamaEntries = await NodeFSP.readdir(llamaRoot, { withFileTypes: true }).catch(() => []);
    const llamaDirectories = llamaEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const foreignRuntimes = llamaDirectories.filter((directory) => !directory.startsWith("darwin-"));
    const missingRuntimes = expectedRuntimes.filter((directory) => !llamaDirectories.includes(directory));
    record(
      "llama.cpp runtime platform",
      foreignRuntimes.length === 0 && missingRuntimes.length === 0,
      [
        missingRuntimes.length > 0 ? `missing ${missingRuntimes.join(", ")}` : undefined,
        foreignRuntimes.length > 0 ? `foreign ${foreignRuntimes.join(", ")}` : undefined,
      ]
        .filter((detail): detail is string => detail !== undefined)
        .join("; ") || `contains ${llamaDirectories.join(", ")}`,
    );

    const llamaServerProblems: string[] = [];
    for (const runtime of expectedRuntimes) {
      const serverPath = NodePath.join(llamaRoot, runtime, "llama-server");
      if (!(await exists(serverPath))) {
        llamaServerProblems.push(`missing ${runtime}/llama-server`);
      } else {
        const architectures = lipoArchitectures(serverPath);
        const expected = runtime.endsWith("arm64") ? "arm64" : "x86_64";
        if (!architectures.includes(expected)) {
          llamaServerProblems.push(`${runtime}/llama-server is ${architectures.join(" ") || "unknown"}, expected ${expected}`);
        }
      }
    }
    record(
      "llama.cpp runtime binaries",
      llamaServerProblems.length === 0,
      llamaServerProblems.length === 0 ? "llama-server present for every target architecture" : llamaServerProblems.join("; "),
    );

    const axleBinaryPath = NodePath.join(resourcesPath, "axle", "axle");
    if (await exists(axleBinaryPath)) {
      const architectures = lipoArchitectures(axleBinaryPath);
      const missing = expectedArchitectures(options.arch).filter(
        (architecture) => !architectures.includes(architecture),
      );
      record(
        "Rust axle runtime architecture",
        missing.length === 0,
        `lipo -archs: ${architectures.join(" ") || "unknown"}`,
      );
    } else {
      record("Rust axle runtime architecture", false, "missing Contents/Resources/axle/axle");
    }

    const symlinks = await inspectSymlinks(NodePath.join(resourcesPath, "axle"));
    record(
      "Bundled resource symlinks",
      symlinks.dangling.length === 0 && symlinks.absolute.length === 0,
      [
        symlinks.dangling.length > 0 ? `dangling: ${symlinks.dangling.join(", ")}` : undefined,
        symlinks.absolute.length > 0 ? `absolute: ${symlinks.absolute.join(", ")}` : undefined,
      ]
        .filter((detail): detail is string => detail !== undefined)
        .join("; ") || "no dangling or absolute symlinks",
    );

    if (options.allowUnsigned) {
      record("Code signature", true, "skipped (--allow-unsigned)", true);
      record("Hardened runtime", true, "skipped (--allow-unsigned)", true);
      record("Gatekeeper assessment", true, "skipped (--allow-unsigned)", true);
      record("Notarization ticket", true, "skipped (--allow-unsigned)", true);
    } else {
      const verify = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
      record(
        "Code signature",
        verify.status === 0,
        verify.status === 0
          ? "codesign --verify --deep --strict passed"
          : (verify.stderr || verify.stdout).trim(),
      );

      const signature = run("codesign", ["-dv", "--verbose=4", appPath]);
      const signatureText = `${signature.stdout}\n${signature.stderr}`;
      const authorities = [...signatureText.matchAll(/^Authority=(.+)$/gmu)].flatMap((match) => {
        const authority = match[1]?.trim();
        return authority === undefined ? [] : [authority];
      });
      const team = /^TeamIdentifier=(.+)$/mu.exec(signatureText)?.[1]?.trim();
      const flags = /^flags=([^\n]+)$/mu.exec(signatureText)?.[1] ?? "";
      const identifier = /^Identifier=(.+)$/mu.exec(signatureText)?.[1]?.trim();
      const isDeveloperId = authorities.some((authority) =>
        authority.startsWith("Developer ID Application"),
      );
      const hardenedRuntime = flags.includes("runtime");
      record(
        "Developer ID signature",
        isDeveloperId && team !== undefined && team !== "not set",
        isDeveloperId
          ? `Authority=${authorities[0]}, TeamIdentifier=${team ?? "missing"}`
          : `Authority=${authorities.join(", ") || "none"}, TeamIdentifier=${team ?? "missing"}`,
      );
      record(
        "Hardened runtime",
        hardenedRuntime,
        `codesign flags: ${flags.trim() || "none"}`,
      );
      record(
        "Signing identifier",
        identifier === options.bundleId,
        `Identifier=${identifier ?? "missing"}`,
      );

      const spctl = run("spctl", ["--assess", "--type", "execute", "-vv", appPath]);
      record(
        "Gatekeeper assessment",
        spctl.status === 0,
        spctl.status === 0 ? (spctl.stderr || spctl.stdout).trim() : (spctl.stderr || spctl.stdout).trim(),
      );

      const staple = run("xcrun", ["stapler", "validate", appPath]);
      record(
        "Notarization ticket",
        staple.status === 0,
        staple.status === 0
          ? (staple.stdout || staple.stderr).trim()
          : (staple.stderr || staple.stdout).trim(),
      );
    }

    if (isDiskImage) {
      const digest = await sha256File(options.input);
      record("DMG SHA-256", true, digest);
    }
  } catch (error) {
    // Keep the checks collected so far (for example "DMG mounts") visible in
    // CI output instead of printing only the exception message.
    record(
      "Validation run",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (mountedAt !== undefined) {
      run("hdiutil", ["detach", mountedAt, "-force"]);
      await NodeFSP.rm(mountedAt, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const failures = checks.filter((check) => !check.ok);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ input: options.input, checks, ok: failures.length === 0 }, null, 2)}\n`);
  } else {
    for (const check of checks) {
      const marker = check.skipped ? "SKIP" : check.ok ? "PASS" : "FAIL";
      process.stdout.write(`${marker} ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write(
      failures.length === 0
        ? `\nmacOS release validation passed for ${options.input}.\n`
        : `\n${failures.length} macOS release check(s) failed for ${options.input}.\n`,
    );
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `macOS release validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
