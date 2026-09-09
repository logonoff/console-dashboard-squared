"use client";

import { Severity, SeverityType } from "@patternfly/react-component-groups";
import { Button } from "@patternfly/react-core";
import { RhUiExternalLinkIcon } from "@patternfly/react-icons";
import {
  InnerScrollContainer,
  type ISortBy,
  OuterScrollContainer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@patternfly/react-table";
import { useState } from "react";
import { dptoolsUrl } from "@/lib/ci/links";
import type { Analysis, SuiteStat } from "@/lib/ci/types";

interface Props {
  analysis: Analysis;
  metric: "unhealthyRate" | "failureRate" | "flakeRate";
  suiteFilter: string;
  showLowSample: boolean;
  showCiOperator: boolean;
  onSelectSuite: (suite: SuiteStat) => void;
}

type SortCol = "name" | "rate" | "runs" | "failed" | "flaked" | "prs";

function abbreviateBranch(branch: string): string {
  return branch === "main" ? "main" : branch.replace("release-", "");
}

function rateToSeverity(rate: number): SeverityType {
  if (rate === 0) return SeverityType.none;
  if (rate <= 0.1) return SeverityType.minor;
  if (rate <= 0.25) return SeverityType.moderate;
  if (rate <= 0.5) return SeverityType.important;
  return SeverityType.critical;
}

function rateToLabel(rate: number): string {
  const pct = Math.round(rate * 100);
  if (pct === 0) return "Healthy";
  if (pct <= 10) return "Low flakiness";
  if (pct <= 25) return "Moderate";
  if (pct <= 50) return "High";
  return "Critical";
}

export function HeatmapTable({
  analysis,
  metric,
  suiteFilter,
  showLowSample,
  showCiOperator,
  onSelectSuite,
}: Props) {
  const [sortBy, setSortBy] = useState<ISortBy>({
    index: 2,
    direction: "desc",
  });

  const getRate = (s: SuiteStat) => s[metric];

  const sortCol = indexToCol(sortBy.index ?? 2);
  const sortDir = sortBy.direction ?? "desc";

  const rows = analysis.suites
    .filter((s) => {
      if (!showLowSample && s.appearedIn < 3 && s.distinctPRs < 2) return false;
      if (!showCiOperator && s.origin === "ci-operator") return false;
      if (
        suiteFilter &&
        !s.name.toLowerCase().includes(suiteFilter.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      let diff = 0;
      if (sortCol === "name") diff = a.name.localeCompare(b.name);
      else if (sortCol === "rate") diff = getRate(a) - getRate(b);
      else if (sortCol === "runs") diff = a.appearedIn - b.appearedIn;
      else if (sortCol === "failed") diff = a.failedIn - b.failedIn;
      else if (sortCol === "flaked") diff = a.flakedIn - b.flakedIn;
      else if (sortCol === "prs") diff = a.distinctPRs - b.distinctPRs;
      return sortDir === "asc" ? diff : -diff;
    });

  function onSort(_: React.MouseEvent, colIdx: number, dir: "asc" | "desc") {
    setSortBy({ index: colIdx, direction: dir });
  }

  const metricLabel =
    metric === "failureRate"
      ? "Failure rate"
      : metric === "flakeRate"
        ? "Flake rate"
        : "Unhealthy rate";

  return (
    <OuterScrollContainer>
      <InnerScrollContainer>
        <Table
          aria-label="Test suite failure table"
          variant="compact"
          borders={false}
          isStickyHeader
        >
          <Thead>
            <Tr>
              <Th sort={{ sortBy, onSort, columnIndex: 0 }} width={35}>
                Suite / spec
              </Th>
              <Th width={10}>Branch</Th>
              <Th sort={{ sortBy, onSort, columnIndex: 2 }} width={15}>
                {metricLabel}
              </Th>
              <Th width={10}>Status</Th>
              <Th sort={{ sortBy, onSort, columnIndex: 4 }} width={10}>
                Runs
              </Th>
              <Th sort={{ sortBy, onSort, columnIndex: 5 }} width={10}>
                Failed
              </Th>
              <Th sort={{ sortBy, onSort, columnIndex: 6 }} width={10}>
                Flaked
              </Th>
              <Th sort={{ sortBy, onSort, columnIndex: 7 }} width={10}>
                PRs affected
              </Th>
              <Th width={10}>Search</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((suite) => {
              const rate = getRate(suite);
              const pct = Math.round(rate * 100);
              const searchUrl = dptoolsUrl({
                searchTerm: suite.searchTerm,
                jobName: analysis.job.name,
                windowDays: analysis.windowDays,
              });
              return (
                <Tr
                  key={suite.name}
                  isClickable
                  onRowClick={() => onSelectSuite(suite)}
                >
                  <Td dataLabel="Suite / spec" modifier="truncate" width={35}>
                    <Button
                      variant="link"
                      isInline
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSuite(suite);
                      }}
                    >
                      {suite.name.split("/").pop() ?? suite.name}
                    </Button>
                    {suite.name.includes("/") && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--pf-t--global--text--color--subtle)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {suite.name}
                      </span>
                    )}
                  </Td>
                  <Td dataLabel="Branch" modifier="nowrap">
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--pf-t--global--text--color--subtle)",
                      }}
                    >
                      {suite.branches.map(abbreviateBranch).join(", ")}
                    </span>
                  </Td>
                  <Td dataLabel={metricLabel} modifier="nowrap">
                    {pct}%{" "}
                    <span
                      style={{
                        color: "var(--pf-t--global--text--color--subtle)",
                        fontSize: 11,
                      }}
                    >
                      ({suite.failedIn + suite.flakedIn}/{suite.appearedIn})
                    </span>
                  </Td>
                  <Td dataLabel="Status">
                    <Severity
                      severity={rateToSeverity(rate)}
                      label={rateToLabel(rate)}
                    />
                  </Td>
                  <Td dataLabel="Runs">{suite.appearedIn}</Td>
                  <Td dataLabel="Failed">{suite.failedIn}</Td>
                  <Td dataLabel="Flaked">{suite.flakedIn}</Td>
                  <Td dataLabel="PRs affected" modifier="nowrap">
                    {suite.totalPRs > 0 ? (
                      <>
                        {suite.distinctPRs}
                        <span
                          style={{
                            color: "var(--pf-t--global--text--color--subtle)",
                            fontSize: 11,
                          }}
                        >
                          {" "}
                          / {suite.totalPRs}
                        </span>
                      </>
                    ) : (
                      <span
                        style={{
                          color: "var(--pf-t--global--text--color--subtle)",
                        }}
                      >
                        —
                      </span>
                    )}
                  </Td>
                  <Td dataLabel="Search">
                    <Button
                      component="a"
                      href={searchUrl}
                      target="_blank"
                      rel="noreferrer"
                      variant="link"
                      isInline
                      icon={<RhUiExternalLinkIcon />}
                      iconPosition="end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      dptools
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </InnerScrollContainer>
    </OuterScrollContainer>
  );
}

function indexToCol(i: number): SortCol {
  const map: Record<number, SortCol> = {
    0: "name",
    2: "rate",
    4: "runs",
    5: "failed",
    6: "flaked",
    7: "prs",
  };
  return map[i] ?? "rate";
}
