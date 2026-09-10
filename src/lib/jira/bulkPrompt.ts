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

  // Embedded version mapping — no external calls needed
  const mainJiraVer = branchToJiraVersion("main", devVersion);

  interface BranchVersionRow {
    branch: string;
    abbr: string;
    jiraVer: string;
    jiraVerShort: string;
    jiraVerZ: string;
  }
  const branchVersionRows: BranchVersionRow[] = [];
  if (isAggregate) {
    const seen = new Set<string>();
    for (const suite of actionable) {
      for (const branch of suite.branches) {
        if (!seen.has(branch)) {
          seen.add(branch);
          const ver =
            branchToJiraVersion(branch, devVersion) ?? "⚠️ resolve manually";
          const short = ver.startsWith("⚠️")
            ? "⚠️"
            : ver.endsWith(".z")
              ? ver.slice(0, -2) // "5.0.z" → "5.0"
              : ver.replace(/\.\d+$/, ""); // "5.1.0" → "5.1"
          branchVersionRows.push({
            branch,
            abbr: abbrev(branch),
            jiraVer: ver,
            jiraVerShort: short,
            jiraVerZ: short.startsWith("⚠️") ? "⚠️" : `${short}.z`,
          });
        }
      }
    }
    branchVersionRows.sort((a, b) => {
      if (a.branch === "main") return -1;
      if (b.branch === "main") return 1;
      return b.branch.localeCompare(a.branch);
    });
  }

  const branchVersionTableMd =
    isAggregate && branchVersionRows.length > 0
      ? `\n### Branch → JIRA version mapping\n\n` +
        `Current in-development version: \`${mainJiraVer ?? "⚠️ unknown"}\`\n\n` +
        `| Branch | Abbr | \`versions\` / \`${JIRA.fields.targetVersion}\` | Short | z-stream |\n` +
        `| -- | -- | -- | -- | -- |\n` +
        branchVersionRows
          .map(
            (r) =>
              `| \`${r.branch}\` | ${r.abbr} | \`${r.jiraVer}\` | \`${r.jiraVerShort}\` | \`${r.jiraVerZ}\` |`,
          )
          .join("\n") +
        "\n"
      : "";

  const broadJql =
    `project = OCPBUGS AND component = "${component.name}"` +
    ` AND labels in (ci-watch, automated, ci-watcher) AND created >= -60d ORDER BY created DESC`;

  const narrowJqlResolved = isAggregate
    ? `project = OCPBUGS AND issuetype = Bug AND component = "${component.name}"\n` +
      `  AND text ~ "<suite-basename>"\n` +
      `  AND affectedVersion in ("<JIRA_VER>", "<JIRA_VER_SHORT>", "<JIRA_VER_Z>")\n` +
      `  AND status not in (Closed, "Release Pending") ORDER BY created DESC\n\n` +
      `Substitute <suite-basename> with the filename portion of the suite path (e.g., \`alertmanager.spec.ts\`).\n` +
      `Substitute <JIRA_VER>, <JIRA_VER_SHORT>, <JIRA_VER_Z> from the Branch → JIRA version mapping above,\n` +
      `using the suite's primary branch (see multi-branch naming rule in Decision rules).`
    : `project = OCPBUGS AND issuetype = Bug AND component = "${component.name}"\n` +
      `  AND text ~ "<suite-basename>"\n` +
      `  AND affectedVersion in ("${jiraVer}", "${versionShort}", "${versionZ}")\n` +
      `  AND status not in (Closed, "Release Pending") ORDER BY created DESC`;

  const additionalFields = JSON.stringify(
    {
      reporter: {
        accountId: "<resolve with atlassianUserInfo — once per session>",
      },
      components: [{ name: component.name }],
      versions: [
        { name: isAggregate ? "<JIRA_VER from mapping above>" : jiraVer },
      ],
      [JIRA.fields.targetVersion]: [
        { name: isAggregate ? "<JIRA_VER from mapping above>" : jiraVer },
      ],
      [JIRA.fields.releaseBlocker]: { value: "Rejected" },
      labels: [JIRA.labels.automated, JIRA.labels.ciWatch],
    },
    null,
    2,
  );

  const summaryTemplate = isAggregate
    ? `[ci-watcher]: <primary-branch> - <Suite name> has <Failure %>% failure rate`
    : `[ci-watcher]: ${job.branch} - <Suite name> has <Failure %>% failure rate`;

  return `# OCPBUGS bulk triage — ${repo.name} CI watcher

You are triaging **${actionable.length}** ${repo.name} CI test suite(s) with an unhealthy rate ≥ ${UNHEALTHY_THRESHOLD * 100}%.
Use ONLY the data provided. Do not invent root causes or guess at fixes.

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
${branchVersionTableMd}
## Suite data (sorted by impact, highest unhealthy rate first)

| # | Suite | Branch(es) | Unhealthy % | Failure % | Flake % | Runs | Failed | Flaked | dptools |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
${tableRows || "_(no suites meet the threshold)_"}

---

## Decision rules

### Multi-branch naming — primary branch and summary token

Each suite's Branch(es) column may list multiple branches. Apply these rules in order:

1. If \`main\` is in the list → primary branch = \`main\`.
2. Otherwise → primary branch = the highest-numbered release branch (e.g., \`5.0\` beats \`4.18\`; compare as integer tuples).

Use the primary branch as the \`<branch>\` token in the summary and to look up the JIRA version from the mapping above.

### What counts as a match (dedup)

An existing bug **matches** this suite if ALL of:
- Status is **not** Closed or Release Pending.
- The bug's summary or description contains the **exact basename** of the suite path (e.g., \`alertmanager.spec.ts\`).
- The basename is not a different-extension predecessor: \`.cy.ts\`, \`.feature\`, or other suffixes are **not** the same suite as the corresponding \`.spec.ts\`. A bug about \`operator-uninstall.cy.ts\` does **not** match \`operator-uninstall.spec.ts\`.

### Closed-bug policy

A closed bug for the same suite does **not** suppress creation — the suite is failing again. Create a new bug.

---

## Processing instructions

### Step 1 — broad supplementary search (run once)

Run this JQL against \`${JIRA.siteUrl}\` before processing suites. Use the results as a quick cross-reference during Step 2 — it is not the authoritative dedup signal.

\`\`\`jql
${broadJql}
\`\`\`

---

### Step 2 — per-suite narrow searches (no writes yet)

For every row in the suite table, run the narrow check and record whether a match was found:

\`\`\`jql
${narrowJqlResolved}
\`\`\`

Also note any hits from the Step 1 results that match the suite basename.

Record for each suite: match found (yes/no), issue key if yes, proposed action.

---

### Step 3 — present plan and wait for explicit user approval

After completing all searches, present this table:

| # | Suite | Primary branch | JIRA version | Proposed action | Existing issue |
| -- | -- | -- | -- | -- | -- |
| … | … | … | … | Create new bug _or_ Add comment | \`OCPBUGS-XXXXX\` or — |

**Do not create any bugs or post any comments until the user explicitly approves.**
If they request changes, update the table and seek approval again.

---

### Step 4 — execute approved actions, in table order

#### 4a. Existing bug found — add a comment

Use \`addCommentToJiraIssue\` with cloudId \`${JIRA.cloudId}\`:

> _CI watcher update — ${nowIso.slice(0, 10)}: unhealthy \`<Unhealthy %>\`%, failure \`<Failure %>\`%, flake \`<Flake %>\`% over \`<Runs>\` runs in the last ${windowDays} days. [dptools search](<url>)_

Do **not** create a new bug for this suite.

#### 4b. No existing bug — create a new bug

Use \`createJiraIssue\` with these arguments:

- **cloudId**: \`${JIRA.cloudId}\`
- **projectKey**: \`${JIRA.project.key}\`
- **issueTypeName**: \`Bug\`
- **summary**: \`${summaryTemplate}\`
  - If the full summary exceeds 120 chars, use only the filename portion of the suite name (e.g., \`alertmanager.spec.ts\`).
- **contentFormat**: \`markdown\`
- **description**: the suite's row data from the table above, plus its dptools link, in plain markdown. State only what the CI data shows; do not editorialise.
- **additional_fields**:

\`\`\`json
${additionalFields}
\`\`\`

**Field notes:**
- \`${JIRA.fields.targetVersion}\` = **Target Version** — must equal \`versions\`.
- \`${JIRA.fields.releaseBlocker}\` = **Release Blocker** — always \`{ "value": "Rejected" }\`.
- Do not set priority, sprint, assignee, or fix version.

---

### Step 5 — final report

After all actions are complete, output this table:

| # | Suite | Primary branch | JIRA version | Action taken | Issue key | Notes |
| -- | -- | -- | -- | -- | -- | -- |
| … | … | … | … | Created / Commented / Skipped | \`OCPBUGS-XXXXX\` or — | … |

---

## Constraints (enforce for every suite)

- Process suites in table order (row 1 first).
- **Never write to JIRA without explicit user approval (Step 3).**
- Do not link to unrelated issues.
- Do not assert root causes.
- Do not file more than one bug per suite.
- Do not create bugs for suites not in the table above.
- Set versions by \`{"name": …}\`, not by id — names are stable across JIRA projects.
`;
}
