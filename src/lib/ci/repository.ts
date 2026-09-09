/**
 * Repository configuration.
 *
 * All prow/GCS/GitHub/JIRA strings that vary per repo are derived here from
 * a single { name, repo, component } descriptor. Add new repos to the
 * REPOSITORIES registry and select with CI_REPO=owner/repo at deploy time.
 */
import type { JIRA } from "@/lib/jira/constants";

export interface Repository {
  /** Human-readable display name. @example "OpenShift Console" */
  name: string;
  /** GitHub org/repo slug. @example "openshift/console" */
  repo: string;
  /**
   * Key into JIRA.components for the default bug component.
   * @example "managementConsole"
   */
  component: keyof typeof JIRA.components;
}

export const REPOSITORIES: Record<string, Repository> = {
  "openshift/console": {
    name: "OpenShift Console",
    repo: "openshift/console",
    component: "managementConsole",
  },
  "openshift/console-operator": {
    name: "Console Operator",
    repo: "openshift/console-operator",
    component: "managementConsole",
  },
  // Add more repos here, e.g.:
  // "openshift/installer": {
  //   name: "OpenShift Installer",
  //   repo: "openshift/installer",
  //   component: "installer",   // add matching entry to JIRA.components
  // },
};

/**
 * Look up a repository by its slug (e.g. "openshift/console").
 * Returns null if the slug is not in REPOSITORIES.
 */
export function parseRepoParam(slug: string | null): Repository | null {
  if (!slug) return null;
  return REPOSITORIES[slug] ?? null;
}

// ---------------------------------------------------------------------------
// Derived helpers — pure functions, safe to call on client with a repo prop
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "openshift" from "openshift/console" */
export function repoOwner(r: Repository): string {
  return r.repo.split("/")[0];
}

/** "console" from "openshift/console" */
export function repoSlug(r: Repository): string {
  return r.repo.split("/")[1];
}

/** Prow job name prefix. @example "pull-ci-openshift-console-" */
export function jobPrefix(r: Repository): string {
  return `pull-ci-${repoOwner(r)}-${repoSlug(r)}-`;
}

/** GCS org_repo string (slash → underscore). @example "openshift_console" */
export function gcsOrgRepo(r: Repository): string {
  return r.repo.replace("/", "_");
}

/** GCS catalog directory prefix for job discovery. */
export function catalogPrefix(r: Repository): string {
  return `pr-logs/directory/${jobPrefix(r)}`;
}

/** Regex matching a valid full prow job name for this repo. */
export function jobNameRE(r: Repository): RegExp {
  return new RegExp(`^${escapeRe(jobPrefix(r))}[a-z0-9.-]+-[a-z0-9-]+$`);
}

/** Regex matching a valid GCS object prefix path for this repo. */
export function objectPrefixRE(r: Repository): RegExp {
  const org = escapeRe(gcsOrgRepo(r));
  return new RegExp(
    `^pr-logs\\/pull\\/${org}\\/\\d+\\/[a-z0-9.-]+-[a-z0-9-]+\\/\\d+\\/$`,
  );
}

/**
 * Regex matching the job-name prefix + branch segment.
 * Used in catalog parsing and branch extraction from a full job name.
 */
export function branchJobRE(r: Repository): RegExp {
  return new RegExp(
    `^${escapeRe(jobPrefix(r))}(main|release-\\d+\\.\\d+)-(.+)$`,
  );
}

/**
 * Extract the branch name from a full prow job name.
 * Returns null if the job name doesn't match this repo's prefix.
 */
export function branchFromJobName(
  r: Repository,
  jobName: string,
): string | null {
  return branchJobRE(r).exec(jobName)?.[1] ?? null;
}

/** GitHub PR URL. */
export function prUrl(r: Repository, prNumber: number): string {
  return `https://github.com/${r.repo}/pull/${prNumber}`;
}

/**
 * dptools / prow job name regex pattern for aggregate mode.
 * Matches all branches' versions of a given job suffix.
 * @example "pull-ci-openshift-console-.*-e2e-gcp-console"
 */
export function aggregateJobPattern(r: Repository, suffix: string): string {
  return `${jobPrefix(r)}.*-${suffix}`;
}
