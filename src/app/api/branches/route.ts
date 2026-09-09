import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog } from "@/lib/ci/catalog";
import { parseRepoParam } from "@/lib/ci/repository";

export const maxDuration = 15;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const repoSlug = url.searchParams.get("repo") ?? "";
  const repo = parseRepoParam(repoSlug);
  if (!repo) {
    return Response.json(
      { error: `Unknown repo "${repoSlug}"` },
      { status: 400 },
    );
  }

  const cache = getCache();

  try {
    const branches = await cache.getOrLoad(
      keys.catalog(repo.repo),
      TTL.CATALOG,
      () => fetchCatalog(repo),
      { force },
    );
    return Response.json({
      branches,
      generatedAtIso: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
