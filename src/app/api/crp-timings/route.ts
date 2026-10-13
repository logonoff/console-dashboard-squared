import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog } from "@/lib/ci/catalog";
import { pool } from "@/lib/ci/concurrency";
import { type CrpBuild, parseCrpBuild } from "@/lib/ci/crp";
import { loadCrpTimings } from "@/lib/ci/crpService";
import { jobNameRE, REPOSITORIES } from "@/lib/ci/repository";

export const maxDuration = 60;
const BATCH_CAP = 8;
const CONCURRENCY = 4;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request body");
    }
    body = value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const repo = REPOSITORIES["openshift/console"];
  if (body.repo !== repo.repo) {
    return Response.json(
      { error: "CRP timings are only available for openshift/console" },
      { status: 400 },
    );
  }
  const job = body.job;
  if (typeof job !== "string" || !jobNameRE(repo).test(job)) {
    return Response.json({ error: "Invalid Console job" }, { status: 400 });
  }
  if (!Array.isArray(body.builds) || body.builds.length > BATCH_CAP) {
    return Response.json(
      { error: `builds must be an array of at most ${BATCH_CAP} items` },
      { status: 400 },
    );
  }
  let builds: CrpBuild[];
  try {
    builds = body.builds.map((raw) => parseCrpBuild(raw, job));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const cache = getCache();
  try {
    const catalog = await cache.getOrLoad(
      keys.catalog(repo.repo),
      TTL.CATALOG,
      () => fetchCatalog(repo),
    );
    if (
      !catalog.some((branch) => branch.jobs.some((entry) => entry.name === job))
    ) {
      return Response.json({ error: `Unknown job: ${job}` }, { status: 400 });
    }
    const results = await pool(
      builds.map((build) => () => loadCrpTimings(build, body.force === true)),
      CONCURRENCY,
    );
    return Response.json({ results });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
