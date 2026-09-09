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
import { useCallback, useEffect, useState } from "react";
import { useCatalog, useJobs } from "@/hooks/useCatalog";
import { useRunAnalysis } from "@/hooks/useRunAnalysis";
import type { Build, DevVersionResult, SuiteStat } from "@/lib/ci/types";
import { ControlBar, type MetricKey, type ViewKey } from "./ControlBar";
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

export function DashboardClient() {
  // Catalog
  const { branches, loading: catalogLoading } = useCatalog();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const { jobs } = useJobs(selectedBranch);
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);

  // View state — table is the default
  const [view, setView] = useState<ViewKey>("table");
  const [metric, setMetric] = useState<MetricKey>("unhealthyRate");
  const [suiteFilter, setSuiteFilter] = useState("");
  const [showLowSample, setShowLowSample] = useState(false);
  const [showCiOperator, setShowCiOperator] = useState(false);

  // Selected suite (drawer)
  const [selectedSuite, setSelectedSuite] = useState<SuiteStat | null>(null);
  // Clicking the same suite again closes the drawer.
  const toggleSuite = (suite: SuiteStat) =>
    setSelectedSuite((prev) => (prev?.name === suite.name ? null : suite));

  // Dev version
  const [devVersion, setDevVersion] =
    useState<DevVersionResult>(EMPTY_DEV_VERSION);
  useEffect(() => {
    fetch("/api/dev-version")
      .then((r) => r.json())
      .then((d) => setDevVersion(d))
      .catch(() => {});
  }, []);

  // Analysis
  const { analysis, loading, error, progress, run, cancel } = useRunAnalysis();
  // Tracks the /api/runs prefetch so the spinner appears before run() is called.
  const [pendingFetch, setPendingFetch] = useState(false);

  const selectedJob = selectedJobName
    ? (jobs.find((j) => j.name === selectedJobName) ?? null)
    : null;

  const doRun = useCallback(
    (force = false) => {
      if (!selectedJob) return;
      setPendingFetch(true);
      fetch(
        `/api/runs?job=${encodeURIComponent(selectedJob.name)}&days=${windowDays}${force ? "&force=1" : ""}`,
      )
        .then((r) => r.json())
        .then((data: { builds: Build[]; windowDays: number }) => {
          setPendingFetch(false);
          run(selectedJob, data.builds, data.windowDays, force);
        })
        .catch((err) => {
          setPendingFetch(false);
          console.error("Failed to fetch runs:", err);
        });
    },
    [selectedJob, windowDays, run],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: windowDays is captured by doRun
  useEffect(() => {
    if (selectedJob) doRun(false);
  }, [selectedJob, windowDays, doRun]);

  const handleBranchChange = (branch: string) => {
    setSelectedBranch(branch);
    setSelectedJobName(null);
    setSelectedSuite(null);
  };

  const handleJobChange = (jobName: string) => {
    setSelectedJobName(jobName);
    setSelectedSuite(null);
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
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={handleBranchChange}
          jobs={jobs}
          selectedJob={selectedJobName}
          onJobChange={handleJobChange}
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          view={view}
          onViewChange={setView}
          metric={metric}
          onMetricChange={setMetric}
          suiteFilter={suiteFilter}
          onSuiteFilterChange={setSuiteFilter}
          showLowSample={showLowSample}
          onShowLowSampleChange={setShowLowSample}
          showCiOperator={showCiOperator}
          onShowCiOperatorChange={setShowCiOperator}
          loading={pendingFetch || loading}
          onRefresh={() => doRun(false)}
          onForceRefresh={() => doRun(true)}
        />
      </PageSection>

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
              {loading && (
                <LoadProgress
                  done={progress.done}
                  total={progress.total}
                  onCancel={cancel}
                />
              )}

              {error && (
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
                  {error}
                </Alert>
              )}

              {!analysis && !loading && !error && (
                <EmptyState>
                  <EmptyStateBody>
                    {selectedJob
                      ? "Select a branch and job above to start analyzing prow runs."
                      : "Select a branch and job above to start."}
                  </EmptyStateBody>
                </EmptyState>
              )}

              {analysis && (
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
