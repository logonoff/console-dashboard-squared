"use client";

import {
  Button,
  MenuToggle,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Tooltip,
} from "@patternfly/react-core";
import { RhUiRefreshIcon } from "@patternfly/react-icons";
import { useState } from "react";
import { AGGREGATE_BRANCH } from "@/lib/ci/constants";
import type { Repository } from "@/lib/ci/repository";
import type { BranchEntry, JobRef } from "@/lib/ci/types";

export type MetricKey = "unhealthyRate" | "failureRate" | "flakeRate";
export type ViewKey = "matrix" | "grid" | "table";
export { AGGREGATE_BRANCH };

interface Props {
  repositories: Repository[];
  selectedRepo: Repository;
  onRepoChange: (r: Repository) => void;
  branches: BranchEntry[];
  selectedBranch: string | null;
  onBranchChange: (branch: string) => void;
  jobs: JobRef[];
  selectedJob: string | null;
  onJobChange: (jobName: string) => void;
  windowDays: number;
  onWindowChange: (days: number) => void;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  metric: MetricKey;
  onMetricChange: (m: MetricKey) => void;
  suiteFilter: string;
  onSuiteFilterChange: (v: string) => void;
  showLowSample: boolean;
  onShowLowSampleChange: (v: boolean) => void;
  showCiOperator: boolean;
  onShowCiOperatorChange: (v: boolean) => void;
  loading: boolean;
  onRefresh: () => void;
  onForceRefresh: () => void;
  hasAnalysis: boolean;
  onExportCsv: () => void;
  onBulkPrompt: () => void;
}

function RepoSelect({
  repositories,
  value,
  onChange,
}: {
  repositories: Repository[];
  value: Repository;
  onChange: (r: Repository) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      isOpen={open}
      onOpenChange={setOpen}
      selected={value.repo}
      onSelect={(_e, v) => {
        const repo = repositories.find((r) => r.repo === v);
        if (repo) onChange(repo);
        setOpen(false);
      }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          onClick={() => setOpen(!open)}
          isExpanded={open}
          style={{ minWidth: 160 }}
        >
          {value.name}
        </MenuToggle>
      )}
    >
      <SelectList>
        {repositories.map((r) => (
          <SelectOption key={r.repo} value={r.repo} description={r.repo}>
            {r.name}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
}

function BranchSelect({
  branches,
  value,
  onChange,
}: {
  branches: BranchEntry[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      isOpen={open}
      onOpenChange={setOpen}
      selected={value ?? undefined}
      onSelect={(_e, v) => {
        onChange(String(v));
        setOpen(false);
      }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          onClick={() => setOpen(!open)}
          isExpanded={open}
          style={{ minWidth: 130 }}
        >
          {value === AGGREGATE_BRANCH
            ? "All branches"
            : (value ?? "Select branch")}
        </MenuToggle>
      )}
    >
      <SelectList>
        <SelectOption
          key={AGGREGATE_BRANCH}
          value={AGGREGATE_BRANCH}
          description="Common jobs across all branches"
        >
          All branches
        </SelectOption>
        {branches.map((b) => (
          <SelectOption key={b.id} value={b.id}>
            {b.id}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
}

function JobSelect({
  jobs,
  value,
  onChange,
  disabled,
}: {
  jobs: JobRef[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  return (
    <Select
      isOpen={open && !disabled}
      onOpenChange={setOpen}
      selected={value ?? undefined}
      onSelect={(_e, v) => {
        onChange(String(v));
        setOpen(false);
      }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          onClick={() => !disabled && setOpen(!open)}
          isExpanded={open && !disabled}
          isDisabled={disabled}
          style={{ minWidth: 200 }}
        >
          {value
            ? (jobs.find((j) => j.name === value)?.suffix ?? value)
            : "Select job"}
        </MenuToggle>
      )}
    >
      <SelectList>
        {jobs.map((j) => {
          const stale = j.lastRunIso
            ? now - new Date(j.lastRunIso).getTime() > STALE_MS
            : false;
          return (
            <SelectOption
              key={j.name}
              value={j.name}
              description={stale ? "⚠ stale" : undefined}
            >
              {j.suffix}
            </SelectOption>
          );
        })}
      </SelectList>
    </Select>
  );
}

function WindowSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = [7, 14, 30];
  return (
    <Select
      isOpen={open}
      onOpenChange={setOpen}
      selected={value}
      onSelect={(_e, v) => {
        onChange(Number(v));
        setOpen(false);
      }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          onClick={() => setOpen(!open)}
          isExpanded={open}
          style={{ minWidth: 90 }}
        >
          {value}d
        </MenuToggle>
      )}
    >
      <SelectList>
        {options.map((d) => (
          <SelectOption key={d} value={d}>
            {d} days
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
}

export function ControlBar({
  repositories,
  selectedRepo,
  onRepoChange,
  branches,
  selectedBranch,
  onBranchChange,
  jobs,
  selectedJob,
  onJobChange,
  windowDays,
  onWindowChange,
  view,
  onViewChange,
  metric,
  onMetricChange,
  suiteFilter,
  onSuiteFilterChange,
  showLowSample,
  onShowLowSampleChange,
  showCiOperator,
  onShowCiOperatorChange,
  loading,
  onRefresh,
  onForceRefresh,
  hasAnalysis,
  onExportCsv,
  onBulkPrompt,
}: Props) {
  return (
    <Toolbar>
      <ToolbarContent>
        <ToolbarGroup>
          <ToolbarItem>
            <RepoSelect
              repositories={repositories}
              value={selectedRepo}
              onChange={onRepoChange}
            />
          </ToolbarItem>
          <ToolbarItem>
            <BranchSelect
              branches={branches}
              value={selectedBranch}
              onChange={onBranchChange}
            />
          </ToolbarItem>
          <ToolbarItem>
            <JobSelect
              jobs={jobs}
              value={selectedJob}
              onChange={onJobChange}
              disabled={!selectedBranch}
            />
          </ToolbarItem>
          <ToolbarItem>
            <WindowSelect value={windowDays} onChange={onWindowChange} />
          </ToolbarItem>
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarItem>
            <Tooltip
              content="Table: sortable list · Matrix: suite × run cells · Grid: compact colour squares"
              position="bottom"
            >
              <ToggleGroup aria-label="View">
                <ToggleGroupItem
                  text="Table"
                  buttonId="view-table"
                  isSelected={view === "table"}
                  onChange={() => onViewChange("table")}
                />
                <ToggleGroupItem
                  text="Matrix"
                  buttonId="view-matrix"
                  isSelected={view === "matrix"}
                  onChange={() => onViewChange("matrix")}
                />
                <ToggleGroupItem
                  text="Grid"
                  buttonId="view-grid"
                  isSelected={view === "grid"}
                  onChange={() => onViewChange("grid")}
                />
              </ToggleGroup>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Unhealthy = hard failures + flakes · Failures = final outcome fail · Flakes = fail then pass on retry"
              position="bottom"
            >
              <ToggleGroup aria-label="Metric">
                <ToggleGroupItem
                  text="Unhealthy"
                  buttonId="m-unhealthy"
                  isSelected={metric === "unhealthyRate"}
                  onChange={() => onMetricChange("unhealthyRate")}
                />
                <ToggleGroupItem
                  text="Failures"
                  buttonId="m-fail"
                  isSelected={metric === "failureRate"}
                  onChange={() => onMetricChange("failureRate")}
                />
                <ToggleGroupItem
                  text="Flakes"
                  buttonId="m-flake"
                  isSelected={metric === "flakeRate"}
                  onChange={() => onMetricChange("flakeRate")}
                />
              </ToggleGroup>
            </Tooltip>
          </ToolbarItem>
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarItem>
            <SearchInput
              placeholder="Filter suites…"
              value={suiteFilter}
              onChange={(_e, v) => onSuiteFilterChange(v)}
              onClear={() => onSuiteFilterChange("")}
              style={{ minWidth: 180 }}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Show suites hidden by default: fewer than 3 runs, failures from only one PR, or no failures at all (healthy suites)"
              position="bottom"
            >
              <Switch
                label="Low-sample & healthy suites"
                isChecked={showLowSample}
                onChange={(_e, checked) => onShowLowSampleChange(checked)}
                aria-label="Show low sample suites"
              />
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Show ci-operator step graph results (e.g. clone, build steps) — these are infrastructure steps, not test suites"
              position="bottom"
            >
              <Switch
                label="CI step results"
                isChecked={showCiOperator}
                onChange={(_e, checked) => onShowCiOperatorChange(checked)}
                aria-label="Show CI operator step results"
              />
            </Tooltip>
          </ToolbarItem>
        </ToolbarGroup>

        <ToolbarGroup align={{ default: "alignEnd" }}>
          <ToolbarItem>
            <Tooltip
              content="Download all suite statistics as a CSV file"
              position="bottom"
            >
              <Button
                variant="secondary"
                onClick={onExportCsv}
                isDisabled={!hasAnalysis || loading}
              >
                Export CSV
              </Button>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Generate a prompt for an LLM to triage all suites — check JIRA for duplicates and file OCPBUGS"
              position="bottom"
            >
              <Button
                variant="secondary"
                onClick={onBulkPrompt}
                isDisabled={!hasAnalysis || loading}
              >
                Bulk triage prompt
              </Button>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Re-fetch runs and re-analyze from prow (run cache is kept)"
              position="bottom"
            >
              <Button
                variant="secondary"
                icon={<RhUiRefreshIcon />}
                isLoading={loading}
                onClick={onRefresh}
                isDisabled={loading}
              >
                Refresh
              </Button>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip
              content="Re-download artifacts (clears immutable run cache)"
              position="bottom"
            >
              <Button
                variant="plain"
                onClick={onForceRefresh}
                isDisabled={loading}
                aria-label="Re-download artifacts"
              >
                Force
              </Button>
            </Tooltip>
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );
}
