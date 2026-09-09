import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { analyzeBuild } from "@/lib/ci/analyze";
import { fetchCatalog } from "@/lib/ci/catalog";
import { pool } from "@/lib/ci/concurrency";
import type { Build, BuildId, RunResult } from "@/lib/ci/types";

export const maxDuration = 60;

const BATCH_CAP = Number(process.env.CI_ANALYZE_BATCH ?? "8");
const CONCURRENCY = Number(process.env.CI_MAX_CONCURRENCY ?? "6");
const BUILD_ID_RE = /^\d{15,25}$/;
const JOB_NAME_RE = /^pull-ci-openshift-console-[a-z0-9.-]+-[a-z0-9-]+$/;
// GCS path must start with pr-logs/pull/ and contain no path traversal.
const OBJECT_PREFIX_RE =
  /^pr-logs\/pull\/openshift_console\/\d+\/[a-z0-9-]+\/\d+\/$/;

/** Validate job name is in the catalog (SSRF guard). */
async function validateJob(jobName: string): Promise<boolean> {
  const cache = getCache();
  const branches = await cache.getOrLoad(keys.catalog(), TTL.CATALOG, () =>
    fetchCatalog(),
  );
  return branches.some((b) => b.jobs.some((j) => j.name === jobName));
}

export async function POST(req: Request) {
  let body: {
    job?: string;
    builds?: unknown[];
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { job: jobName = "", builds = [], force = false } = body;

  // Validate job name structure
  if (!JOB_NAME_RE.test(jobName)) {
    return Response.json({ error: "Invalid job name" }, { status: 400 });
  }
  // Validate batch size
  if (!Array.isArray(builds) || builds.length > BATCH_CAP) {
    return Response.json(
      { error: `builds must be an array of at most ${BATCH_CAP} items` },
      { status: 400 },
    );
  }

  // Validate and extract each build object
  const validatedBuilds: Build[] = [];
  for (const raw of builds) {
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Invalid build object" }, { status: 400 });
    }
    const b = raw as Record<string, unknown>;
    const id = String(b.id ?? "");
    const objectPrefix = String(b.objectPrefix ?? "");
    if (!BUILD_ID_RE.test(id)) {
      return Response.json(
        { error: `Invalid buildId: ${id}` },
        { status: 400 },
      );
    }
    if (!OBJECT_PREFIX_RE.test(objectPrefix)) {
      return Response.json(
        { error: `Invalid objectPrefix: ${objectPrefix}` },
        { status: 400 },
      );
    }
    validatedBuilds.push({
      id: id as BuildId,
      jobName,
      result: (b.result as Build["result"]) ?? "FAILURE",
      startedIso: String(b.startedIso ?? ""),
      startedMs: Number(b.startedMs ?? 0),
      durationMs: Number(b.durationMs ?? 0),
      prNumber: b.prNumber != null ? Number(b.prNumber) : null,
      prTitle: b.prTitle != null ? String(b.prTitle) : null,
      prAuthor: b.prAuthor != null ? String(b.prAuthor) : null,
      baseRef: String(b.baseRef ?? ""),
      objectPrefix,
      spyglassUrl: String(b.spyglassUrl ?? ""),
    });
  }

  // SSRF guard — validate the job name against the known catalog
  if (!(await validateJob(jobName))) {
    return Response.json({ error: `Unknown job: ${jobName}` }, { status: 400 });
  }

  const cache = getCache();

  const tasks = validatedBuilds.map((build) => async (): Promise<RunResult> => {
    // Return cached result for immutable terminal builds
    if (!force) {
      const cached = await cache.get<RunResult>(keys.runResult(build.id));
      if (cached) return cached;
    }

    const result = await analyzeBuild(build);

    // Cache immutable terminal results
    if (result.prowResult !== "PENDING") {
      await cache.set(keys.runResult(build.id), result, TTL.IMMUTABLE);
    }

    return result;
  });

  try {
    const results = await pool(tasks, CONCURRENCY);
    return Response.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
