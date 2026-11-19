import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/**
 * Helpers for staging the llama.cpp runtime that powers Axle Offline.
 *
 * `apps/desktop/resources/axle/llama` is a shared tree that can hold runtimes
 * for several platforms. Every artifact must carry only the runtimes its own
 * platform can execute: a macOS app that references Linux `.so` files is both
 * broken (the files cannot load) and needlessly large.
 */

export type LlamaRuntimePlatform = "mac" | "linux" | "win";
export type LlamaRuntimeArch = "arm64" | "x64" | "universal";

const NATIVE_PLATFORM_DIRECTORY: Record<LlamaRuntimePlatform, string> = {
  mac: "darwin",
  linux: "linux",
  win: "win32",
};

export function resolveLlamaRuntimeArchitectures(
  arch: LlamaRuntimeArch,
): ReadonlyArray<"arm64" | "x64"> {
  return arch === "universal" ? ["arm64", "x64"] : [arch];
}

/**
 * Directory names under `resources/axle/llama` that an artifact for the given
 * target must contain. Windows bundles the native runtime plus the same-arch
 * Linux runtime used by the WSL backend.
 */
export function resolveLlamaRuntimeDirectories(
  platform: LlamaRuntimePlatform,
  arch: LlamaRuntimeArch,
): ReadonlyArray<string> {
  const architectures = resolveLlamaRuntimeArchitectures(arch);
  const native = architectures.map(
    (architecture) => `${NATIVE_PLATFORM_DIRECTORY[platform]}-${architecture}`,
  );
  if (platform === "win") {
    return [...native, ...architectures.map((architecture) => `linux-${architecture}`)];
  }
  return native;
}

export function llamaServerExecutableName(platform: LlamaRuntimePlatform): string {
  return platform === "win" ? "llama-server.exe" : "llama-server";
}

export class MissingLlamaRuntimeError extends Error {
  readonly platform: LlamaRuntimePlatform;
  readonly arch: LlamaRuntimeArch;
  readonly missingDirectories: ReadonlyArray<string>;
  readonly missingExecutables: ReadonlyArray<string>;

  constructor(input: {
    readonly platform: LlamaRuntimePlatform;
    readonly arch: LlamaRuntimeArch;
    readonly missingDirectories: ReadonlyArray<string>;
    readonly missingExecutables: ReadonlyArray<string>;
  }) {
    super(
      [
        `Axle Offline runtime is missing for ${input.platform}/${input.arch}.`,
        input.missingDirectories.length > 0
          ? `Missing runtime directories: ${input.missingDirectories.join(", ")}.`
          : undefined,
        input.missingExecutables.length > 0
          ? `Missing server binaries: ${input.missingExecutables.join(", ")}.`
          : undefined,
        `Run \`pnpm local-runtime:install --platform ${input.platform} --arch ${input.arch}\` before packaging,`,
        "or pass --allow-missing-llama-runtime for a preview build that does not ship offline models.",
      ]
        .filter((line): line is string => line !== undefined)
        .join(" "),
    );
    this.name = "MissingLlamaRuntimeError";
    this.platform = input.platform;
    this.arch = input.arch;
    this.missingDirectories = input.missingDirectories;
    this.missingExecutables = input.missingExecutables;
  }
}

export interface LlamaRuntimePruneResult {
  readonly kept: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/**
 * Removes runtimes for other platforms/architectures from the staged resource
 * tree and fails when the target runtime is absent. This keeps a macOS build
 * from shipping Windows/Linux binaries, and prevents a release from going out
 * without a runtime at all.
 */
export async function pruneLlamaRuntimes(input: {
  readonly llamaRoot: string;
  readonly platform: LlamaRuntimePlatform;
  readonly arch: LlamaRuntimeArch;
  readonly requireRuntime: boolean;
}): Promise<LlamaRuntimePruneResult> {
  const requiredDirectories = resolveLlamaRuntimeDirectories(input.platform, input.arch);
  const executableName = llamaServerExecutableName(input.platform);

  const entries = await NodeFSP.readdir(input.llamaRoot, { withFileTypes: true }).catch(
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return [];
      throw cause;
    },
  );
  const presentDirectories = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  if (input.requireRuntime) {
    const missingDirectories = requiredDirectories.filter(
      (directory) => !presentDirectories.has(directory),
    );
    const missingExecutables: string[] = [];
    for (const directory of requiredDirectories) {
      if (!presentDirectories.has(directory)) continue;
      const executablePath = NodePath.join(input.llamaRoot, directory, executableName);
      const executableStat = await NodeFSP.stat(executablePath).catch(() => undefined);
      if (!executableStat?.isFile()) {
        missingExecutables.push(executablePath);
      }
    }
    if (missingDirectories.length > 0 || missingExecutables.length > 0) {
      throw new MissingLlamaRuntimeError({
        platform: input.platform,
        arch: input.arch,
        missingDirectories,
        missingExecutables,
      });
    }
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (requiredDirectories.includes(entry.name)) continue;
    await NodeFSP.rm(NodePath.join(input.llamaRoot, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }

  return {
    kept: requiredDirectories.filter((directory) => presentDirectories.has(directory)),
    removed,
  };
}

export interface SymlinkAudit {
  readonly dangling: ReadonlyArray<string>;
  readonly absolute: ReadonlyArray<string>;
}

/**
 * Walks a staged bundle and reports symlinks that point at nothing (the exact
 * failure mode that produced `/Users/runner/...` links in Axle 1.1.53) or that
 * point outside the bundle using an absolute path.
 */
export async function auditBundleSymlinks(root: string): Promise<SymlinkAudit> {
  const dangling: string[] = [];
  const absolute: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = NodePath.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await NodeFSP.readlink(entryPath);
        if (NodePath.isAbsolute(target)) {
          absolute.push(entryPath);
        }
        const resolvedTarget = NodePath.isAbsolute(target)
          ? target
          : NodePath.resolve(directory, target);
        const targetStat = await NodeFSP.stat(resolvedTarget).catch(() => undefined);
        if (targetStat === undefined) {
          dangling.push(entryPath);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
      }
    }
  };

  await walk(root);
  return { dangling, absolute };
}

/**
 * Copies the staged resource tree without letting Node rewrite relative
 * symlinks into absolute paths. Node's default `fs.cp` behavior makes a
 * relative link absolute, which breaks every bundled Linux library once the
 * build directory disappears.
 */
export async function copyStagedResources(input: {
  readonly source: string;
  readonly destination: string;
  readonly preserveSymlinks: boolean;
}): Promise<void> {
  await NodeFSP.cp(input.source, input.destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: input.preserveSymlinks,
  });
}
