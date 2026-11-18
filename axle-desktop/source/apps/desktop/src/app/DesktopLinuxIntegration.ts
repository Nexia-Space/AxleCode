import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-linux-integration");

/**
 * Desktop entry names this app has shipped under. The current name is written;
 * the rest are removed so a rename cannot leave a second launcher entry behind
 * pointing at the same binary.
 */
const LEGACY_ENTRY_BASE_NAMES = ["t3code"] as const;

/**
 * Build the entry from the one the AppImage ships, so fields we do not manage
 * (MimeType, Categories, protocol handlers) stay whatever the build declared.
 */
const renderDesktopEntry = Effect.fn("desktop.linuxIntegration.renderDesktopEntry")(
  function* (input: {
    readonly appDirPath: string;
    readonly appImagePath: string;
    readonly displayName: string;
    readonly wmClass: string;
    readonly iconName: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const bundledEntries = yield* fs.readDirectory(input.appDirPath);
    const bundled = bundledEntries.find((entry) => entry.endsWith(".desktop"));
    const lines = bundled
      ? (yield* fs.readFileString(path.join(input.appDirPath, bundled))).split("\n")
      : ["[Desktop Entry]", "Type=Application", "Terminal=false", "Categories=Development;"];

    const overrides = new Map<string, string>([
      ["Name", input.displayName],
      // AppRun only resolves inside the mounted image; a launcher needs the real
      // path of the AppImage file itself.
      ["Exec", `${input.appImagePath} --no-sandbox %U`],
      ["TryExec", input.appImagePath],
      ["Icon", input.iconName],
      ["StartupWMClass", input.wmClass],
    ]);

    const rendered: string[] = [];
    for (const line of lines) {
      const separator = line.indexOf("=");
      const key = separator > 0 ? line.slice(0, separator) : "";
      const override = overrides.get(key);
      if (override === undefined) {
        rendered.push(line);
        continue;
      }
      rendered.push(`${key}=${override}`);
      overrides.delete(key);
    }

    const headerIndex = rendered.indexOf("[Desktop Entry]");
    const insertAt = headerIndex >= 0 ? headerIndex + 1 : 0;
    rendered.splice(insertAt, 0, ...[...overrides].map(([key, value]) => `${key}=${value}`));

    return `${rendered.join("\n").trimEnd()}\n`;
  },
);

/**
 * Desktop shells read icons through a cache. Writing the PNG is not enough on
 * GTK-based shells, and neither tool exists everywhere, so both are advisory.
 */
const refreshDesktopCaches = Effect.fn("desktop.linuxIntegration.refreshCaches")(function* (input: {
  readonly iconsDir: string;
  readonly applicationsDir: string;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const commands = [
    ChildProcess.make("gtk-update-icon-cache", ["-f", "-t", input.iconsDir]),
    ChildProcess.make("update-desktop-database", [input.applicationsDir]),
  ];
  yield* Effect.forEach(
    commands,
    (command) =>
      spawner.spawn(command).pipe(
        Effect.flatMap((child) => child.exitCode),
        Effect.catchCause(() => Effect.void),
      ),
    { concurrency: 1, discard: true },
  );
});

const refresh = Effect.fn("desktop.linuxIntegration.refresh")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.platform !== "linux" || environment.isDevelopment) return;

  const config = yield* DesktopConfig.DesktopConfig;
  const appImagePath = Option.getOrUndefined(config.appImagePath);
  const appDirPath = Option.getOrUndefined(config.appDirPath);
  // A deb/rpm install has its icons under /usr, owned by the package manager.
  // Only the AppImage has no one keeping its integration current.
  if (!appImagePath || !appDirPath) return;

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const entryBaseName = environment.linuxDesktopEntryName.replace(/\.desktop$/u, "");
  const applicationsDir = path.join(environment.homeDirectory, ".local", "share", "applications");
  const iconsDir = path.join(environment.homeDirectory, ".local", "share", "icons", "hicolor");
  const entryPath = path.join(applicationsDir, environment.linuxDesktopEntryName);
  const legacyEntryPaths = LEGACY_ENTRY_BASE_NAMES.map((name) =>
    path.join(applicationsDir, `${name}.desktop`),
  ).filter((candidate) => candidate !== entryPath);

  const existing = yield* Effect.filter(
    [entryPath, ...legacyEntryPaths],
    (candidate) => fs.exists(candidate),
    { concurrency: "unbounded" },
  );
  // Never integrated, so there is nothing of ours to keep current. Creating a
  // launcher entry for someone who chose to run the AppImage directly is not
  // this function's business.
  if (existing.length === 0) return;

  const sourceIconsDir = path.join(appDirPath, "usr", "share", "icons", "hicolor");
  if (!(yield* fs.exists(sourceIconsDir))) {
    yield* logWarning("AppImage has no bundled icon theme; skipping icon refresh", {
      sourceIconsDir,
    });
    return;
  }

  let updatedIcons = 0;
  for (const sizeDir of yield* fs.readDirectory(sourceIconsDir)) {
    const sourceAppsDir = path.join(sourceIconsDir, sizeDir, "apps");
    if (!(yield* fs.exists(sourceAppsDir))) continue;

    const targetAppsDir = path.join(iconsDir, sizeDir, "apps");
    for (const iconFile of yield* fs.readDirectory(sourceAppsDir)) {
      // Follow the entry we are writing, not the name inside the AppImage, so
      // the icon keeps resolving across a rename.
      const extension = path.extname(iconFile);
      const targetIcon = path.join(targetAppsDir, `${entryBaseName}${extension}`);
      const source = yield* fs.readFile(path.join(sourceAppsDir, iconFile));

      const unchanged =
        (yield* fs.exists(targetIcon)) &&
        Buffer.from(yield* fs.readFile(targetIcon)).equals(Buffer.from(source));
      if (unchanged) continue;

      yield* fs.makeDirectory(targetAppsDir, { recursive: true });
      yield* fs.writeFile(targetIcon, source);
      updatedIcons += 1;

      for (const legacyName of LEGACY_ENTRY_BASE_NAMES) {
        const legacyIcon = path.join(targetAppsDir, `${legacyName}${extension}`);
        if (legacyIcon === targetIcon) continue;
        yield* fs.remove(legacyIcon).pipe(Effect.catchCause(() => Effect.void));
      }
    }
  }

  const desktopEntry = yield* renderDesktopEntry({
    appDirPath,
    appImagePath,
    displayName: environment.displayName,
    wmClass: environment.linuxWmClass,
    iconName: entryBaseName,
  });
  const entryChanged = (yield* fs.exists(entryPath))
    ? (yield* fs.readFileString(entryPath)) !== desktopEntry
    : true;
  if (entryChanged) {
    yield* fs.makeDirectory(applicationsDir, { recursive: true });
    yield* fs.writeFileString(entryPath, desktopEntry);
  }

  for (const legacyPath of legacyEntryPaths) {
    yield* fs.remove(legacyPath).pipe(Effect.catchCause(() => Effect.void));
  }

  if (updatedIcons === 0 && !entryChanged) return;

  yield* logInfo("refreshed Linux desktop integration", {
    entryPath,
    entryChanged,
    updatedIcons,
  });
  yield* refreshDesktopCaches({ iconsDir, applicationsDir });
});

/**
 * Keep an integrated Linux launcher in step with the running AppImage.
 *
 * electron-updater swaps the AppImage file in place and relaunches. Nothing in
 * that path touches `~/.local/share`, so a launcher entry written at install
 * time keeps its original icon through every later update - the icon a user
 * sees can be arbitrarily older than the app they are running.
 *
 * Failures are logged and swallowed: a stale launcher icon must never be the
 * reason the app will not start.
 */
export const refreshLinuxDesktopIntegration = () =>
  refresh().pipe(
    Effect.catchCause((cause) =>
      logWarning("could not refresh Linux desktop integration", { cause: String(cause) }),
    ),
  );
