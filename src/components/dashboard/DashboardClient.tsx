"use client";

import {
  Alert,
  AlertActionLink,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  EmptyState,
  EmptyStateBody,
  PageSection,
  Spinner,
} from "@patternfly/react-core";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog, useJobs } from "@/hooks/useCatalog";
import { useCrpTimings } from "@/hooks/useCrpTimings";
import { useRunAnalysis } from "@/hooks/useRunAnalysis";
import { checkCrpTimingAvailability } from "@/lib/ci/crpTimingAvailability";
import { hasCrpTimingData } from "@/lib/ci/crpTimings";
import { downloadCsv, generateCsv } from "@/lib/ci/csv";
import {
  aggregateJobPattern,
  REPOSITORIES,
  type Repository,
} from "@/lib/ci/repository";
import type {
  Build,
  DevVersionResult,
  JobRef,
  SuiteStat,
} from "@/lib/ci/types";
import { BulkTriageModal } from "./BulkTriageModal";
import {
  AGGREGATE_BRANCH,
  ControlBar,
  type MetricKey,
  type ViewKey,
} from "./ControlBar";
import { HeatmapGrid } from "./HeatmapGrid";
import { HeatmapLegend } from "./HeatmapLegend";
import { HeatmapMatrix } from "./HeatmapMatrix";
import { HeatmapTable } from "./HeatmapTable";
import { LoadProgress } from "./LoadProgress";
import { SuiteDetailPanel } from "./SuiteDetailPanel";
import { SummaryStrip } from "./SummaryStrip";

const EMPTY_DEV_VERSION: DevVersionResult = {
  version: "",
  jiraVersion: "",
  sourceBranch: "",
  resolvedVia: "unavailable",
};

const ALL_REPOS = Object.values(REPOSITORIES);
const DEFAULT_REPO = REPOSITORIES["openshift/console"] ?? ALL_REPOS[0];

const CrpTimingsView = dynamic(
  () => import("./CrpTimingsView").then((module) => module.CrpTimingsView),
  { ssr: false, loading: () => <Spinner aria-label="Loading timing charts" /> },
);

async function getBuilds(url: string, signal: AbortSignal): Promise<Build[]> {
  const response = await fetch(url, { signal });
  const data: { builds?: Build[]; error?: string } = await response.json();
  if (!response.ok || !data.builds) {
    throw new Error(data.error ?? `Runs: HTTP ${response.status}`);
  }
  return data.builds;
}

export function DashboardClient() {
  // Repo selection
  const [selectedRepo, setSelectedRepo] = useState<Repository>(DEFAULT_REPO);

  // Catalog
  const { branches, loading: catalogLoading } = useCatalog(selectedRepo);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  // useJobs only when not in aggregate mode — returns [] when branch is null
  const { jobs: singleBranchJobs } = useJobs(
    selectedBranch === AGGREGATE_BRANCH ? null : selectedBranch,
    selectedRepo,
  );

  // Job suffixes common to ALL branches (intersection) — available in aggregate mode
  const aggregateJobs = useMemo<JobRef[]>(() => {
    if (branches.length === 0) return [];
    const suffixSets = branches.map(
      (b) => new Set(b.jobs.map((j) => j.suffix)),
    );
    const [first, ...rest] = suffixSets;
    const common = [...(first ?? [])].filter((s) =>
      rest.every((set) => set.has(s)),
    );
    return common.sort().map((suffix) => ({
      branch: AGGREGATE_BRANCH,
      suffix,
      name: suffix, // used as the select option value
      lastRunIso: null,
    }));
  }, [branches]);

  const jobs =
    selectedBranch === AGGREGATE_BRANCH ? aggregateJobs : singleBranchJobs;

  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);

  // View state — table is the default
  const [view, setView] = useState<ViewKey>("table");
  const [metric, setMetric] = useState<MetricKey>("unhealthyRate");
  const [suiteFilter, setSuiteFilter] = useState("");
  const [showLowSample, setShowLowSample] = useState(false);
  const [showCiOperator, setShowCiOperator] = useState(false);

  // Export / bulk prompt
  const [bulkTriageOpen, setBulkTriageOpen] = useState(false);

  // Selected suite (drawer)
  const [selectedSuite, setSelectedSuite] = useState<SuiteStat | null>(null);
  // Clicking the same suite again closes the drawer.
  const toggleSuite = (suite: SuiteStat) =>
    setSelectedSuite((prev) => (prev?.name === suite.name ? null : suite));

  // Dev version
  const [devVersion, setDevVersion] =
    useState<DevVersionResult>(EMPTY_DEV_VERSION);
  useEffect(() => {
    fetch(`/api/dev-version?repo=${encodeURIComponent(selectedRepo.repo)}`)
      .then((r) => r.json())
      .then((d) => setDevVersion(d))
      .catch(() => {});
  }, [selectedRepo.repo]);

  // Analysis
  const { analysis, loading, error, progress, run, cancel } = useRunAnalysis();
  const {
    analysis: timingAnalysis,
    loading: timingLoading,
    error: timingError,
    progress: timingProgress,
    run: runTimings,
    cancel: cancelTimings,
    reset: resetTimings,
  } = useCrpTimings();
  const isTimings =
    view === "timings" && selectedRepo.repo === "openshift/console";
  const activeLoading = isTimings ? timingLoading : loading;
  const activeProgress = isTimings ? timingProgress : progress;
  const [fetchError, setFetchError] = useState<string | null>(null);
  const activeError = fetchError ?? (isTimings ? timingError : error);
  const prefetchRef = useRef<AbortController | null>(null);
  // Tracks the /api/runs prefetch so the spinner appears before run() is called.
  const [pendingFetch, setPendingFetch] = useState(false);

  const selectedJob = selectedJobName
    ? (jobs.find((j) => j.name === selectedJobName) ?? null)
    : null;

  const availabilityKey = `${selectedRepo.repo}:${selectedBranch}:${selectedJobName}`;
  const [crpAvailability, setCrpAvailability] = useState({
    key: "",
    available: false,
  });
  const hasCrpTimings =
    selectedRepo.repo === "openshift/console" &&
    !!selectedJob &&
    crpAvailability.key === availabilityKey &&
    crpAvailability.available;

  const doRun = useCallback(
    async (force = false) => {
      if (!selectedJob) return;
      prefetchRef.current?.abort();
      const controller = new AbortController();
      prefetchRef.current = controller;
      resetTimings();
      cancel();
      setFetchError(null);
      setPendingFetch(true);
      try {
        let combinedBuilds: Build[];
        let effectiveJob: JobRef;

        if (selectedBranch === AGGREGATE_BRANCH) {
          // Fetch runs for every branch's version of this job suffix in parallel
          const branchJobs = branches.flatMap((b) =>
            b.jobs.filter((j) => j.suffix === selectedJob.suffix),
          );
          const results = await Promise.all(
            branchJobs.map((bj) =>
              getBuilds(
                `/api/runs?job=${encodeURIComponent(bj.name)}&days=${windowDays}&repo=${encodeURIComponent(selectedRepo.repo)}${force ? "&force=1" : ""}`,
                controller.signal,
              ),
            ),
          );
          combinedBuilds = results.flat();
          effectiveJob = {
            branch: AGGREGATE_BRANCH,
            suffix: selectedJob.suffix,
            // Regex accepted by dptools `name=` param — matches all branches.
            name: aggregateJobPattern(selectedRepo, selectedJob.suffix),
            lastRunIso: null,
          };
        } else {
          combinedBuilds = await getBuilds(
            `/api/runs?job=${encodeURIComponent(selectedJob.name)}&days=${windowDays}&repo=${encodeURIComponent(selectedRepo.repo)}${force ? "&force=1" : ""}`,
            controller.signal,
          );
          effectiveJob = selectedJob;
        }

        if (controller.signal.aborted) return;
        if (isTimings) {
          const timings = await runTimings(combinedBuilds, force);
          if (!controller.signal.aborted && timings) {
            const available = hasCrpTimingData(timings.results);
            setCrpAvailability({ key: availabilityKey, available });
            if (!available) setView("table");
          }
        } else {
          run(effectiveJob, combinedBuilds, windowDays, selectedRepo, force);
          if (selectedRepo.repo === "openshift/console") {
            // This probe runs alongside junit analysis; it reuses the timing cache.
            checkCrpTimingAvailability(
              combinedBuilds,
              controller.signal,
              force,
            ).then((available) => {
              if (!controller.signal.aborted)
                setCrpAvailability({ key: availabilityKey, available });
            });
          }
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (prefetchRef.current === controller) setPendingFetch(false);
      }
    },
    [
      selectedJob,
      selectedBranch,
      branches,
      windowDays,
      selectedRepo,
      run,
      isTimings,
      runTimings,
      resetTimings,
      cancel,
      availabilityKey,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: windowDays is captured by doRun
  useEffect(() => {
    if (selectedJob) doRun(false);
    return () => {
      prefetchRef.current?.abort();
      cancelTimings();
      cancel();
    };
  }, [selectedJob, windowDays, doRun, cancelTimings, cancel]);

  const clearSelection = (clearAvailability = true) => {
    prefetchRef.current?.abort();
    setPendingFetch(false);
    setFetchError(null);
    resetTimings();
    cancel();
    setSelectedSuite(null);
    if (clearAvailability) {
      setCrpAvailability({ key: "", available: false });
      if (view === "timings") setView("table");
    }
  };

  const handleRepoChange = (repo: Repository) => {
    clearSelection();
    if (repo.repo !== "openshift/console" && view === "timings")
      setView("table");
    setSelectedRepo(repo);
    setSelectedBranch(null);
    setSelectedJobName(null);
    setSelectedSuite(null);
  };

  const handleBranchChange = (branch: string) => {
    clearSelection();
    setSelectedBranch(branch);
    setSelectedJobName(null);
    setSelectedSuite(null);
  };

  const handleJobChange = (jobName: string) => {
    clearSelection();
    setSelectedJobName(jobName);
    setSelectedSuite(null);
  };

  const handleViewChange = (next: ViewKey) => {
    if (next === "timings" && !hasCrpTimings) return;
    if ((next === "timings") !== isTimings) clearSelection(false);
    setView(next);
  };

  if (catalogLoading) {
    return (
      <PageSection>
        <Spinner size="xl" aria-label="Loading branch catalog…" />
      </PageSection>
    );
  }

  return (
    <>
      {/* Toolbar — fixed-height, never scrolls */}
      <PageSection variant="secondary" hasBodyWrapper={false}>
        <ControlBar
          repositories={ALL_REPOS}
          selectedRepo={selectedRepo}
          onRepoChange={handleRepoChange}
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={handleBranchChange}
          jobs={jobs}
          selectedJob={selectedJobName}
          onJobChange={handleJobChange}
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          view={view}
          hasCrpTimings={hasCrpTimings}
          onViewChange={handleViewChange}
          metric={metric}
          onMetricChange={setMetric}
          suiteFilter={suiteFilter}
          onSuiteFilterChange={setSuiteFilter}
          showLowSample={showLowSample}
          onShowLowSampleChange={setShowLowSample}
          showCiOperator={showCiOperator}
          onShowCiOperatorChange={setShowCiOperator}
          loading={pendingFetch || activeLoading}
          onRefresh={() => doRun(false)}
          onForceRefresh={() => doRun(true)}
          hasAnalysis={!!analysis}
          onExportCsv={() => {
            if (!analysis) return;
            const filename = `ci-watcher-${analysis.job.suffix}-${analysis.windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`;
            downloadCsv(generateCsv(analysis), filename);
          }}
          onBulkPrompt={() => setBulkTriageOpen(true)}
        />
      </PageSection>

      {analysis && (
        <BulkTriageModal
          isOpen={bulkTriageOpen}
          onClose={() => setBulkTriageOpen(false)}
          analysis={analysis}
          devVersion={devVersion}
          repo={selectedRepo}
        />
      )}

      {/*
       * Content area — fills remaining viewport height (isFilled = flex: 1).
       * overflow: hidden here so scrolling is isolated to the DrawerContentBody,
       * not the page itself. The drawer panel becomes its own independent layer.
       */}
      <PageSection
        isFilled
        hasBodyWrapper={false}
        padding={{ default: "noPadding" }}
        style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <Drawer
          isExpanded={!!selectedSuite}
          position="end"
          style={{ flex: 1, overflow: "hidden" }}
        >
          <DrawerContent
            panelContent={
              selectedSuite &&
              analysis && (
                <SuiteDetailPanel
                  suite={selectedSuite}
                  analysis={analysis}
                  devVersion={devVersion}
                  repo={selectedRepo}
                  onClose={() => setSelectedSuite(null)}
                />
              )
            }
            style={{ overflow: "hidden" }}
          >
            {/*
             * DrawerContentBody is the only scrolling surface.
             * The drawer panel sits alongside it at the same height,
             * independently scrollable, and never moves with this content.
             */}
            <DrawerContentBody style={{ overflowY: "auto", height: "100%" }}>
              {activeLoading && (
                <LoadProgress
                  done={activeProgress.done}
                  total={activeProgress.total}
                  onCancel={isTimings ? cancelTimings : cancel}
                />
              )}

              {activeError && (
                <Alert
                  variant="danger"
                  isInline
                  title="Failed to load analysis"
                  actionLinks={
                    <AlertActionLink onClick={() => doRun(false)}>
                      Retry
                    </AlertActionLink>
                  }
                >
                  {activeError}
                </Alert>
              )}

              {!(isTimings ? timingAnalysis : analysis) &&
                !activeLoading &&
                !pendingFetch &&
                !activeError && (
                  <EmptyState>
                    <EmptyStateBody>
                      {selectedJob
                        ? "Select a branch and job above to start analyzing prow runs."
                        : "Select a branch and job above to start."}
                    </EmptyStateBody>
                  </EmptyState>
                )}

              {isTimings && timingAnalysis && (
                <CrpTimingsView analysis={timingAnalysis} />
              )}

              {!isTimings && analysis && (
                <>
                  <SummaryStrip analysis={analysis} />

                  {view === "matrix" && (
                    <HeatmapMatrix
                      analysis={analysis}
                      metric={metric}
                      suiteFilter={suiteFilter}
                      showLowSample={showLowSample}
                      showCiOperator={showCiOperator}
                      onSelectSuite={toggleSuite}
                    />
                  )}
                  {view === "grid" && (
                    <HeatmapGrid
                      analysis={analysis}
                      metric={metric}
                      suiteFilter={suiteFilter}
                      showLowSample={showLowSample}
                      showCiOperator={showCiOperator}
                      onSelectSuite={toggleSuite}
                    />
                  )}
                  {view === "table" && (
                    <HeatmapTable
                      analysis={analysis}
                      metric={metric}
                      suiteFilter={suiteFilter}
                      showLowSample={showLowSample}
                      showCiOperator={showCiOperator}
                      onSelectSuite={toggleSuite}
                    />
                  )}

                  {view !== "table" && <HeatmapLegend />}
                </>
              )}
            </DrawerContentBody>
          </DrawerContent>
        </Drawer>
      </PageSection>
    </>
  );
}
