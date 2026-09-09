"use client";

import { Tooltip } from "@patternfly/react-core";
import type { Analysis, SuiteStat } from "@/lib/ci/types";
import { HeatmapCell } from "./HeatmapCell";
import styles from "./heatmap.module.css";

interface Props {
  analysis: Analysis;
  metric: "unhealthyRate" | "failureRate" | "flakeRate";
  suiteFilter: string;
  showLowSample: boolean;
  showCiOperator: boolean;
  onSelectSuite: (suite: SuiteStat) => void;
}

const MAX_SUITES = 150;

function rateTintClass(rate: number): string {
  if (rate >= 0.25) return styles.rateTintHigh;
  if (rate >= 0.1) return styles.rateTintMed;
  return styles.rateTintLow;
}

export function HeatmapMatrix({
  analysis,
  metric,
  suiteFilter,
  showLowSample,
  showCiOperator,
  onSelectSuite,
}: Props) {
  const { builds, suites } = analysis;

  const visible = suites
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
    .slice(0, MAX_SUITES);

  const runCount = builds.length;
  const cssVars = { "--run-count": runCount } as React.CSSProperties;

  const formatDate = (iso: string): string => {
    if (!iso) return "?";
    const d = new Date(iso);
    return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  };

  return (
    <div
      role="grid"
      className={styles.matrix}
      style={cssVars}
      aria-label="Test suite failure matrix"
    >
      {/* Header row */}
      <div role="row" className={styles.matrixHeader}>
        <div role="columnheader" className={styles.headerLabel}>
          Suite / spec
        </div>
        <div role="columnheader" className={styles.headerRate}>
          Rate (k/n)
        </div>
        {builds.map((b) => (
          <Tooltip
            key={b.id}
            content={`${b.id} — ${b.startedIso} — PR #${b.prNumber ?? "?"}`}
            position="top"
          >
            <div role="columnheader" className={styles.headerDate}>
              {formatDate(b.startedIso)}
            </div>
          </Tooltip>
        ))}
      </div>

      {/* Data rows */}
      {visible.map((suite) => {
        const rate = suite[metric];
        const shown =
          metric === "failureRate"
            ? suite.failedIn
            : metric === "flakeRate"
              ? suite.flakedIn
              : suite.failedIn + suite.flakedIn;
        const pct = Math.round(rate * 100);
        return (
          <div key={suite.name} role="row" className={styles.matrixRow}>
            {/* Label */}
            <Tooltip content={suite.name} position="right">
              <div
                role="gridcell"
                className={styles.rowLabel}
                onClick={() => onSelectSuite(suite)}
                onKeyDown={(e) => e.key === "Enter" && onSelectSuite(suite)}
                tabIndex={0}
              >
                {suite.name.split("/").pop() ?? suite.name}
              </div>
            </Tooltip>
            {/* Rate column */}
            <div
              role="gridcell"
              className={`${styles.rateCell} ${rateTintClass(rate)}`}
            >
              {pct}% ({shown}/{suite.appearedIn})
            </div>
            {/* Per-run cells */}
            {builds.map((b) => (
              <HeatmapCell
                key={b.id}
                state={suite.cells[b.id] ?? "nodata"}
                label={`${suite.name.split("/").pop()} — build ${b.id}`}
                onClick={() => onSelectSuite(suite)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
