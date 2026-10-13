import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { type CrpBuild, fetchCrpTimings } from "./crp";
import type { CrpTimingResult } from "./types";

/** Shared by JSON analysis and PNG rendering; error/partial results stay uncached. */
export async function loadCrpTimings(
  build: CrpBuild,
  force = false,
): Promise<CrpTimingResult> {
  const cache = getCache();
  const key = keys.crpTimings(build.id);
  if (!force && (build.result === "SUCCESS" || build.result === "FAILURE")) {
    const cached = await cache.get<CrpTimingResult>(key);
    if (cached) return cached;
  }
  const result = await fetchCrpTimings(build);
  if (
    !result.error &&
    (result.status === "analyzed" || result.status === "no-artifact")
  ) {
    await cache.set(key, result, TTL.IMMUTABLE);
  }
  return result;
}
