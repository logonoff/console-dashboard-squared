import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { resolveDevVersion } from "@/lib/ci/devVersion";
import { parseRepoParam } from "@/lib/ci/repository";

export const maxDuration = 20;

export async function GET(req: Request) {
  const url = new URL(req.url);
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
    const result = await cache.getOrLoad(
      keys.devVersion(repo.repo),
      TTL.DEV_VERSION,
      () => resolveDevVersion(repo),
    );
    return Response.json(result);
  } catch (err) {
    // Degrade gracefully — the UI will prompt for a manual version override.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dev-version] resolution failed:", msg);
    return Response.json({
      version: "",
      jiraVersion: "",
      sourceBranch: "",
      resolvedVia: "unavailable",
      error: msg,
    });
  }
}
