"use client";

import { Tooltip } from "@patternfly/react-core";
import { useState } from "react";
import type { Analysis, SuiteStat } from "@/lib/ci/types";
import styles from "./heatmap.module.css";

interface Props {
  analysis: Analysis;
  metric: "unhealthyRate" | "failureRate" | "flakeRate";
  suiteFilter: string;
  showLowSample: boolean;
  showCiOperator: boolean;
  onSelectSuite: (suite: SuiteStat) => void;
}

function gridCellClass(rate: number): string {
  if (rate === 0) return styles.gridCell0;
  if (rate <= 0.1) return styles.gridCell10;
  if (rate <= 0.25) return styles.gridCell25;
  if (rate <= 0.5) return styles.gridCell50;
  return styles.gridCell100;
}

export function HeatmapGrid({
  analysis,
  metric,
  suiteFilter,
  showLowSample,
  showCiOperator,
  onSelectSuite,
}: Props) {
  const [hovered, setHovered] = useState<SuiteStat | null>(null);

  const visible = analysis.suites.filter((s) => {
    if (!showLowSample && (s.appearedIn < 3 || s.distinctPRs < 2)) return false;
    if (!showCiOperator && s.origin === "ci-operator") return false;
    if (
      suiteFilter &&
      !s.name.toLowerCase().includes(suiteFilter.toLowerCase())
    )
      return false;
    return true;
  });

  const displayRate = (s: SuiteStat): number => s[metric];

  return (
    <div>
      <div className={styles.hoverInfo}>
        {hovered ? (
          <>
            <strong>{hovered.name.split("/").pop()}</strong>{" "}
            {Math.round(displayRate(hovered) * 100)}% unhealthy —{" "}
            {hovered.appearedIn} runs
          </>
        ) : (
          <span style={{ color: "var(--pf-t--global--text--color--subtle)" }}>
            Hover a cell for details · click to open
          </span>
        )}
      </div>
      <div
        role="group"
        className={styles.compactGrid}
        aria-label="Test suite grid"
      >
        {visible.map((suite) => {
          const rate = displayRate(suite);
          return (
            <Tooltip
              key={suite.name}
              content={`${suite.name} — ${Math.round(rate * 100)}%`}
              position="top"
            >
              <button
                type="button"
                className={`${styles.gridCell} ${gridCellClass(rate)}`}
                aria-label={`${suite.name} — ${Math.round(rate * 100)}% ${metric}`}
                onMouseEnter={() => setHovered(suite)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(suite)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelectSuite(suite)}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
