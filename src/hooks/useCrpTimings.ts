"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Build, CrpTimingAnalysis, CrpTimingResult } from "@/lib/ci/types";

export function useCrpTimings() {
  const [analysis, setAnalysis] = useState<CrpTimingAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setLoading(false);
  }, []);
  const reset = useCallback(() => {
    cancel();
    setAnalysis(null);
    setError(null);
  }, [cancel]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async (builds: Build[], force = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAnalysis(null);
    setError(null);
    setLoading(true);
    setProgress({ done: 0, total: builds.length });

    const byJob = new Map<string, Build[]>();
    for (const build of builds) {
      const group = byJob.get(build.jobName) ?? [];
      group.push(build);
      byJob.set(build.jobName, group);
    }
    const batches = [...byJob].flatMap(([job, group]) => {
      const result: { job: string; builds: Build[] }[] = [];
      for (let i = 0; i < group.length; i += 8) {
        result.push({ job, builds: group.slice(i, i + 8) });
      }
      return result;
    });
    const results: CrpTimingResult[] = [];
    let next = 0;
    let done = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, batches.length) }, async () => {
          while (next < batches.length && !controller.signal.aborted) {
            const batch = batches[next++];
            const response = await fetch("/api/crp-timings", {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repo: "openshift/console",
                ...batch,
                force,
              }),
            });
            const data: { results?: CrpTimingResult[]; error?: string } =
              await response.json();
            if (!response.ok || !data.results) {
              throw new Error(
                data.error ?? `CRP timings: HTTP ${response.status}`,
              );
            }
            if (controller.signal.aborted) return;
            results.push(...data.results);
            done += batch.builds.length;
            setProgress({ done, total: builds.length });
          }
        }),
      );
      if (!controller.signal.aborted) {
        const completed = { builds, results };
        setAnalysis(completed);
        return completed;
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
        controller.abort();
      }
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, []);

  return { analysis, loading, error, progress, run, cancel, reset };
}
