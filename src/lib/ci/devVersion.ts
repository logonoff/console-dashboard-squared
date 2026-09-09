/**
 * Resolve the current in-development OpenShift version by finding the
 * lowest-numbered release branch that tracks `main`.
 *
 * Per the team's convention: the dev version is the lowest release-X.Y branch
 * whose HEAD SHA equals main's HEAD SHA. If none match exactly (e.g. shortly
 * after a branch cut when main has new commits), falls back to a binary search
 * using the GitHub compare API (ahead_by === 0 means the branch is a full
 * ancestor of main).
 *
 * This value is load-bearing: it determines whether a release branch is a
 * z-stream (below dev version → X.Y.z) or a trunk (>= dev version → X.Y.0).
 */

import { getRepository } from "./repository";
import type { DevVersionResult } from "./types";

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "console-dashboard-squared/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function parseSemver(branch: string): [number, number] | null {
  const m = branch.match(/^release-(\d+)\.(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

function semverLt(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/** Return branches in ascending semver order, ignoring non-release-X.Y names */
function sortedReleaseBranches(names: string[]): string[] {
  return names
    .filter((n) => parseSemver(n) !== null)
    .sort((a, b) => {
      const [aMaj, aMin] = parseSemver(a) ?? [0, 0];
      const [bMaj, bMin] = parseSemver(b) ?? [0, 0];
      return aMaj - bMaj || aMin - bMin;
    });
}

async function fetchBranches(): Promise<Array<{ name: string; sha: string }>> {
  const branches: Array<{ name: string; sha: string }> = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(
      `${GITHUB_API}/repos/${getRepository().repo}/branches?per_page=100&page=${page}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), headers: getGitHubHeaders() },
    );
    if (!res.ok) throw new Error(`GitHub branches: HTTP ${res.status}`);
    const data: Array<{ name: string; commit: { sha: string } }> =
      await res.json();
    for (const b of data) branches.push({ name: b.name, sha: b.commit.sha });
    if (data.length < 100) break;
    page++;
  }
  return branches;
}

async function isAncestor(base: string, head: string): Promise<boolean> {
  // ahead_by === 0 means `head` has no commits that `base` doesn't → head tracks base
  const res = await fetch(
    `${GITHUB_API}/repos/${getRepository().repo}/compare/${base}...${head}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS), headers: getGitHubHeaders() },
  );
  if (!res.ok) throw new Error(`GitHub compare: HTTP ${res.status}`);
  const data: { ahead_by: number } = await res.json();
  return data.ahead_by === 0;
}

export async function resolveDevVersion(): Promise<DevVersionResult> {
  const branches = await fetchBranches();
  const mainSha = branches.find((b) => b.name === "main")?.sha;
  if (!mainSha) throw new Error("Could not find main branch on GitHub");

  const releaseBranches = sortedReleaseBranches(branches.map((b) => b.name));
  const shaMap = new Map(branches.map((b) => [b.name, b.sha]));

  // Fast path: find the lowest release branch with the same SHA as main
  for (const branch of releaseBranches) {
    if (shaMap.get(branch) === mainSha) {
      const ver = parseSemver(branch);
      if (!ver) continue;
      return {
        version: `${ver[0]}.${ver[1]}`,
        jiraVersion: `${ver[0]}.${ver[1]}.0`,
        sourceBranch: branch,
        resolvedVia: "sha",
      };
    }
  }

  // Slow path: binary search — divergence is monotonic in branch age
  // Oldest branches are most diverged; newest (highest semver) are closest to main.
  // We want the lowest branch that is an ancestor of main.
  let lo = 0;
  let hi = releaseBranches.length - 1;
  let answer: string | null = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = releaseBranches[mid];
    if (await isAncestor("main", candidate)) {
      answer = candidate;
      hi = mid - 1; // look for a lower one
    } else {
      lo = mid + 1;
    }
  }

  if (!answer) {
    return {
      version: "",
      jiraVersion: "",
      sourceBranch: "",
      resolvedVia: "unavailable",
    };
  }

  const ver = parseSemver(answer);
  if (!ver)
    return {
      version: "",
      jiraVersion: "",
      sourceBranch: "",
      resolvedVia: "unavailable",
    };
  return {
    version: `${ver[0]}.${ver[1]}`,
    jiraVersion: `${ver[0]}.${ver[1]}.0`,
    sourceBranch: answer,
    resolvedVia: "compare",
  };
}

/**
 * Given the resolved dev version, compute the Jira version string for any
 * release branch.
 *
 * release-X.Y where X.Y >= devVersion → "X.Y.0" (trunk / development)
 * release-X.Y where X.Y <  devVersion → "X.Y.z" (z-stream)
 * main                                → devVersion + ".0"
 */
export function branchToJiraVersion(
  branch: string,
  devVersion: DevVersionResult,
): string | null {
  if (devVersion.resolvedVia === "unavailable") return null;

  if (branch === "main") return devVersion.jiraVersion;

  const ver = parseSemver(branch);
  if (!ver) return null;
  const devVer = parseSemver(devVersion.sourceBranch);
  if (!devVer) return null;

  if (!semverLt(ver, devVer)) {
    // At or above dev version → trunk: X.Y.0
    return `${ver[0]}.${ver[1]}.0`;
  }
  // Below dev version → z-stream: X.Y.z
  return `${ver[0]}.${ver[1]}.z`;
}
