/**
 * Prow job-history scraper.
 *
 * Prow job-history pages embed build metadata as:
 *   var allBuilds = [{...}, ...];
 *
 * Each page holds 20 builds. Pagination uses a ?buildId= query param
 * that must be compared as BigInt (values exceed Number.MAX_SAFE_INTEGER).
 */

import type { Build, BuildId, ProwResult } from "./types";

const PROW_BASE = "https://prow.ci.openshift.org";
const USER_AGENT = "console-dashboard-squared/1.0";
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 8;

// ---------------------------------------------------------------------------
// Types matching the embedded JSON shape
// ---------------------------------------------------------------------------

interface ProwBuild {
  SpyglassLink: string;
  ID: string;
  Started: string;
  Duration: number; // nanoseconds as a JS number (loses precision for very large values)
  Result: string;
  Refs?: {
    base_ref?: string;
    pulls?: Array<{
      number?: number;
      author?: string;
      title?: string;
      link?: string;
      sha?: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function extractAllBuilds(html: string): ProwBuild[] {
  const m = html.match(/var\s+allBuilds\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]) as ProwBuild[];
  } catch {
    return [];
  }
}

/**
 * Returns the ?buildId= for the "older runs" link: the page's buildId
 * that is BigInt-less-than the current oldest build's id.
 */
function extractOlderBuildId(html: string, oldestId: BuildId): string | null {
  const matches = [...html.matchAll(/\?buildId=(\d+)/g)].map((m) => m[1]);
  const oldestBig = BigInt(oldestId);
  const smaller = matches
    .map((id) => BigInt(id))
    .filter((id) => id < oldestBig)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)); // descending → pick the highest one < oldest
  return smaller.length > 0 ? String(smaller[0]) : null;
}

function prowToBuild(raw: ProwBuild, jobName: string): Build {
  const pull = raw.Refs?.pulls?.[0];
  // SpyglassLink: "/view/gs/test-platform-results/pr-logs/pull/openshift_console/<pr>/<job>/<id>"
  const objectPrefix = raw.SpyglassLink.replace(
    /^\/view\/gs\/test-platform-results\//,
    "",
  ).replace(/\/?$/, "/");
  return {
    id: raw.ID,
    jobName,
    result: (raw.Result as ProwResult) ?? "ERROR",
    startedIso: raw.Started,
    startedMs: raw.Started ? new Date(raw.Started).getTime() : 0,
    durationMs: Math.floor((raw.Duration ?? 0) / 1_000_000),
    prNumber: pull?.number ?? null,
    prTitle: pull?.title ?? null,
    prAuthor: pull?.author ?? null,
    baseRef: raw.Refs?.base_ref ?? "",
    objectPrefix,
    spyglassUrl: `${PROW_BASE}${raw.SpyglassLink}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all builds for a job within the given time window (inclusive).
 *
 * Iterates prow job-history pages, stopping when the oldest build on a page
 * predates cutoffMs, no older-page link is found, or MAX_PAGES is reached.
 */
export async function fetchBuildsInWindow(opts: {
  jobName: string;
  cutoffMs: number;
}): Promise<{ builds: Build[]; pagesFetched: number; truncated: boolean }> {
  const { jobName, cutoffMs } = opts;
  const baseUrl = `${PROW_BASE}/job-history/gs/test-platform-results/pr-logs/directory/${encodeURIComponent(jobName)}`;

  const builds: Build[] = [];
  let pagesFetched = 0;
  let nextBuildId: string | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = nextBuildId ? `${baseUrl}?buildId=${nextBuildId}` : baseUrl;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Prow job-history ${jobName}: HTTP ${res.status}`);
    }
    const html = await res.text();
    pagesFetched++;

    const rawBuilds = extractAllBuilds(html);
    if (rawBuilds.length === 0) break;

    // Track the oldest id before filtering for pagination
    const oldestId = rawBuilds[rawBuilds.length - 1].ID;

    for (const raw of rawBuilds) {
      const startedMs = raw.Started ? new Date(raw.Started).getTime() : 0;
      if (startedMs >= cutoffMs) {
        builds.push(prowToBuild(raw, jobName));
      }
    }

    // If the oldest build on this page is before the cutoff we're done
    const oldestMs = rawBuilds[rawBuilds.length - 1].Started
      ? new Date(rawBuilds[rawBuilds.length - 1].Started).getTime()
      : 0;

    if (oldestMs < cutoffMs) break;

    nextBuildId = extractOlderBuildId(html, oldestId);
    if (!nextBuildId) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { builds, pagesFetched, truncated };
}
