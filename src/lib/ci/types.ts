/**
 * Core domain types for the CI Watcher dashboard.
 *
 * Build IDs are 19-digit Snowflake-like values that exceed Number.MAX_SAFE_INTEGER.
 * They are always kept as strings; BigInt is used only for numeric comparisons
 * in pagination logic.
 */

export type BuildId = string;
export type ProwResult =
  | "SUCCESS"
  | "FAILURE"
  | "PENDING"
  | "ABORTED"
  | "ERROR";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface JobRef {
  /** e.g. "release-5.0" | "main" */
  branch: string;
  /** e.g. "e2e-gcp-console" */
  suffix: string;
  /** full prow job name, e.g. "pull-ci-openshift-console-release-5.0-e2e-gcp-console" */
  name: string;
  /** ISO timestamp of the most recent run seen in the directory listing */
  lastRunIso: string | null;
}

export interface BranchEntry {
  id: string; // "release-5.0" | "main"
  jobs: JobRef[];
}

// ---------------------------------------------------------------------------
// Builds (prow job-history)
// ---------------------------------------------------------------------------

export interface Build {
  id: BuildId;
  jobName: string;
  result: ProwResult;
  startedIso: string;
  startedMs: number;
  durationMs: number;
  prNumber: number | null;
  prTitle: string | null;
  prAuthor: string | null;
  baseRef: string;
  /**
   * GCS object prefix for this run, without leading slash.
   * e.g. "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-release-5.0-e2e-gcp-console/2097545731324776448/"
   */
  objectPrefix: string;
  spyglassUrl: string;
}

// ---------------------------------------------------------------------------
// junit parsing
// ---------------------------------------------------------------------------

export type CaseOutcome = "pass" | "fail" | "skip";

export interface CaseResult {
  name: string;
  classname: string | null;
  /** Final outcome after retry dedup (last attempt wins) */
  outcome: CaseOutcome;
  /** Number of <testcase> elements for this (suite, name) group */
  attempts: number;
  /**
   * True when attempts > 1 AND final outcome is "pass" AND at least one
   * earlier attempt failed. Indicates a Playwright retry.
   */
  flaked: boolean;
  failureType: string | null;
  /** Trimmed, ANSI-stripped, newlines-collapsed, truncated to 300 chars */
  failureMessage: string | null;
  timeSec: number;
}

/** "test" = real test suites; "ci-operator" = ci-operator step graph noise */
export type SuiteOrigin = "test" | "ci-operator";

export interface SuiteResult {
  /**
   * <testsuite name="…"> — spec path for playwright, package for Go,
   * describe block for jest/mocha.
   */
  name: string;
  /** file attr from Root Suite when present (Mocha/Cypress) */
  file: string | null;
  origin: SuiteOrigin;
  cases: CaseResult[];
  counts: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaked: number;
  };
  /**
   * True when >=1 non-skipped case exists.
   * Used as the denominator gate — all-skipped suites are excluded.
   */
  ran: boolean;
}

// ---------------------------------------------------------------------------
// Run results
// ---------------------------------------------------------------------------

export type RunStatus =
  | "analyzed" // suites present and parsed
  | "no-artifact" // build completed but no junit found
  | "excluded" // PENDING / ABORTED / ERROR — not fetched at all
  | "error"; // fetch or parse error

export interface RunResult {
  buildId: BuildId;
  startedIso: string;
  prowResult: ProwResult;
  status: RunStatus;
  /** Relative GCS paths of the junit files actually parsed */
  sourcePaths: string[];
  suites: SuiteResult[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Heatmap cell
// ---------------------------------------------------------------------------

export type CellState =
  | "fail" // >=1 hard test failure (final outcome)
  | "flake" // no hard failure, but >=1 flaked case
  | "pass" // all cases passed
  | "skip" // suite present, entirely skipped
  | "absent" // suite not in this run's junit
  | "nodata"; // run excluded (PENDING / ABORTED / ERROR / no-artifact)

// ---------------------------------------------------------------------------
// Aggregated statistics
// ---------------------------------------------------------------------------

export interface FailureMessageBucket {
  message: string;
  type: string | null;
  count: number;
}

export interface TopCase {
  name: string;
  failedIn: number;
  messages: FailureMessageBucket[];
}

export interface SuiteStat {
  name: string;
  /**
   * Used for dptools `search` param. For playwright it equals `name`
   * (the spec path). For mocha/cypress it's the `file` attr when present.
   */
  searchTerm: string;
  origin: SuiteOrigin;
  /** Runs where the suite appeared AND ran (denominator) */
  appearedIn: number;
  /** Runs counted above where >=1 case had final outcome "fail" */
  failedIn: number;
  /** Runs counted above with no hard failure but >=1 flaked case */
  flakedIn: number;
  /** failedIn / appearedIn */
  failureRate: number;
  /** flakedIn / appearedIn */
  flakeRate: number;
  /** (failedIn + flakedIn) / appearedIn — the default displayed metric */
  unhealthyRate: number;
  /** failedIn + flakedIn — used for default sort */
  impact: number;
  topCases: TopCase[];
  /** Newest-first build IDs where the suite was hard-failed */
  failingBuildIds: BuildId[];
  /**
   * Distinct PR numbers where the suite had ≥1 unhealthy run (failed or flaked).
   * A high count relative to totalPRs indicates a flake; a low count (1-2)
   * suggests the failure tracks a specific PR's change.
   */
  distinctPRs: number;
  /**
   * Distinct PR numbers where the suite ran at all (denominator for distinctPRs).
   * Only counts builds with a non-null prNumber.
   */
  totalPRs: number;
  cells: Record<BuildId, CellState>;
}

// ---------------------------------------------------------------------------
// Full analysis
// ---------------------------------------------------------------------------

export interface Analysis {
  job: JobRef;
  windowDays: number;
  windowStartIso: string;
  windowEndIso: string;
  /** Newest → oldest — defines the column order in the matrix */
  builds: Build[];
  runs: RunResult[];
  suites: SuiteStat[];
  counts: {
    total: number;
    analyzed: number;
    noArtifact: number;
    excluded: number;
    errored: number;
  };
  generatedAtIso: string;
}

// ---------------------------------------------------------------------------
// Dev-version resolution
// ---------------------------------------------------------------------------

export type DevVersionVia = "sha" | "compare" | "override" | "unavailable";

export interface DevVersionResult {
  /** Numeric version string, e.g. "5.1" */
  version: string;
  /** Jira version name, e.g. "5.1.0" */
  jiraVersion: string;
  /** e.g. "release-5.1" */
  sourceBranch: string;
  resolvedVia: DevVersionVia;
}
