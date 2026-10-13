import { getCache } from "@/lib/cache";
import { hourBucket, keys, TTL } from "@/lib/cache/keys";
import { fetchCatalog } from "@/lib/ci/catalog";
import { pool } from "@/lib/ci/concurrency";
import { parseCrpBuild } from "@/lib/ci/crp";
import {
  crpChartRows,
  crpLoadOption,
  crpTrendOption,
  crpTrendRows,
  timingAttemptLabel,
} from "@/lib/ci/crpCharts";
import { renderCrpPng } from "@/lib/ci/crpPng";
import { loadCrpTimings } from "@/lib/ci/crpService";
import { summarizeTiming } from "@/lib/ci/crpTimings";
import { gcsGetText } from "@/lib/ci/gcs";
import { fetchBuildsInWindow } from "@/lib/ci/prow";
import {
  branchFromJobName,
  jobNameRE,
  REPOSITORIES,
} from "@/lib/ci/repository";
import type { Build } from "@/lib/ci/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const GRAPH_MAX_PAGES = 32;
const GRAPH_MAX_RUNS = 512;

class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function integer(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new GraphError(
      `${name} must be an integer between ${min} and ${max}`,
      400,
    );
  }
  return Number(raw);
}

function boolean(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  if (value === null || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new GraphError(`${name} must be 0, 1, false, or true`, 400);
}

async function explicitBuild(
  job: string,
  pr: string,
  id: string,
): Promise<Build> {
  const prefix = `pr-logs/pull/openshift_console/${pr}/${job}/${id}/`;
  const validated = parseCrpBuild(
    { id, objectPrefix: prefix, result: "SUCCESS" },
    job,
  );
  const [startedText, finishedText] = await Promise.all([
    gcsGetText(`${prefix}started.json`),
    gcsGetText(`${prefix}finished.json`),
  ]);
  if (!startedText) throw new GraphError("Build not found", 404);
  if (!finishedText) throw new GraphError("Build has not finished", 409);
  const started = JSON.parse(startedText) as { timestamp?: unknown };
  const finished = JSON.parse(finishedText) as { result?: unknown };
  if (
    typeof started.timestamp !== "number" ||
    !Number.isFinite(started.timestamp) ||
    started.timestamp < 0 ||
    started.timestamp > 8640000000000
  ) {
    throw new GraphError("Invalid build start timestamp", 502);
  }
  const startedMs = started.timestamp * 1000;
  return {
    ...parseCrpBuild({ ...validated, result: finished.result }, job),
    jobName: job,
    startedMs,
    startedIso: new Date(startedMs).toISOString(),
    durationMs: 0,
    prNumber: Number(pr),
    prTitle: null,
    prAuthor: null,
    baseRef: branchFromJobName(REPOSITORIES["openshift/console"], job) ?? "",
    spyglassUrl: `https://prow.ci.openshift.org/view/gs/test-platform-results-public/${prefix}`,
  };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  try {
    const repo = REPOSITORIES["openshift/console"];
    if (params.has("repo") && params.get("repo") !== repo.repo)
      throw new GraphError(
        "CRP graphs are only available for openshift/console",
        400,
      );
    const job = params.get("job") ?? "";
    if (!jobNameRE(repo).test(job))
      throw new GraphError("Invalid Console job", 400);
    const view = params.get("view") ?? "trend";
    if (view !== "trend" && view !== "loads")
      throw new GraphError("view must be trend or loads", 400);
    const metric = params.get("metric") ?? "sum";
    if (!metric.trim() || metric.length > 500)
      throw new GraphError("Invalid timing metric", 400);
    const days = integer(params, "days", 14, 1, 90);
    const width = integer(params, "width", 1200, 640, 2400);
    const height = integer(params, "height", 600, 320, 1400);
    const hideWithoutTimings = boolean(params, "hideWithoutTimings");
    const force = boolean(params, "force");
    const retry = params.has("retry")
      ? integer(params, "retry", 0, 0, 1000)
      : null;
    const id = params.get("buildId");
    const pr = params.get("pr");
    if (
      (id === null) !== (pr === null) ||
      (id !== null &&
        (!/^\d{15,25}$/.test(id) || !/^[1-9]\d{0,8}$/.test(pr ?? "")))
    ) {
      throw new GraphError(
        "buildId (15–25 digits) and pr (positive integer) must be supplied together",
        400,
      );
    }
    if (view === "trend" && (id !== null || retry !== null))
      throw new GraphError("buildId, pr, and retry require view=loads", 400);

    const cache = getCache();
    const catalog = await cache.getOrLoad(
      keys.catalog(repo.repo),
      TTL.CATALOG,
      () => fetchCatalog(repo),
    );
    if (
      !catalog.some((branch) => branch.jobs.some((entry) => entry.name === job))
    )
      throw new GraphError(`Unknown job: ${job}`, 400);
    let builds: Build[];
    let historyTruncated = false;
    if (id !== null && pr !== null) {
      builds = [await explicitBuild(job, pr, id)];
    } else {
      const cutoffMs = Date.now() - days * 86400000;
      const bucket = hourBucket(cutoffMs);
      // Reuse complete dashboard history, but not its eight-page partial cache.
      const cachedRuns = force
        ? undefined
        : await cache.get<Awaited<ReturnType<typeof fetchBuildsInWindow>>>(
            keys.runs(job, days, bucket),
          );
      const runs =
        cachedRuns && !cachedRuns.truncated
          ? cachedRuns
          : await cache.getOrLoad(
              keys.graphRuns(job, days, bucket),
              TTL.RUNS,
              () =>
                fetchBuildsInWindow({
                  jobName: job,
                  cutoffMs,
                  maxPages: GRAPH_MAX_PAGES,
                }),
              { force },
            );
      historyTruncated = runs.truncated || runs.builds.length > GRAPH_MAX_RUNS;
      builds = runs.builds
        .toSorted((a, b) => b.startedMs - a.startedMs)
        .slice(0, GRAPH_MAX_RUNS)
        .map((build) => ({
          ...build,
          ...parseCrpBuild(build, job),
        }));
    }
    const results = await pool(
      builds.map((build) => () => loadCrpTimings(build, force)),
      4,
    );
    // An exported image has no error drawer; report incomplete data explicitly.
    const errors = results.filter((result) => result.error);
    if (errors.length)
      throw new GraphError(
        `Could not read timing data for ${errors.length} runs: ${errors[0].error}`,
        502,
      );
    const rows = crpChartRows({ builds, results });
    const trendRows = crpTrendRows(rows, metric, hideWithoutTimings);
    const selected = rows.filter((row) => row.latest).at(-1);
    const attempt =
      retry === null
        ? selected?.latest
        : selected?.result?.attempts.find((entry) => entry.retry === retry);
    const hasData =
      view === "trend"
        ? trendRows.some((row) => row.stats !== null)
        : attempt && summarizeTiming(attempt, metric);
    if (!hasData)
      throw new GraphError(
        "No timings found for the requested graph, metric, or retry",
        404,
      );
    const option =
      view === "trend"
        ? crpTrendOption(trendRows, metric, {
            timeZone: "UTC",
            textColor: "#151515",
            interactive: false,
          })
        : crpLoadOption(attempt, metric, "#151515");
    const title =
      view === "trend"
        ? "CRP-blame: mean duration across runs"
        : "CRP-blame: repeated page loads";
    const context =
      (view === "trend"
        ? `${trendRows.length} runs · ${days} days requested · UTC`
        : `Build ${selected?.build.id} · ${timingAttemptLabel(attempt?.retry ?? 0)}`) +
      (historyTruncated ? " · History truncated" : "");
    const png = await renderCrpPng(option, {
      width,
      height,
      title,
      subtitle: `${metric}\n${job}\n${context}`,
    });
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="crp-timings-${view}.png"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-CI-History-Truncated": String(historyTruncated),
        "X-CI-Runs-Analyzed": String(builds.length),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: err instanceof GraphError ? err.status : 502 },
    );
  }
}
