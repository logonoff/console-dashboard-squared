"use client";

import {
  Charts,
  type ChartsOptionProps,
} from "@patternfly/react-charts/echarts";
import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  EmptyState,
  EmptyStateBody,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Title,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { use as registerCharts } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  timingAttemptLabel as attemptLabel,
  crpChartRows,
  crpLoadOption,
  crpTrendOption,
  crpTrendRows,
  timingDateLabel as dateLabel,
  formatTimingMs as formatMs,
} from "@/lib/ci/crpCharts";
import { summarizeTiming, timingDuration } from "@/lib/ci/crpTimings";
import type { CrpTimingAnalysis } from "@/lib/ci/types";
import styles from "./crpTimings.module.css";

registerCharts([
  LineChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  SVGRenderer,
]);

function TimingChart({
  option,
  label,
}: {
  option: ChartsOptionProps;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={styles.chart} role="img" aria-label={label}>
      {width > 0 && (
        <Charts
          option={option}
          height={340}
          width={width}
          nodeSelector="html"
          isLegendTooltip={false}
        />
      )}
    </div>
  );
}

export function CrpTimingsView({ analysis }: { analysis: CrpTimingAnalysis }) {
  const [metric, setMetric] = useState("sum");
  const [hideRunsWithoutTimings, setHideRunsWithoutTimings] = useState(false);
  const [selectedBuildId, setSelectedBuildId] = useState("");
  const [selectedRetry, setSelectedRetry] = useState<number | null>(null);
  const rows = useMemo(() => crpChartRows(analysis), [analysis]);
  const available = rows.filter((row) => row.latest);
  const metricNames = useMemo(
    () =>
      [
        ...new Set(
          analysis.results.flatMap((result) =>
            result.attempts.flatMap((attempt) =>
              attempt.loads.flatMap((load) => load.map((entry) => entry.name)),
            ),
          ),
        ),
      ].sort((a, b) =>
        a === "sum" ? -1 : b === "sum" ? 1 : a.localeCompare(b),
      ),
    [analysis.results],
  );
  const activeMetric = metricNames.includes(metric) ? metric : metricNames[0];
  const trendRows = useMemo(
    () => crpTrendRows(rows, activeMetric, hideRunsWithoutTimings),
    [rows, activeMetric, hideRunsWithoutTimings],
  );
  const selected =
    available.find((row) => row.build.id === selectedBuildId) ??
    available.at(-1);
  const attempt =
    selected?.result?.attempts.find((entry) => entry.retry === selectedRetry) ??
    selected?.latest;
  const loads =
    attempt?.loads.map((timings, i) => ({ number: i + 1, timings })) ?? [];
  const summary = attempt ? summarizeTiming(attempt, activeMetric) : null;
  const errors = rows.filter((row) => row.result?.error);

  const trendOption = useMemo(
    () => crpTrendOption(trendRows, activeMetric),
    [trendRows, activeMetric],
  );
  const loadOption = useMemo(
    () => crpLoadOption(attempt, activeMetric),
    [attempt, activeMetric],
  );

  return (
    <div className={styles.view}>
      <Title headingLevel="h2" size="xl">
        CRP-blame timings
      </Title>
      <p>
        Cluster dashboard timings for the selected Console job and time window.
        Durations are in milliseconds.
      </p>
      {errors.length > 0 && (
        <Alert
          isInline
          variant="warning"
          title={`Timing artifacts could not be fully read for ${errors.length} runs`}
        >
          <details>
            <summary>Show fetch and parsing errors</summary>
            {errors.map(({ build, result }) => (
              <p key={build.id}>
                Build {build.id}: {result?.error}
              </p>
            ))}
          </details>
        </Alert>
      )}
      {available.length === 0 ? (
        <EmptyState titleText="No CRP-blame timings found" headingLevel="h3">
          <EmptyStateBody>
            No recorded timings were found in {analysis.builds.length} runs.
            Choose a Console Playwright job that runs the repeated
            cluster-dashboard loading test (e.g. e2e-gcp-console), or expand the
            time window.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <>
          <p>
            {available.length} of {rows.length} runs have timings ·{" "}
            {analysis.results.reduce(
              (count, result) => count + result.attempts.length,
              0,
            )}{" "}
            recorded attempts
          </p>
          <FormGroup label="Timing" fieldId="crp-timing-metric">
            <FormSelect
              id="crp-timing-metric"
              aria-label="CRP timing"
              value={activeMetric}
              onChange={(_event, value) => setMetric(value)}
            >
              {metricNames.map((name) => (
                <FormSelectOption
                  key={name}
                  value={name}
                  label={name === "sum" ? "Recorded sum" : name}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <Card>
            <CardTitle>Mean duration across runs</CardTitle>
            <CardBody>
              <Checkbox
                id="crp-hide-runs-without-timings"
                label="Hide runs without timings"
                description="Only show runs with measurements for the selected timing."
                isChecked={hideRunsWithoutTimings}
                onChange={(_event, checked) =>
                  setHideRunsWithoutTimings(checked)
                }
              />
              <p>
                Showing {trendRows.length} of {rows.length} runs.
              </p>
              <p>
                Each point averages the repeated loads from the latest attempt
                with a timing artifact. Missing measurements leave gaps. Hover
                for the build, PR, attempt, and range.
              </p>
              <TimingChart
                option={trendOption}
                label={`Mean ${activeMetric} duration across runs`}
              />
            </CardBody>
          </Card>
          <Card>
            <CardTitle>Repeated loads</CardTitle>
            <CardBody>
              <div className={styles.selectors}>
                <FormGroup label="Run" fieldId="crp-run">
                  <FormSelect
                    id="crp-run"
                    aria-label="CRP run"
                    value={selected?.build.id}
                    onChange={(_event, value) => {
                      setSelectedBuildId(value);
                      setSelectedRetry(null);
                    }}
                  >
                    {available.toReversed().map(({ build }) => (
                      <FormSelectOption
                        key={build.id}
                        value={build.id}
                        label={`${dateLabel(build)} · PR ${build.prNumber ?? "—"} · ${build.baseRef} · ${build.id}`}
                      />
                    ))}
                  </FormSelect>
                </FormGroup>
                <FormGroup label="Attempt" fieldId="crp-attempt">
                  <FormSelect
                    id="crp-attempt"
                    aria-label="CRP attempt"
                    value={attempt?.retry}
                    onChange={(_event, value) =>
                      setSelectedRetry(Number(value))
                    }
                  >
                    {selected?.result?.attempts.map((entry) => (
                      <FormSelectOption
                        key={entry.retry}
                        value={entry.retry}
                        label={attemptLabel(entry.retry)}
                      />
                    ))}
                  </FormSelect>
                </FormGroup>
              </div>
              {summary ? (
                <p>
                  Mean {formatMs(summary.mean)} · Min {formatMs(summary.min)} ·
                  Max {formatMs(summary.max)} · {summary.count} loads
                </p>
              ) : (
                <p>This attempt has no measurements for the selected timing.</p>
              )}
              <TimingChart
                option={loadOption}
                label={`${activeMetric} duration per repeated load`}
              />
              {attempt && (
                <a
                  href={`https://gcs.ci.openshift.org/gcs/test-platform-results-public/${attempt.sourcePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source timing JSON
                </a>
              )}
              <details className={styles.measurements}>
                <summary>All recorded timings for this attempt</summary>
                <p>
                  Repeated occurrences of the same component are added within a
                  load. The recorded sum includes measurements that may overlap.
                </p>
                <div className={styles.table}>
                  <Table
                    variant="compact"
                    aria-label="CRP timings for each page load"
                  >
                    <Thead>
                      <Tr>
                        <Th>Timing</Th>
                        {loads.map((load) => (
                          <Th key={load.number}>Load {load.number}</Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {metricNames.map((name) => (
                        <Tr key={name}>
                          <Th scope="row">{name}</Th>
                          {loads.map((load) => (
                            <Td key={load.number}>
                              {formatMs(timingDuration(load.timings, name))}
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              </details>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
