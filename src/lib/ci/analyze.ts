/**
 * Analyze a single build: discover junit paths, download and parse them,
 * return a RunResult. Immutable results are cached by build ID.
 */

import { discoverJunitPaths } from "./artifacts";
import { gcsGetText } from "./gcs";
import { parseJunit } from "./junit";
import type { Build, RunResult, SuiteResult } from "./types";

export async function analyzeBuild(build: Build): Promise<RunResult> {
  const base: Pick<RunResult, "buildId" | "startedIso" | "prowResult"> = {
    buildId: build.id,
    startedIso: build.startedIso,
    prowResult: build.result,
  };

  // Exclude non-terminal builds from analysis
  if (
    build.result === "PENDING" ||
    build.result === "ABORTED" ||
    build.result === "ERROR"
  ) {
    return { ...base, status: "excluded", sourcePaths: [], suites: [] };
  }

  let paths: string[];
  try {
    paths = await discoverJunitPaths(build.objectPrefix);
  } catch (err) {
    return {
      ...base,
      status: "error",
      sourcePaths: [],
      suites: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (paths.length === 0) {
    return { ...base, status: "no-artifact", sourcePaths: [], suites: [] };
  }

  const pfx = build.objectPrefix.endsWith("/")
    ? build.objectPrefix
    : `${build.objectPrefix}/`;

  // Download and parse all matching files concurrently
  const results = await Promise.allSettled(
    paths.map(async (rel) => {
      const xml = await gcsGetText(`${pfx}${rel}`);
      if (!xml) return { rel, suites: [] as SuiteResult[] };
      const { suites } = parseJunit(xml);
      return { rel, suites };
    }),
  );

  // Merge suites across files, keyed by (objectPath, suiteName)
  const allSuites: SuiteResult[] = [];
  const sourcePaths: string[] = [];
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === "rejected") {
      errors.push(String(r.reason));
    } else {
      sourcePaths.push(r.value.rel);
      allSuites.push(...r.value.suites);
    }
  }

  if (allSuites.length === 0 && errors.length > 0) {
    return {
      ...base,
      status: "error",
      sourcePaths,
      suites: [],
      error: errors.join("; "),
    };
  }

  return {
    ...base,
    status: "analyzed",
    sourcePaths,
    suites: allSuites,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}
