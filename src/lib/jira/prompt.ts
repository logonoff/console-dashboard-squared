/**
 * Deterministic markdown prompt generator for OCPBUGS triage.
 * No network calls, no LLM — pure string interpolation.
 */

import path from "node:path";
import { branchToJiraVersion } from "@/lib/ci/devVersion";
import { jiraSearchUrl } from "@/lib/ci/links";
import type { Repository } from "@/lib/ci/repository";
import type { Analysis, DevVersionResult, SuiteStat } from "@/lib/ci/types";
import { JIRA } from "./constants";

export interface PromptInput {
  analysis: Analysis;
  suite: SuiteStat;
  devVersion: DevVersionResult;
  repo: Repository;
  /** Override the inferred Jira version (required when branch is main and devVersion is unavailable) */
  versionOverride?: string;
  nowIso?: string;
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 160);
}

function pct(rate: number): number {
  return Math.round(rate * 100);
}

function jiraVersion(input: PromptInput): string | null {
  if (input.versionOverride) return input.versionOverride;
  return branchToJiraVersion(input.analysis.job.branch, input.devVersion);
}

function narrowJql(
  componentName: string,
  opts: {
    suiteSearchToken: string;
    version: string;
    versionShort: string;
    versionZ: string;
  },
): string {
  return (
    `project = OCPBUGS AND issuetype = Bug AND component = "${componentName}"` +
    ` AND text ~ "${opts.suiteSearchToken}"` +
    ` AND affectedVersion in ("${opts.version}", "${opts.versionShort}", "${opts.versionZ}")` +
    ` AND status not in (Closed, "Release Pending") ORDER BY created DESC`
  );
}

function broadJql(componentName: string): string {
  return (
    `project = OCPBUGS AND component = "${componentName}"` +
    ` AND labels in (ci-watch, automated, ci-watcher) AND created >= -60d ORDER BY created DESC`
  );
}

export function generateBugPrompt(input: PromptInput): {
  markdown: string;
  jqlUrl: string;
  dptoolsAlreadyLinked: boolean;
} {
  const { analysis, suite, repo } = input;
  const component =
    JIRA.components[repo.component as keyof typeof JIRA.components] ??
    ({ id: "0", name: repo.component } as const);
  const nowIso = input.nowIso ?? new Date().toISOString();
  const { job } = analysis;

  const jiraVer = jiraVersion(input);
  // e.g. "5.0" → short; "5.0.z" → z variant
  const versionShort = jiraVer?.replace(/\.\d+$/, "") ?? "⚠️ SET MANUALLY";
  const versionZ = versionShort ? `${versionShort}.z` : "⚠️ SET MANUALLY";
  const version = jiraVer ?? "⚠️ SET MANUALLY";

  const suiteSearchToken = path.posix.basename(suite.searchTerm);
  const summaryTitle = `[ci-watcher]: ${job.branch} - ${suite.name} has ${pct(suite.failureRate)}% failure rate`;
  const summaryFits = summaryTitle.length <= 120;
  const summary = summaryFits
    ? summaryTitle
    : `[ci-watcher]: ${job.branch} - ${path.posix.basename(suite.name)} has ${pct(suite.failureRate)}% failure rate`;

  const sampleRuns = suite.failingBuildIds.slice(0, 5).map((bid) => {
    const build = analysis.builds.find((b) => b.id === bid);
    return {
      buildId: bid,
      startedIso: build?.startedIso ?? "",
      prNumber: build?.prNumber,
      spyglassUrl: build?.spyglassUrl ?? "",
    };
  });

  const excludedTotal = analysis.counts.excluded + analysis.counts.noArtifact;

  const narrowQ = narrowJql(component.name, {
    suiteSearchToken,
    version,
    versionShort,
    versionZ,
  });
  const jqlUrlStr = jiraSearchUrl(narrowQ);

  const failureCases = suite.topCases
    .map((tc) => {
      const msgs = tc.messages
        .map(
          (m) =>
            `  - \`${escapeTableCell(m.message)}\` (${m.type ?? "failure"}) × ${m.count}`,
        )
        .join("\n");
      return `- \`${tc.name}\` — failed in ${tc.failedIn}/${suite.appearedIn} runs\n${msgs}`;
    })
    .join("\n");

  const sampleRunLines = sampleRuns
    .map(
      (r) =>
        `- \`${r.buildId}\` — ${r.startedIso} — PR #${r.prNumber ?? "?"} — ${r.spyglassUrl}`,
    )
    .join("\n");

  const createPayload = JSON.stringify(
    {
      fields: {
        project: { id: JIRA.project.id },
        issuetype: { id: JIRA.issueType.bug.id },
        reporter: { id: "<resolve to the current user's accountId>" },
        summary,
        components: [{ id: component.id }],
        versions: [{ name: version }],
        [JIRA.fields.targetVersion]: [{ name: version }],
        labels: [JIRA.labels.automated, JIRA.labels.ciWatch],
      },
    },
    null,
    2,
  );

  const markdown = `# OCPBUGS triage — ${repo.name} CI watcher

You are triaging an OpenShift Console CI test failure. Follow the steps in order.
Use ONLY the facts below — do not invent data, do not guess a root cause.

## Facts (generated ${nowIso})

| Field | Value |
| --- | --- |
| Repo | \`${repo.repo}\` |
| Branch | \`${job.branch}\` |
| Prow job | \`${job.name}\` |
| Test suite | \`${suite.name}\` |
| Window | last ${analysis.windowDays} days (${analysis.windowStartIso} → ${analysis.windowEndIso}) |
| Builds in window | ${analysis.counts.total} |
| Builds analyzed (SUCCESS/FAILURE with junit) | ${analysis.counts.analyzed} |
| Builds excluded (pending/aborted/error/no artifact) | ${excludedTotal} |
| Runs where this suite executed | ${suite.appearedIn} |
| Runs with ≥1 hard test failure | ${suite.failedIn} |
| Runs that only flaked (failed then passed on retry) | ${suite.flakedIn} |
| **Hard failure rate** | **${pct(suite.failureRate)}%** (${suite.failedIn}/${suite.appearedIn}) |
| Flake rate | ${pct(suite.flakeRate)}% (${suite.flakedIn}/${suite.appearedIn}) |
| Unhealthy rate (fail + flake) | ${pct(suite.unhealthyRate)}% |

### Failing test cases (final outcome = fail), most frequent first
${failureCases || "_No hard failures recorded (all were flakes)._"}

### Sample failing runs (newest first, max 5)
${sampleRunLines || "_No failing run samples available._"}

---

## Step 1 — look for an existing bug. Do NOT create anything yet.

Run both JQL queries against \`${JIRA.siteUrl}\`
(cloudId \`${JIRA.cloudId}\`).

Narrow:
\`\`\`jql
${narrowQ}
\`\`\`

Broad (catches differently-worded ci-watcher bugs):
\`\`\`jql
${broadJql(component.name)}
\`\`\`

**If a match exists:** add a comment containing the Facts table and the sample run links.
Update the summary's percentage only if it moved by more than 10 points.
Do not open a duplicate. Stop here.

---

## Step 2 — only if Step 1 found nothing: create the bug.

Summary (use exactly this string):
\`\`\`
${summary}
\`\`\`

\`POST ${JIRA.siteUrl}/rest/api/3/issue\`
\`\`\`json
${createPayload}
\`\`\`

Field notes:
- \`${JIRA.fields.targetVersion}\` = **Target Version** (array of version objects). Verified on OCPBUGS-97600.
- \`${JIRA.fields.releaseBlocker}\` = **Release Blocker**. Leave unset unless hard failure rate exceeds 80%.
- Required create fields for OCPBUGS: \`project\`, \`issuetype\`, \`reporter\`, \`summary\`, \`versions\`.
- Set versions by \`{"name": …}\`, not by id — names are stable across projects.
- Description: convert the Facts table, failing-case list, sample run links and the dptools URL into ADF. Keep the wording; do not editorialise.

## Step 3 — do not do any of these
- Do not set priority, sprint, assignee, or fix version.
- Do not link to unrelated issues.
- Do not assert a root cause. State only what the CI data shows.
- Do not file more than one bug for this suite.
`;

  return { markdown, jqlUrl: jqlUrlStr, dptoolsAlreadyLinked: false };
}
