import type { CrpTiming, CrpTimingAttempt, CrpTimingResult } from "./types";

export function hasCrpTimingData(results: CrpTimingResult[]): boolean {
  return results.some((result) =>
    result.attempts.some((attempt) =>
      attempt.loads.some((load) => load.length > 0),
    ),
  );
}

export function parseCrpTimings(text: string): CrpTiming[][] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.length > 100) {
    throw new Error("CRP timings must be an array of at most 100 page loads");
  }
  return data.map((load: unknown) => {
    if (!Array.isArray(load) || load.length > 1000) {
      throw new Error("Invalid CRP page load");
    }
    return load.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") {
        throw new Error("Invalid CRP timing entry");
      }
      const { name, duration } = entry as Record<string, unknown>;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 500 ||
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration < 0
      ) {
        throw new Error("Invalid CRP timing name or duration");
      }
      return { name, duration };
    });
  });
}

/** Repeated occurrences of the same LoadingBox are added within a page load. */
export function timingDuration(load: CrpTiming[], name: string): number | null {
  let duration: number | null = null;
  for (const entry of load) {
    if (entry.name === name) duration = (duration ?? 0) + entry.duration;
  }
  return duration;
}

export function summarizeTiming(attempt: CrpTimingAttempt, name: string) {
  const values = attempt.loads
    .map((load) => timingDuration(load, name))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  };
}
