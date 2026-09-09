/** Cache key builders and TTL policy. All TTLs are in milliseconds. */

export const TTL = {
  CATALOG: 6 * 60 * 60 * 1000, // 6 h
  JOB_LAST_RUN: 1 * 60 * 60 * 1000, // 1 h
  RUNS: 120 * 1000, // 120 s
  DEV_VERSION: 12 * 60 * 60 * 1000, // 12 h
  IMMUTABLE: "immutable" as const,
} as const;

export type TtlMs = number | "immutable";

export const keys = {
  catalog: (repoSlug: string) => `catalog:v1:${repoSlug}`,
  jobLastRun: (jobName: string) => `joblastrun:v1:${jobName}`,
  runs: (jobName: string, days: number, hourBucket: number) =>
    `runs:v1:${jobName}:${days}:${hourBucket}`,
  junitPaths: (buildId: string) => `junitpaths:v1:${buildId}`,
  runResult: (buildId: string) => `runresult:v1:${buildId}`,
  devVersion: (repoSlug: string) => `devversion:v1:${repoSlug}`,
};

/** Quantise a cutoff timestamp to the hour so the runs cache key is stable. */
export function hourBucket(cutoffMs: number): number {
  return Math.floor(cutoffMs / (60 * 60 * 1000));
}
