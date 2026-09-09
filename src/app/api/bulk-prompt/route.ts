/**
 * GET /api/bulk-prompt
 *
 * Returns a ready-to-paste LLM triage prompt as text/markdown.
 * Intended for programmatic use (Claude skills, scripts, CI automation).
 *
 * Query parameters:
 *   repo   Repository slug (required). e.g. openshift/console
 *   job    Full prow job name (single-branch mode).
 *          e.g. pull-ci-openshift-console-release-5.0-e2e-gcp-console
 *   suffix Job suffix common to all branches (aggregate mode).
 *          e.g. e2e-gcp-console  — fetches every branch that has this suffix.
 *   days   Window in days (1–90, default 14).
 *   force  Set to "1" to bypass the immutable run cache.
 *
 * Exactly one of `job` or `suffix` is required.
 * Returns 400 on invalid input, 404 when no jobs match suffix.
 * Returns text/markdown on success.
 *
 * Example (single branch):
 *   curl "http://localhost:3000/api/bulk-prompt?repo=openshift/console&job=pull-ci-openshift-console-release-5.0-e2e-gcp-console&days=14"
 *
 * Example (aggregate):
 *   curl "http://localhost:3000/api/bulk-prompt?repo=openshift/console&suffix=e2e-gcp-console&days=14"
 */

import { getCache } from "@/lib/cache";
import { keys, TTL } from "@/lib/cache/keys";
import { aggregate } from "@/lib/ci/aggregate";
import { analyzeBuild } from "@/lib/ci/analyze";
import { fetchCatalog } from "@/lib/ci/catalog";
import { pool } from "@/lib/ci/concurrency";
import { AGGREGATE_BRANCH } from "@/lib/ci/constants";
import { resolveDevVersion } from "@/lib/ci/devVersion";
import { fetchBuildsInWindow } from "@/lib/ci/prow";
import {
  aggregateJobPattern,
  jobNameRE,
  parseRepoParam,
} from "@/lib/ci/repository";
import type { Build, JobRef, RunResult } from "@/lib/ci/types";
import { generateBulkTriagePrompt } from "@/lib/jira/bulkPrompt";

export const maxDuration = 60;

const CONCURRENCY = Number(process.env.CI_MAX_CONCURRENCY ?? "6");
const SUFFIX_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobParam = url.searchParams.get("job");
  const suffixParam = url.searchParams.get("suffix");
  const days = Math.max(
    1,
    Math.min(90, Number(url.searchParams.get("days") ?? "14")),
  );
  const force = url.searchParams.get("force") === "1";

  const repoSlug = url.searchParams.get("repo") ?? "";
  const repo = parseRepoParam(repoSlug);
  if (!repo) {
    return Response.json(
      { error: `Unknown repo "${repoSlug}"` },
      { status: 400 },
    );
  }

  if (!jobParam && !suffixParam) {
    return Response.json(
      { error: "Provide either ?job=<full-job-name> or ?suffix=<job-suffix>" },
      { status: 400 },
    );
  }
  if (jobParam && suffixParam) {
    return Response.json(
      { error: "Provide only one of job or suffix, not both" },
      { status: 400 },
    );
  }

  const cache = getCache();
  const branches = await cache.getOrLoad(
    keys.catalog(repo.repo),
    TTL.CATALOG,
    () => fetchCatalog(repo),
  );

  let jobRefs: JobRef[];
  let effectiveJob: JobRef;

  if (suffixParam) {
    if (!SUFFIX_RE.test(suffixParam)) {
      return Response.json({ error: "Invalid suffix" }, { status: 400 });
    }
    jobRefs = branches.flatMap((b) =>
      b.jobs.filter((j) => j.suffix === suffixParam),
    );
    if (jobRefs.length === 0) {
      return Response.json(
        { error: `No jobs found with suffix: ${suffixParam}` },
        { status: 404 },
      );
    }
    effectiveJob = {
      branch: AGGREGATE_BRANCH,
      suffix: suffixParam,
      name: aggregateJobPattern(repo, suffixParam),
      lastRunIso: null,
    };
  } else {
    if (!jobNameRE(repo).test(jobParam ?? "")) {
      return Response.json({ error: "Invalid job name" }, { status: 400 });
    }
    const found = branches
      .flatMap((b) => b.jobs)
      .find((j) => j.name === jobParam);
    if (!found) {
      return Response.json(
        { error: `Unknown job: ${jobParam}` },
        { status: 400 },
      );
    }
    jobRefs = [found];
    effectiveJob = found;
  }

  // Fetch builds for all relevant job refs in parallel
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const buildArrays = await Promise.all(
    jobRefs.map((jr) =>
      fetchBuildsInWindow({ jobName: jr.name, cutoffMs }).then((r) => r.builds),
    ),
  );
  const allBuilds: Build[] = buildArrays.flat();

  // Analyze all builds with bounded concurrency, respecting the immutable cache
  const tasks = allBuilds.map((build) => async (): Promise<RunResult> => {
    if (!force) {
      const cached = await cache.get<RunResult>(keys.runResult(build.id));
      if (cached) return cached;
    }
    const result = await analyzeBuild(build);
    if (result.prowResult !== "PENDING") {
      await cache.set(keys.runResult(build.id), result, TTL.IMMUTABLE);
    }
    return result;
  });
  const runs = await pool(tasks, CONCURRENCY);

  const analysis = aggregate(effectiveJob, allBuilds, runs, days, repo);

  const devVersion = await cache.getOrLoad(
    keys.devVersion(repo.repo),
    TTL.DEV_VERSION,
    () => resolveDevVersion(repo),
  );

  const prompt = generateBulkTriagePrompt(analysis, devVersion, repo);
  const slug = suffixParam ?? effectiveJob.suffix;
  const filename = `bulk-triage-${slug}-${days}d.md`;

  return new Response(prompt, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
