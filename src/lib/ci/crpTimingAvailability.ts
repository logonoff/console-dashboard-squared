import { hasCrpTimingData } from "./crpTimings";
import type { Build, CrpTimingResult } from "./types";

/** Check newest completed runs first, stopping as soon as a timing sample exists. */
export async function checkCrpTimingAvailability(
  builds: Build[],
  signal: AbortSignal,
  force = false,
): Promise<boolean> {
  const completed = builds
    .filter((build) => build.result === "SUCCESS" || build.result === "FAILURE")
    .toSorted((a, b) => b.startedMs - a.startedMs);
  for (let i = 0; i < completed.length; i += 8) {
    if (signal.aborted) return false;
    const byJob = new Map<string, Build[]>();
    for (const build of completed.slice(i, i + 8)) {
      const group = byJob.get(build.jobName) ?? [];
      group.push(build);
      byJob.set(build.jobName, group);
    }
    const batches = await Promise.allSettled(
      [...byJob].map(async ([job, batch]) => {
        const response = await fetch("/api/crp-timings", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: "openshift/console",
            job,
            builds: batch,
            force,
          }),
        });
        if (!response.ok)
          throw new Error(`CRP timings: HTTP ${response.status}`);
        const data: { results: CrpTimingResult[] } = await response.json();
        return hasCrpTimingData(data.results);
      }),
    );
    if (signal.aborted) return false;
    if (batches.some((batch) => batch.status === "fulfilled" && batch.value))
      return true;
  }
  return false;
}
