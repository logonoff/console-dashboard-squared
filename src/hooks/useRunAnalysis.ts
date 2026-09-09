"use client";

import { useCallback, useRef, useState } from "react";
import { aggregate } from "@/lib/ci/aggregate";
import type { Analysis, Build, JobRef, RunResult } from "@/lib/ci/types";

const CLIENT_CONCURRENCY = Number(
  typeof process !== "undefined"
    ? (process.env.CI_CLIENT_CONCURRENCY ?? "4")
    : "4",
);
const BATCH_SIZE = Number(
  typeof process !== "undefined" ? (process.env.CI_ANALYZE_BATCH ?? "8") : "8",
);

export interface AnalysisProgress {
  done: number;
  total: number;
}

export interface UseRunAnalysisResult {
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  progress: AnalysisProgress;
  run: (
    job: JobRef,
    builds: Build[],
    windowDays: number,
    force?: boolean,
  ) => void;
  cancel: () => void;
}

export function useRunAnalysis(): UseRunAnalysisResult {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress>({
    done: 0,
    total: 0,
  });
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const run = useCallback(
    async (job: JobRef, builds: Build[], windowDays: number, force = false) => {
      cancelRef.current = false;
      setLoading(true);
      setError(null);
      setProgress({ done: 0, total: builds.length });

      // Split builds into batches
      const batches: Build[][] = [];
      for (let i = 0; i < builds.length; i += BATCH_SIZE) {
        batches.push(builds.slice(i, i + BATCH_SIZE));
      }

      const allRuns: RunResult[] = [];
      let done = 0;

      try {
        // Fan out batches with bounded concurrency
        let batchIdx = 0;
        async function worker(): Promise<void> {
          while (batchIdx < batches.length) {
            if (cancelRef.current) return;
            const batch = batches[batchIdx++];
            const res = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                job: job.name,
                buildIds: batch.map((b) => b.id),
                force,
              }),
            });
            if (!res.ok) {
              throw new Error(`analyze: HTTP ${res.status}`);
            }
            const data: { results: RunResult[] } = await res.json();
            for (const r of data.results) {
              allRuns.push(r);
            }
            done += batch.length;
            setProgress({ done, total: builds.length });
          }
        }

        const workers = Array.from(
          { length: Math.min(CLIENT_CONCURRENCY, batches.length) },
          () => worker(),
        );
        await Promise.all(workers);

        if (!cancelRef.current) {
          setAnalysis(aggregate(job, builds, allRuns, windowDays));
        }
      } catch (err) {
        if (!cancelRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { analysis, loading, error, progress, run, cancel };
}
