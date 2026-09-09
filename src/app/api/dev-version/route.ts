import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { resolveDevVersion } from "@/lib/ci/devVersion";

export const maxDuration = 20;

export async function GET() {
  const cache = getCache();
  try {
    const result = await cache.getOrLoad(
      keys.devVersion(),
      TTL.DEV_VERSION,
      () => resolveDevVersion(),
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
