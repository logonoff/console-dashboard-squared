"use client";

import styles from "./heatmap.module.css";

const LEGEND = [
  { cls: styles.cellFail, label: "Failed" },
  { cls: styles.cellFlake, label: "Flaked" },
  { cls: styles.cellPass, label: "Passed" },
  { cls: styles.cellSkip, label: "Skipped" },
  { cls: styles.cellAbsent, label: "Not in junit" },
  { cls: styles.cellNodata, label: "No data" },
];

export function HeatmapLegend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "8px 12px",
        flexWrap: "wrap",
        fontSize: 12,
      }}
    >
      {LEGEND.map(({ cls, label }) => (
        <span
          key={label}
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <span
            className={`${styles.cell} ${cls}`}
            style={{ display: "inline-block" }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
