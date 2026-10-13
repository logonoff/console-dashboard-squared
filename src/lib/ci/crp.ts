import { pool } from "./concurrency";
import { parseCrpTimings } from "./crpTimings";
import { gcsGetText, gcsListAll } from "./gcs";
import { objectPrefixRE, REPOSITORIES } from "./repository";
import type { Build, CrpTimingAttempt, CrpTimingResult } from "./types";

export type CrpBuild = Pick<Build, "id" | "result" | "objectPrefix">;

// This test directory is fixed; only the optional Playwright retry suffix varies.
export const CRP_TEST_PREFIX =
  "artifacts/e2e-gcp-console/test/artifacts/playwright-test-results/" +
  "dashboards-cluster-dashboa-8bd1b-mings-across-repeated-loads-console";
const TIMING_PATH_RE = /^(?:-retry([1-9]\d*))?\/crp-blame-timings\.json$/;

/** Accept only prefixes tied to the validated Console job and string build ID. */
export function parseCrpBuild(raw: unknown, job: string): CrpBuild {
  if (!raw || typeof raw !== "object") throw new Error("Invalid build object");
  const { id, result, objectPrefix } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !/^\d{15,25}$/.test(id)) {
    throw new Error("Invalid build ID (must be a string of 15–25 digits)");
  }
  if (
    typeof objectPrefix !== "string" ||
    !objectPrefixRE(REPOSITORIES["openshift/console"]).test(objectPrefix) ||
    objectPrefix.split("/")[4] !== job ||
    objectPrefix.split("/")[5] !== id
  ) {
    throw new Error("Build prefix must match the Console job and build ID");
  }
  if (
    result !== "SUCCESS" &&
    result !== "FAILURE" &&
    result !== "PENDING" &&
    result !== "ABORTED" &&
    result !== "ERROR"
  ) {
    throw new Error("Invalid prow result");
  }
  return { id, result, objectPrefix };
}

export async function fetchCrpTimings(
  build: CrpBuild,
): Promise<CrpTimingResult> {
  const base = { buildId: build.id };
  if (build.result !== "SUCCESS" && build.result !== "FAILURE") {
    return { ...base, status: "excluded", attempts: [] };
  }

  try {
    const prefix = `${build.objectPrefix}${CRP_TEST_PREFIX}`;
    const paths: { path: string; retry: number }[] = [];
    // Narrow listing: no full build scan and no duplicate attachment downloads.
    for await (const path of gcsListAll(prefix)) {
      const match = TIMING_PATH_RE.exec(path.slice(prefix.length));
      if (match) paths.push({ path, retry: Number(match[1] ?? 0) });
    }

    const errors: string[] = [];
    const attempts = await pool(
      paths.map(
        ({ path, retry }) =>
          async (): Promise<CrpTimingAttempt | null> => {
            try {
              const text = await gcsGetText(path);
              if (text === null) throw new Error("Timing artifact disappeared");
              const loads = parseCrpTimings(text);
              if (!loads.some((load) => load.length > 0)) return null;
              return { retry, sourcePath: path, loads };
            } catch (err) {
              errors.push(
                `${path}: ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            }
          },
      ),
      3,
    );
    const available = attempts
      .filter((attempt): attempt is CrpTimingAttempt => attempt !== null)
      .sort((a, b) => a.retry - b.retry);
    return {
      ...base,
      status: available.length
        ? "analyzed"
        : errors.length
          ? "error"
          : "no-artifact",
      attempts: available,
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      attempts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
