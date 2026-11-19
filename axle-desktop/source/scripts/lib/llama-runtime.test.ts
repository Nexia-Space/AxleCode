import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditBundleSymlinks,
  copyStagedResources,
  MissingLlamaRuntimeError,
  pruneLlamaRuntimes,
  resolveLlamaRuntimeDirectories,
} from "./llama-runtime.ts";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "axle-llama-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveLlamaRuntimeDirectories", () => {
  it("keeps only the native macOS runtime", () => {
    expect(resolveLlamaRuntimeDirectories("mac", "arm64")).toEqual(["darwin-arm64"]);
    expect(resolveLlamaRuntimeDirectories("mac", "x64")).toEqual(["darwin-x64"]);
    expect(resolveLlamaRuntimeDirectories("mac", "universal")).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
  });

  it("keeps the Linux runtime only for Linux builds", () => {
    expect(resolveLlamaRuntimeDirectories("linux", "x64")).toEqual(["linux-x64"]);
    expect(resolveLlamaRuntimeDirectories("linux", "arm64")).toEqual(["linux-arm64"]);
  });

  it("keeps the native Windows runtime plus the WSL Linux runtime", () => {
    expect(resolveLlamaRuntimeDirectories("win", "x64")).toEqual(["win32-x64", "linux-x64"]);
    expect(resolveLlamaRuntimeDirectories("win", "arm64")).toEqual(["win32-arm64", "linux-arm64"]);
  });
});

describe("pruneLlamaRuntimes", () => {
  it("removes foreign runtimes and keeps the target runtime", async () => {
    const root = await makeTemporaryDirectory();
    for (const directory of ["darwin-arm64", "linux-x64", "win32-x64"]) {
      await NodeFSP.mkdir(NodePath.join(root, directory), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(root, directory, "llama-server"), "");
    }

    const result = await pruneLlamaRuntimes({
      llamaRoot: root,
      platform: "mac",
      arch: "arm64",
      requireRuntime: true,
    });

    expect(result.kept).toEqual(["darwin-arm64"]);
    expect([...result.removed].sort()).toEqual(["linux-x64", "win32-x64"]);
    expect(await NodeFSP.readdir(root)).toEqual(["darwin-arm64"]);
  });

  it("fails with an actionable message when the target runtime is missing", async () => {
    const root = await makeTemporaryDirectory();
    await NodeFSP.mkdir(NodePath.join(root, "linux-x64"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, "linux-x64", "llama-server"), "");

    await expect(
      pruneLlamaRuntimes({
        llamaRoot: root,
        platform: "mac",
        arch: "arm64",
        requireRuntime: true,
      }),
    ).rejects.toThrow(MissingLlamaRuntimeError);

    await expect(
      pruneLlamaRuntimes({
        llamaRoot: root,
        platform: "mac",
        arch: "arm64",
        requireRuntime: true,
      }),
    ).rejects.toThrow("pnpm local-runtime:install --platform mac --arch arm64");
  });

  it("allows a preview build to omit the runtime explicitly", async () => {
    const root = await makeTemporaryDirectory();
    await NodeFSP.mkdir(NodePath.join(root, "win32-x64"), { recursive: true });

    const result = await pruneLlamaRuntimes({
      llamaRoot: root,
      platform: "mac",
      arch: "arm64",
      requireRuntime: false,
    });

    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual(["win32-x64"]);
  });
});

describe("auditBundleSymlinks", () => {
  it("reports dangling and absolute links", async () => {
    const root = await makeTemporaryDirectory();
    const absoluteTarget = NodePath.join(root, "absolute-target.dylib");
    await NodeFSP.writeFile(NodePath.join(root, "real.so"), "binary");
    await NodeFSP.writeFile(absoluteTarget, "binary");
    await NodeFSP.symlink("real.so", NodePath.join(root, "relative.so"));
    await NodeFSP.symlink("missing.so", NodePath.join(root, "dangling.so"));
    await NodeFSP.symlink(absoluteTarget, NodePath.join(root, "absolute.so"));

    const audit = await auditBundleSymlinks(root);

    expect(audit.dangling).toEqual([NodePath.join(root, "dangling.so")]);
    expect(audit.absolute).toEqual([NodePath.join(root, "absolute.so")]);
  });
});

describe("copyStagedResources", () => {
  it("preserves relative symlinks instead of rewriting them to absolute paths", async () => {
    const source = await makeTemporaryDirectory();
    const destination = await makeTemporaryDirectory();
    await NodeFSP.mkdir(NodePath.join(source, "lib"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(source, "lib", "libggml.so.0.0.0"), "binary");
    await NodeFSP.symlink("libggml.so.0.0.0", NodePath.join(source, "lib", "libggml.so"));

    await copyStagedResources({ source, destination, preserveSymlinks: true });

    expect(
      await NodeFSP.readlink(NodePath.join(destination, "lib", "libggml.so")),
    ).toBe("libggml.so.0.0.0");
  });
});
