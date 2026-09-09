import { dptoolsUrl } from "./links";
import type { Analysis } from "./types";

function abbrev(branch: string): string {
  return branch === "main" ? "main" : branch.replace("release-", "");
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rateLabel(rate: number): string {
  const p = Math.round(rate * 100);
  if (p === 0) return "Healthy";
  if (p <= 10) return "Low flakiness";
  if (p <= 25) return "Moderate";
  if (p <= 50) return "High";
  return "Critical";
}

export function generateCsv(analysis: Analysis): string {
  const headers = [
    "Suite",
    "Branch(es)",
    "Unhealthy %",
    "Failure %",
    "Flake %",
    "Status",
    "Runs",
    "Failed",
    "Flaked",
    "Distinct PRs",
    "Total PRs",
    "Dptools URL",
  ];

  const rows = analysis.suites.map((s) => [
    s.name,
    s.branches.map(abbrev).join(", "),
    Math.round(s.unhealthyRate * 100),
    Math.round(s.failureRate * 100),
    Math.round(s.flakeRate * 100),
    rateLabel(s.unhealthyRate),
    s.appearedIn,
    s.failedIn,
    s.flakedIn,
    s.distinctPRs,
    s.totalPRs,
    dptoolsUrl({
      searchTerm: s.searchTerm,
      jobName: analysis.job.name,
      windowDays: analysis.windowDays,
    }),
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Trigger a browser download of the CSV string. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
