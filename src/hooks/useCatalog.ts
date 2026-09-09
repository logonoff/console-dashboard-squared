"use client";

import { useEffect, useState } from "react";
import type { BranchEntry, JobRef } from "@/lib/ci/types";

export interface CatalogState {
  branches: BranchEntry[];
  loading: boolean;
  error: string | null;
}

export function useCatalog(): CatalogState {
  const [branches, setBranches] = useState<BranchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/branches")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setBranches(data.branches ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { branches, loading, error };
}

export function useJobs(branch: string | null): {
  jobs: JobRef[];
  loading: boolean;
  error: string | null;
} {
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branch) {
      setJobs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/jobs?branch=${encodeURIComponent(branch)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setJobs(data.jobs ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branch]);

  return { jobs, loading, error };
}
