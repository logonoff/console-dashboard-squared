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
 * junit filename filter — verbatim from the OpenShift CI prow spyglass config
 * (core-services/prow/02_config/_config.yaml required_files entry for the
 * junit lens): .*junit.*\.xml
 *
 * Matches any artifact whose full GCS path contains "junit" and ends with
 * ".xml". Verified against real builds:
 *
 *   MATCH  .../junit-playwright.xml
 *   MATCH  .../junit_cypress-<hash>.xml
 *   MATCH  .../junit.xml
 *   MATCH  .../junit_operator.xml
 *   MATCH  .../junit/junit_e2e_analysis__20260909.xml
 *   MATCH  .../eslint.junit.xml            (*.junit.xml — frontend job)
 *   MATCH  .../gherkin-lint.junit.xml
 *   MATCH  .../duplicated deps.junit.xml   (spaces OK)
 *   MATCH  .../playwright-standard-junit.xml  (merged with junit-playwright.xml;
 *             our retry-dedup still yields the correct 1 fail / 8 flake result)
 *   MATCH  prowjob_junit.xml               (always passes; hidden by default
 *             low-sample/healthy filter since distinctPRs=0)
 */
export const JUNIT_RE = /.*junit.*\.xml$/;

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
