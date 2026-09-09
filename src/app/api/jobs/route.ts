import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog, fetchJobLastRun } from "@/lib/ci/catalog";
import { parseRepoParam } from "@/lib/ci/repository";

export const maxDuration = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const branch = url.searchParams.get("branch");
  if (!branch) {
    return Response.json({ error: "branch param required" }, { status: 400 });
  }

  const repoSlug = url.searchParams.get("repo") ?? "";
  const repo = parseRepoParam(repoSlug);
  if (!repo) {
    return Response.json(
      { error: `Unknown repo "${repoSlug}"` },
      { status: 400 },
    );
  }

  const cache = getCache();
  const branches = await cache.getOrLoad(
    keys.catalog(repo.repo),
    TTL.CATALOG,
    () => fetchCatalog(repo),
  );

  const entry = branches.find((b) => b.id === branch);
  if (!entry) {
    return Response.json(
      { error: `Unknown branch: ${branch}` },
      { status: 400 },
    );
  }

  // Enrich with last-run dates for the "stale job" hint in the picker.
  // Fetched lazily per job, cached 1 h.
  const jobs = await Promise.all(
    entry.jobs.map(async (job) => {
      const lastRunIso = await cache.getOrLoad(
        keys.jobLastRun(job.name),
        TTL.JOB_LAST_RUN,
        () => fetchJobLastRun(job.name),
      );
      return { ...job, lastRunIso };
    }),
  );

  return Response.json({ jobs });
}
