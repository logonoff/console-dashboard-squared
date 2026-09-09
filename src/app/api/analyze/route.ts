import { getCache } from "@/lib/cache";
import { hourBucket, keys, TTL } from "@/lib/cache/keys";
import { analyzeBuild } from "@/lib/ci/analyze";
import { fetchCatalog } from "@/lib/ci/catalog";
import { pool } from "@/lib/ci/concurrency";
import type { Build, BuildId, RunResult } from "@/lib/ci/types";

export const maxDuration = 60;

const BATCH_CAP = Number(process.env.CI_ANALYZE_BATCH ?? "8");
const CONCURRENCY = Number(process.env.CI_MAX_CONCURRENCY ?? "6");
const BUILD_ID_RE = /^\d{15,25}$/;
const JOB_NAME_RE = /^pull-ci-openshift-console-[a-z0-9.-]+-[a-z0-9-]+$/;

/** Validate job name is in the catalog (SSRF guard). */
async function validateJob(jobName: string): Promise<boolean> {
  const cache = getCache();
  const branches = await cache.getOrLoad(keys.catalog(), TTL.CATALOG, () =>
    fetchCatalog(),
  );
  return branches.some((b) => b.jobs.some((j) => j.name === jobName));
}

/** Look up objectPrefix for a build from cached runs data. */
async function lookupBuild(
  jobName: string,
  buildId: BuildId,
): Promise<Build | undefined> {
  const cache = getCache();
  const days = 14;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const bucket = hourBucket(cutoffMs);
  const cached = await cache.get<{
    builds: Build[];
    pagesFetched: number;
  }>(keys.runs(jobName, days, bucket));
  if (cached) {
    return cached.builds.find((b: Build) => b.id === buildId);
  }
  return undefined;
}

export async function POST(req: Request) {
  let body: { job?: string; buildIds?: unknown[]; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { job: jobName = "", buildIds = [], force = false } = body;

  // Validate job name structure
  if (!JOB_NAME_RE.test(jobName)) {
    return Response.json({ error: "Invalid job name" }, { status: 400 });
  }
  // Validate batch size
  if (!Array.isArray(buildIds) || buildIds.length > BATCH_CAP) {
    return Response.json(
      { error: `buildIds must be an array of at most ${BATCH_CAP} items` },
      { status: 400 },
    );
  }
  // Validate each build ID
  for (const id of buildIds) {
    if (typeof id !== "string" || !BUILD_ID_RE.test(id)) {
      return Response.json(
        { error: `Invalid buildId: ${String(id)}` },
        { status: 400 },
      );
    }
  }

  // SSRF guard
  if (!(await validateJob(jobName))) {
    return Response.json({ error: `Unknown job: ${jobName}` }, { status: 400 });
  }

  const cache = getCache();

  const tasks = (buildIds as BuildId[]).map(
    (buildId) => async (): Promise<RunResult> => {
      // Return cached result for immutable terminal builds
      if (!force) {
        const cached = await cache.get<RunResult>(keys.runResult(buildId));
        if (cached) return cached;
      }

      // Look up the build's objectPrefix from cached runs
      const build = await lookupBuild(jobName, buildId);
      if (!build) {
        // Synthesise a minimal Build from the job name so we can still try
        const objectPrefix = `pr-logs/pull/openshift_console///${jobName}/${buildId}/`;
        return analyzeBuild({
          id: buildId,
          jobName,
          result: "FAILURE",
          startedIso: "",
          startedMs: 0,
          durationMs: 0,
          prNumber: null,
          prTitle: null,
          prAuthor: null,
          baseRef: "",
          objectPrefix,
          spyglassUrl: `https://prow.ci.openshift.org/view/gs/test-platform-results/${objectPrefix}`,
        });
      }

      const result = await analyzeBuild(build);

      // Cache immutable terminal results
      if (result.prowResult !== "PENDING") {
        await cache.set(keys.runResult(buildId), result, TTL.IMMUTABLE);
      }

      return result;
    },
  );

  try {
    const results = await pool(tasks, CONCURRENCY);
    return Response.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
