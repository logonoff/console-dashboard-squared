/**
 * junit artifact discovery — mirrors ci-search exactly.
 *
 * Source: openshift/ci-search testgrid/util/gcs/read.go:141
 *
 * The regex matches any object whose last path segment starts with "junit"
 * and ends with ".xml". No path assumptions; no per-job candidate table.
 * A full recursive listing is issued and filtered by regex — the same
 * approach ci-search uses.
 */

import { gcsListAll } from "./gcs";

/**
 * Verbatim port of the ci-search junit filename filter.
 * Key properties verified against real builds:
 *   MATCH  .../junit-playwright.xml
 *   MATCH  .../junit_cypress-<hash>.xml
 *   MATCH  .../junit.xml
 *   MATCH  .../junit_operator.xml
 *   MATCH  .../junit/junit_e2e_analysis__20260909.xml
 *   skip   .../playwright-standard-junit.xml   (basename does not start with "junit")
 *   skip   prowjob_junit.xml                   (no "/" before "junit")
 */
export const JUNIT_RE = /.+\/junit((_[^_]+)?(_\d+-\d+)?(_\d+)?|.+)?\.xml$/;

/**
 * Discover all junit artifact paths for a build by performing a full
 * recursive listing of its object prefix and applying JUNIT_RE.
 *
 * Returns relative paths (with the runPrefix stripped), sorted for
 * deterministic output.
 */
export async function discoverJunitPaths(runPrefix: string): Promise<string[]> {
  const pfx = runPrefix.endsWith("/") ? runPrefix : `${runPrefix}/`;
  const matches: string[] = [];
  for await (const name of gcsListAll(pfx)) {
    if (JUNIT_RE.test(name)) {
      // Store relative path (strip the run prefix)
      matches.push(name.slice(pfx.length));
    }
  }
  return matches.sort();
}

/**
 * Returns true if the suite is ci-operator step-graph noise rather than
 * real test results. Detected by content: single suite named "step graph"
 * whose test cases are ci-operator steps.
 */
export function isCiOperatorJunit(suiteName: string): boolean {
  return suiteName === "step graph";
}
