/**
 * Bulk OCPBUGS triage prompt — covers all suites with unhealthy rate >= 10%.
 * Instructs an LLM to dedup against JIRA and create bugs for new failures.
 * No network calls, no LLM — pure string interpolation.
 */

import { AGGREGATE_BRANCH } from "@/lib/ci/constants";
import { branchToJiraVersion } from "@/lib/ci/devVersion";
import { dptoolsUrl } from "@/lib/ci/links";
import type { Repository } from "@/lib/ci/repository";
import type { Analysis, DevVersionResult } from "@/lib/ci/types";
import { JIRA } from "./constants";

const UNHEALTHY_THRESHOLD = 0.1;

function pct(rate: number): number {
  return Math.round(rate * 100);
}

function abbrev(branch: string): string {
  return branch === "main" ? "main" : branch.replace("release-", "");
}

function escMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/`/g, "'");
}

export function generateBulkTriagePrompt(
  analysis: Analysis,
  devVersion: DevVersionResult,
  repo: Repository,
): string {
  const component =
    JIRA.components[repo.component as keyof typeof JIRA.components] ??
    ({ id: "0", name: repo.component } as const);
  const { job, counts, windowDays, windowStartIso, windowEndIso } = analysis;
  const nowIso = new Date().toISOString();

  const isAggregate = job.branch === AGGREGATE_BRANCH;

  // Version resolution — indeterminate in aggregate mode
  const jiraVer = isAggregate
    ? null
    : (branchToJiraVersion(job.branch, devVersion) ?? null);
  const versionStr =
    jiraVer ?? "⚠️ DETERMINE PER BRANCH (see Branch(es) column)";
  const versionShort = jiraVer ? jiraVer.replace(/\.\d+$/, "") : "⚠️";
  const versionZ = jiraVer ? `${versionShort}.z` : "⚠️";

  const actionable = analysis.suites.filter(
    (s) => s.unhealthyRate >= UNHEALTHY_THRESHOLD,
  );

  const tableRows = actionable
    .map((s, i) => {
      const branches = s.branches.map(abbrev).join(", ");
      const url = dptoolsUrl({
        searchTerm: s.searchTerm,
        jobName: job.name,
        windowDays,
      });
      return (
        `| ${i + 1} ` +
        `| \`${escMd(s.name)}\` ` +
        `| ${branches} ` +
        `| ${pct(s.unhealthyRate)} ` +
        `| ${pct(s.failureRate)} ` +
        `| ${pct(s.flakeRate)} ` +
        `| ${s.appearedIn} ` +
        `| ${s.failedIn} ` +
        `| ${s.flakedIn} ` +
        `| [search](${url}) |`
      );
    })
    .join("\n");

  const versionAggregateNote = isAggregate
    ? `\n> **Aggregate mode**: determine the JIRA version per suite from its Branch(es) column:
> - \`main\` → current dev version + \`.0\` (check \`/api/dev-version\` or the dashboard header)
> - \`release-X.Y\` at or above dev version → \`X.Y.0\`
> - \`release-X.Y\` below dev version → \`X.Y.z\`\n`
    : "";

  const createTemplate = JSON.stringify(
    {
      fields: {
        project: { id: JIRA.project.id },
        issuetype: { id: JIRA.issueType.bug.id },
        reporter: { id: "<resolve current user accountId — once per session>" },
        summary: `[ci-watcher]: ${isAggregate ? "<branch>" : job.branch} - <Suite name> has <Failure %>% failure rate`,
        components: [{ id: component.id }],
        versions: [
          { name: isAggregate ? "<version for this branch>" : jiraVer },
        ],
        [JIRA.fields.targetVersion]: [
          { name: isAggregate ? "<version for this branch>" : jiraVer },
        ],
        labels: [JIRA.labels.automated, JIRA.labels.ciWatch],
      },
    },
    null,
    2,
  );

  const broadJql =
    `project = OCPBUGS AND component = "${component.name}"` +
    ` AND labels in (ci-watch, automated, ci-watcher) AND created >= -60d ORDER BY created DESC`;

  const narrowJqlTemplate =
    `project = OCPBUGS AND issuetype = Bug AND component = "${component.name}"\n` +
    `  AND text ~ "<basename of suite path>"\n` +
    (isAggregate
      ? `  AND affectedVersion in ("<version>", "<versionShort>", "<versionZ>")\n`
      : `  AND affectedVersion in ("${jiraVer}", "${versionShort}", "${versionZ}")\n`) +
    `  AND status not in (Closed, "Release Pending") ORDER BY created DESC`;

  return `# OCPBUGS bulk triage — ${repo.name} CI watcher

You are triaging **${actionable.length}** ${repo.name} CI test suite(s) that have an unhealthy rate ≥ ${UNHEALTHY_THRESHOLD * 100}%.
Process each suite in order. Use ONLY the data provided. Do not invent root causes or guess at fixes.

## Context (generated ${nowIso})

| Field | Value |
| --- | --- |
| Repo | \`${repo.repo}\` |
| Branch | \`${job.branch}\` |
| Prow job | \`${job.name}\` |
| Window | last ${windowDays} days (${windowStartIso.slice(0, 10)} → ${windowEndIso.slice(0, 10)}) |
| Builds total | ${counts.total} |
| Builds analyzed (SUCCESS/FAILURE with junit) | ${counts.analyzed} |
| Builds excluded (pending/aborted/no artifact) | ${counts.excluded + counts.noArtifact} |
| Target JIRA version | \`${versionStr}\` |
| Suites to process (unhealthy ≥ ${UNHEALTHY_THRESHOLD * 100}%) | **${actionable.length}** of ${analysis.suites.length} total |
${versionAggregateNote}
## Suite data (sorted by impact, highest unhealthy rate first)

| # | Suite | Branch(es) | Unhealthy % | Failure % | Flake % | Runs | Failed | Flaked | dptools |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
${tableRows || "_(no suites meet the threshold)_"}

---

## Processing instructions

### Step 0 — run the broad dedup check ONCE before processing any suites

Run this JQL against \`${JIRA.siteUrl}\` and keep the result set in memory for the session:

\`\`\`jql
${broadJql}
\`\`\`

---

### Step 1 — for EACH suite in the table, in order

Repeat the following sequence for every row:

#### 1a. Narrow dedup check

\`\`\`jql
${narrowJqlTemplate}
\`\`\`

Also scan the Step 0 broad results for any bug that mentions this suite name.

**If a match is found in either check:**
- Add a comment to the existing bug:
  > _CI watcher update — ${nowIso.slice(0, 10)}: unhealthy \`<Unhealthy %>\`%, failure \`<Failure %>\`%, flake \`<Flake %>\`% over \`<Runs>\` runs in the last ${windowDays} days. [dptools search](\`<url>\`)_
- Do **not** create a new bug for this suite.
- Move to the next suite.

#### 1b. Create a new bug (only if no match found in 1a)

\`POST ${JIRA.siteUrl}/rest/api/3/issue\`

\`\`\`json
${createTemplate}
\`\`\`

**Field notes:**
- \`${JIRA.fields.targetVersion}\` = **Target Version** — always set to the same value as \`versions\`.
- Summary must be exactly \`[ci-watcher]: <branch> - <suite name> has <Failure %>% failure rate\`. If the full suite name exceeds 120 chars total, use only the filename portion (e.g., \`alertmanager.spec.ts\`).
- Description: include the suite's row data from the table above and its dptools link in ADF format. State only what the CI data shows; do not editorialise.
- \`${JIRA.fields.releaseBlocker}\` = **Release Blocker** — leave unset unless the failure rate exceeds 80% on a blocking job.

---

## Constraints (enforce for every suite)

- Process suites in table order (row 1 first).
- Do not set priority, sprint, assignee, or fix version on any created bug.
- Do not link to unrelated issues.
- Do not assert root causes.
- Do not file more than one bug per suite.
- Do not create bugs for suites not in the table above.
- Required create fields for OCPBUGS: \`project\`, \`issuetype\`, \`reporter\`, \`summary\`, \`versions\`.
- Set versions by \`{"name": …}\`, not by id — names are stable across JIRA projects.
`;
}
