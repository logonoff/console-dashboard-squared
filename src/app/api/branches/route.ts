import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog } from "@/lib/ci/catalog";

export const maxDuration = 15;

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const cache = getCache();

  try {
    const branches = await cache.getOrLoad(
      keys.catalog(),
      TTL.CATALOG,
      () => fetchCatalog(),
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
