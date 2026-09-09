/**
 * Branch and job discovery from the GCS directory listing.
 *
 * One GCS call enumerates all pr-logs/directory/ prefixes for openshift/console,
 * yielding both the branch set and every job suffix for every branch.
 *
 * This is entirely dynamic — no hardcoded job names or branch lists.
 */

import { gcsListPage } from "./gcs";
import type { BranchEntry, JobRef } from "./types";

const JOB_PREFIX = "pull-ci-openshift-console-";
const DIR_PREFIX = `pr-logs/directory/${JOB_PREFIX}`;
// Matches: pull-ci-openshift-console-<branch>-<suffix>/
const BRANCH_JOB_RE =
  /^pull-ci-openshift-console-(main|release-\d+\.\d+)-(.+)$/;

function parseSemver(branch: string): [number, number] {
  const m = branch.match(/^release-(\d+)\.(\d+)$/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return [Infinity, Infinity]; // "main" sorts last → placed first after reverse
}

export async function fetchCatalog(): Promise<BranchEntry[]> {
  // Single GCS list call — no pagination needed at this prefix in practice
  let pageToken: string | undefined;
  const branchMap = new Map<string, Map<string, JobRef>>();

  do {
    const page = await gcsListPage({
      prefix: DIR_PREFIX,
      delimiter: "/",
      pageToken,
      fields: "prefixes,nextPageToken",
    });

    for (const pfx of page.prefixes) {
      // pfx looks like "pr-logs/directory/pull-ci-openshift-console-release-5.0-e2e-gcp-console/"
      const segment = pfx.replace(/\/$/, "").split("/").pop() ?? "";
      const m = segment.match(BRANCH_JOB_RE);
      if (!m) continue;
      const [, branch, suffix] = m;
      if (!branchMap.has(branch)) branchMap.set(branch, new Map());
      const jobName = `${JOB_PREFIX}${branch}-${suffix}`;
      branchMap.get(branch)?.set(suffix, {
        branch,
        suffix,
        name: jobName,
        lastRunIso: null, // populated later by the /api/jobs route
      });
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  // Sort branches: main first, then release branches descending by semver
  const sorted = [...branchMap.entries()].sort(([a], [b]) => {
    if (a === "main") return -1;
    if (b === "main") return 1;
    const [aMaj, aMin] = parseSemver(a);
    const [bMaj, bMin] = parseSemver(b);
    return bMaj - aMaj || bMin - aMin;
  });

  return sorted.map(([branch, jobMap]) => ({
    id: branch,
    jobs: [...jobMap.values()],
  }));
}

/**
 * Fetch the most-recent object mtime for a job's directory listing,
 * used to annotate each job picker option with a "last run" date so
 * retired jobs (e.g. e2e-playwright after the rename) are visibly stale.
 */
export async function fetchJobLastRun(jobName: string): Promise<string | null> {
  try {
    const page = await gcsListPage({
      prefix: `pr-logs/directory/${jobName}/`,
      fields: "items(updated),nextPageToken",
      maxResults: 1000,
    });
    // Items are not sorted by updated — find the max
    let latest: string | null = null;
    for (const item of page.items) {
      if (item.updated && (!latest || item.updated > latest)) {
        latest = item.updated;
      }
    }
    return latest;
  } catch {
    return null;
  }
}
