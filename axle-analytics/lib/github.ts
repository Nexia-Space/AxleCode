/**
 * Download counts come from GitHub, which is the real source of truth: the
 * download worker only redirects to GitHub release assets, so GitHub's
 * per-asset `download_count` is the number of downloads that actually happened.
 *
 * Public API, no auth required. Unauthenticated calls are limited to 60/hour per
 * IP, so responses are cached; set GITHUB_TOKEN to raise the limit.
 */

const REPO = process.env.ANALYTICS_RELEASES_REPO?.trim() || "thatcreativetayo/AxleCode";
const CACHE_SECONDS = 300;

export interface DownloadBreakdown {
  site: "github";
  reachable: boolean;
  error: string | null;
  total: number;
  byPlatform: Array<{ platform: string; downloads: number }>;
  byRelease: Array<{ tag: string; publishedAt: string | null; downloads: number }>;
  latestTag: string | null;
}

interface GitHubAsset {
  name?: unknown;
  download_count?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

/** Only installer payloads count as a download; updater feeds and blockmaps do not. */
function platformForAsset(name: string): string | null {
  if (/^Axle-x64\.exe$/iu.test(name)) return "windows-x64";
  if (/^Axle-(arm64|x64)\.dmg$/iu.test(name)) {
    return /arm64/iu.test(name) ? "macos-arm64" : "macos-x64";
  }
  if (/^Axle-(arm64|x64)\.zip$/iu.test(name)) {
    return /arm64/iu.test(name) ? "macos-arm64" : "macos-x64";
  }
  if (/^Axle-.*\.(AppImage|deb)$/iu.test(name)) return "linux-x64";
  return null;
}

export async function loadDownloadBreakdown(): Promise<DownloadBreakdown> {
  const empty: DownloadBreakdown = {
    site: "github",
    reachable: false,
    error: null,
    total: 0,
    byPlatform: [],
    byRelease: [],
    latestTag: null,
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: CACHE_SECONDS },
    });
  } catch {
    return { ...empty, error: "Could not reach the GitHub API." };
  }

  if (!response.ok) {
    return {
      ...empty,
      error:
        response.status === 403 || response.status === 429
          ? "GitHub rate limit reached. Set GITHUB_TOKEN to raise it."
          : response.status === 404
            ? "GitHub releases are private or GITHUB_TOKEN is missing."
          : `GitHub API responded with ${response.status}.`,
    };
  }

  let releases: unknown;
  try {
    releases = await response.json();
  } catch {
    return { ...empty, error: "GitHub returned an unreadable payload." };
  }
  if (!Array.isArray(releases)) {
    return { ...empty, error: "Unexpected GitHub response shape." };
  }

  const platformTotals = new Map<string, number>();
  const byRelease: DownloadBreakdown["byRelease"] = [];
  let total = 0;
  let latestTag: string | null = null;

  for (const raw of releases as GitHubRelease[]) {
    if (raw.draft === true) continue;
    const tag = typeof raw.tag_name === "string" ? raw.tag_name : null;
    if (tag === null) continue;
    if (latestTag === null) latestTag = tag;

    let releaseTotal = 0;
    const assets = Array.isArray(raw.assets) ? (raw.assets as GitHubAsset[]) : [];
    for (const asset of assets) {
      if (typeof asset.name !== "string") continue;
      const platform = platformForAsset(asset.name);
      if (platform === null) continue;
      const count = typeof asset.download_count === "number" ? asset.download_count : 0;
      platformTotals.set(platform, (platformTotals.get(platform) ?? 0) + count);
      releaseTotal += count;
      total += count;
    }

    byRelease.push({
      tag,
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
      downloads: releaseTotal,
    });
  }

  return {
    site: "github",
    reachable: true,
    error: null,
    total,
    byPlatform: [...platformTotals.entries()]
      .map(([platform, downloads]) => ({ platform, downloads }))
      .sort((a, b) => b.downloads - a.downloads),
    byRelease: byRelease.slice(0, 12),
    latestTag,
  };
}
