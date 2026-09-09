import { getCache } from "@/lib/cache";
import { hourBucket, keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog } from "@/lib/ci/catalog";
import { fetchBuildsInWindow } from "@/lib/ci/prow";

export const maxDuration = 30;

/** Validate that a job name is in the catalog to prevent SSRF via prow URL. */
async function isKnownJob(jobName: string): Promise<boolean> {
  const cache = getCache();
  const branches = await cache.getOrLoad(keys.catalog(), TTL.CATALOG, () =>
    fetchCatalog(),
  );
  return branches.some((b) => b.jobs.some((j) => j.name === jobName));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobName = url.searchParams.get("job") ?? "";
  const days = Math.max(
    1,
    Math.min(90, Number(url.searchParams.get("days") ?? "14")),
  );
  const force = url.searchParams.get("force") === "1";

  // Basic structural validation before the catalog check
  if (!/^pull-ci-openshift-console-[a-z0-9.-]+-[a-z0-9-]+$/.test(jobName)) {
    return Response.json({ error: "Invalid job name" }, { status: 400 });
  }

  if (!(await isKnownJob(jobName))) {
    return Response.json({ error: `Unknown job: ${jobName}` }, { status: 400 });
  }

  const nowMs = Date.now();
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const bucket = hourBucket(cutoffMs);

  const cache = getCache();
  try {
    const result = await cache.getOrLoad(
      keys.runs(jobName, days, bucket),
      TTL.RUNS,
      () =>
        fetchBuildsInWindow({ jobName, cutoffMs }).then((r) => ({
          ...r,
          windowDays: days,
          windowStartIso: new Date(cutoffMs).toISOString(),
          windowEndIso: new Date(nowMs).toISOString(),
          job: jobName,
        })),
      { force },
    );
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
