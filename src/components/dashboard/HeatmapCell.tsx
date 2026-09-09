"use client";

import { Tooltip } from "@patternfly/react-core";
import type { CellState } from "@/lib/ci/types";
import styles from "./heatmap.module.css";

const STATE_CLASS: Record<CellState, string> = {
  fail: styles.cellFail,
  flake: styles.cellFlake,
  pass: styles.cellPass,
  skip: styles.cellSkip,
  absent: styles.cellAbsent,
  nodata: styles.cellNodata,
};

const STATE_LABEL: Record<CellState, string> = {
  fail: "failed",
  flake: "flaked",
  pass: "passed",
  skip: "skipped (all)",
  absent: "not in junit",
  nodata: "no data",
};

interface Props {
  state: CellState;
  label: string;
  onClick?: () => void;
}

export function HeatmapCell({ state, label, onClick }: Props) {
  const tooltipContent = `${label} — ${STATE_LABEL[state]}`;
  return (
    <Tooltip content={tooltipContent} position="top">
      <button
        type="button"
        aria-label={tooltipContent}
        className={`${styles.cell} ${STATE_CLASS[state]}`}
        onClick={onClick}
        style={{
          border: "none",
          cursor: onClick ? "pointer" : "default",
          padding: 0,
        }}
      />
    </Tooltip>
  );
}
