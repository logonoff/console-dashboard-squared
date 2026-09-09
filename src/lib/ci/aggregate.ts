/**
 * Aggregate RunResult[] into SuiteStat[] and the full Analysis object.
 *
 * Denominator rules (see plan for rationale):
 *   - Only SUCCESS / FAILURE builds are eligible.
 *   - Of those, only status === "analyzed" runs contribute to any denominator.
 *   - A suite's denominator (appearedIn) counts runs where the suite appeared
 *     AND ran (>=1 non-skipped case).
 *   - failedIn = runs where >=1 case had final outcome "fail"
 *   - flakedIn = runs with no hard failure but >=1 flaked case
 *   - failedIn and flakedIn are mutually exclusive; unhealthyRate <= 1.
 */

import type {
  Analysis,
  Build,
  BuildId,
  CellState,
  FailureMessageBucket,
  JobRef,
  RunResult,
  SuiteStat,
  TopCase,
} from "./types";

const TOP_CASES = 5;
const TOP_MESSAGES_PER_CASE = 3;
const SAMPLE_FAILING_RUNS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellState(run: RunResult, suiteName: string): CellState {
  if (
    run.status === "excluded" ||
    run.status === "no-artifact" ||
    run.status === "error"
  ) {
    return "nodata";
  }
  const suite = run.suites.find((s) => s.name === suiteName);
  if (!suite) return "absent";
  if (!suite.ran) return "skip";
  if (suite.counts.failed > 0) return "fail";
  if (suite.counts.flaked > 0) return "flake";
  return "pass";
}

function topMessages(messages: string[]): FailureMessageBucket[] {
  const freq = new Map<string, number>();
  for (const m of messages) {
    // Normalise line endings and collapse multi-spaces for bucketing
    const key = m.replace(/\s+/g, " ").trim();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MESSAGES_PER_CASE)
    .map(([message, count]) => ({ message, type: null, count }));
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export function aggregate(
  job: JobRef,
  builds: Build[],
  runs: RunResult[],
  windowDays: number,
): Analysis {
  const now = new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const windowStartIso = new Date(cutoffMs).toISOString();
  const windowEndIso = now.toISOString();

  // Indexed by buildId for O(1) lookup
  const runByBuildId = new Map<BuildId, RunResult>(
    runs.map((r) => [r.buildId, r]),
  );

  // Count categories
  let analyzed = 0;
  let noArtifact = 0;
  let excluded = 0;
  let errored = 0;
  for (const r of runs) {
    if (r.status === "analyzed") analyzed++;
    else if (r.status === "no-artifact") noArtifact++;
    else if (r.status === "excluded") excluded++;
    else if (r.status === "error") errored++;
  }

  // Collect all suite names that appear in at least one analyzed run
  const analyzedRuns = runs.filter((r) => r.status === "analyzed");
  const suiteNames = new Set<string>();
  for (const r of analyzedRuns) {
    for (const s of r.suites) suiteNames.add(s.name);
  }

  const suiteStats: SuiteStat[] = [];

  for (const suiteName of suiteNames) {
    let appearedIn = 0;
    let failedIn = 0;
    let flakedIn = 0;
    const cells: Record<BuildId, CellState> = {};
    const failingBuildIds: BuildId[] = [];
    // For topCases: map from case name → array of failure messages
    const caseFailures = new Map<
      string,
      { failedIn: number; messages: string[] }
    >();

    // Derive searchTerm (file attr if present, else name)
    let searchTerm = suiteName;

    for (const build of builds) {
      const run = runByBuildId.get(build.id);
      if (!run) {
        cells[build.id] = "nodata";
        continue;
      }
      cells[build.id] = cellState(run, suiteName);

      if (run.status !== "analyzed") continue;
      const suite = run.suites.find((s) => s.name === suiteName);
      if (!suite) continue;

      // Grab searchTerm from first suite with a file attr
      if (searchTerm === suiteName && suite.file) {
        searchTerm = suite.file;
      }

      if (!suite.ran) continue; // entirely skipped — excluded from denominator
      appearedIn++;

      const hasHardFail = suite.counts.failed > 0;
      const hasFlake = suite.counts.flaked > 0;

      if (hasHardFail) {
        failedIn++;
        if (failingBuildIds.length < SAMPLE_FAILING_RUNS) {
          failingBuildIds.push(build.id);
        }
        // Accumulate per-case failure messages
        for (const c of suite.cases) {
          if (c.outcome === "fail") {
            if (!caseFailures.has(c.name)) {
              caseFailures.set(c.name, { failedIn: 0, messages: [] });
            }
            const entry = caseFailures.get(c.name);
            if (!entry) continue;
            entry.failedIn++;
            if (c.failureMessage) entry.messages.push(c.failureMessage);
          }
        }
      } else if (hasFlake) {
        flakedIn++;
      }
    }

    if (appearedIn === 0) continue; // never ran in any build

    const failureRate = failedIn / appearedIn;
    const flakeRate = flakedIn / appearedIn;
    const unhealthyRate = (failedIn + flakedIn) / appearedIn;
    const impact = failedIn + flakedIn;

    // Build topCases sorted by failedIn desc
    const topCases: TopCase[] = [...caseFailures.entries()]
      .sort((a, b) => b[1].failedIn - a[1].failedIn)
      .slice(0, TOP_CASES)
      .map(([name, data]) => ({
        name,
        failedIn: data.failedIn,
        messages: topMessages(data.messages),
      }));

    const origin =
      analyzedRuns.flatMap((r) => r.suites).find((s) => s.name === suiteName)
        ?.origin ?? "test";

    suiteStats.push({
      name: suiteName,
      searchTerm,
      origin,
      appearedIn,
      failedIn,
      flakedIn,
      failureRate,
      flakeRate,
      unhealthyRate,
      impact,
      topCases,
      failingBuildIds,
      cells,
    });
  }

  // Default sort: impact desc, unhealthyRate desc
  suiteStats.sort(
    (a, b) => b.impact - a.impact || b.unhealthyRate - a.unhealthyRate,
  );

  return {
    job,
    windowDays,
    windowStartIso,
    windowEndIso,
    builds,
    runs,
    suites: suiteStats,
    counts: { total: runs.length, analyzed, noArtifact, excluded, errored },
    generatedAtIso: now.toISOString(),
  };
}
