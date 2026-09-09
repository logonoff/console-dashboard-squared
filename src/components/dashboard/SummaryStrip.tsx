"use client";

import { Label, LabelGroup } from "@patternfly/react-core";
import type { Analysis } from "@/lib/ci/types";

interface Props {
  analysis: Analysis;
}

export function SummaryStrip({ analysis }: Props) {
  const { counts, windowDays, windowStartIso, windowEndIso, suites } = analysis;
  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--pf-t--global--border--color--default)",
      }}
    >
      <LabelGroup aria-label="Analysis summary" numLabels={10}>
        <Label isCompact color="blue">
          Window: {windowDays}d ({windowStartIso.slice(0, 10)} →{" "}
          {windowEndIso.slice(0, 10)})
        </Label>
        <Label isCompact color="green">
          {counts.analyzed} analyzed
        </Label>
        {counts.excluded > 0 && (
          <Label isCompact color="grey">
            {counts.excluded} excluded (pending/aborted)
          </Label>
        )}
        {counts.noArtifact > 0 && (
          <Label isCompact color="orange">
            {counts.noArtifact} no artifacts
          </Label>
        )}
        {counts.errored > 0 && (
          <Label isCompact color="red">
            {counts.errored} errors
          </Label>
        )}
        <Label isCompact>{suites.length} suites</Label>
      </LabelGroup>
    </div>
  );
}
