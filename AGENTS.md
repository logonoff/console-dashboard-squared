<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# CI Watcher — OpenShift Console prow junit failure heatmap

Read-only dashboard for analyzing flaky/failing junit test suites across OpenShift CI prow runs for the `openshift/console` repository.

## What it does

1. Fetches release branches and prow jobs **dynamically** from GCS — no hardcoded lists. Job names change across branches (e.g. `e2e-playwright` became `e2e-gcp-console` in release-5.0+; `e2e-cypress` is replacing the old cypress-based `e2e-gcp-console` and is pending removal). The GCS directory listing is historical, so retired jobs still appear — they are shown with a stale `lastRunIso` date.
2. Scrapes all prow runs over a configurable window (default 14 days, matching dptools `maxAge=336h`).
3. Discovers and parses junit XML artifacts using the same filename regex as `openshift/ci-search`.
4. Renders a heatmap in two views: suite × run matrix and compact per-suite grid.
5. Links each failing suite to `search.dptools.openshift.org` and generates a copy-pasteable markdown prompt instructing an LLM to triage / file OCPBUGS.

**The app never calls an LLM.** All numbers are deterministic from junit XML.

## Stack

- **Next.js 16.3.4**, App Router, Turbopack default, `reactCompiler: true`
- **React 19**, TypeScript ^7, strict mode
- **PatternFly 6.6.1** — `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/patternfly` (CSS), `@patternfly/react-styles`. No `@patternfly/react-charts` (removed — peers missing).
- **`fast-xml-parser` v5** — junit parsing, zero runtime deps, Vercel-safe
- **vitest v5** — unit tests (`pnpm test`; `NET=1 pnpm test` enables network-gated tests)
- **Biome 2.5.12** — lint/format (`pnpm lint` / `pnpm format`). No ESLint.

## Next.js 16 conventions — must know

- `context.params` in route handlers is a **Promise** — always `await ctx.params`.
- `cookies`, `headers`, `searchParams` are all async-only (sync shim removed in v16).
- Global `PageProps<'/'>`, `LayoutProps<'/'>`, `RouteContext<'/api/…'>` helpers — no import.
- GET route handlers are **uncached by default**. No `force-dynamic` needed.
- `middleware.ts` → `proxy.ts` (nodejs runtime only). We have neither.
- `next lint` is removed; linting is Biome.
- Turbopack is default for `dev` and `build`. Webpack config would break the build.

## File layout

```
src/
  app/
    layout.tsx           Server Component — metadata, ThemeSync bootstrap, AppShell wrapper
    page.tsx             Server Component — renders <DashboardClient/>
    error.tsx            Client error boundary
    api/
      branches/route.ts  GET → { branches: BranchEntry[] }
      jobs/route.ts      GET ?branch= → { jobs: JobRef[] }
      runs/route.ts      GET ?job=&days= → { builds: Build[] }
      analyze/route.ts   POST { job, buildIds[≤8], force? } → { results: RunResult[] }
      dev-version/route.ts  GET → DevVersionResult
  lib/
    ci/
      types.ts           All domain types (canonical reference)
      gcs.ts             GCS JSON list API + media download; retry/backoff; size caps
      prow.ts            job-history HTML scrape, allBuilds JSON, BigInt pagination
      catalog.ts         Branch + job discovery (single GCS call)
      devVersion.ts      Resolve `main` → in-development version via GitHub branch SHAs
      artifacts.ts       JUNIT_RE + discoverJunitPaths (full recursive listing)
      junit.ts           XML → SuiteResult[]; retry dedup; multi-file merge
      analyze.ts         one Build → RunResult
      aggregate.ts       RunResult[] → SuiteStat[] + matrix cells + denominators
      links.ts           dptools / spyglass / JQL URL builders
      concurrency.ts     Bounded async worker pool
      __fixtures__/      Real junit XML files from live builds (test fixtures)
    cache/
      index.ts           LayeredCache (globalThis-pinned singleton)
      memory.ts          LRU in-memory tier
      fs.ts              Filesystem tier (self-disabling on EROFS/EACCES — Vercel-safe)
      keys.ts            Cache key builders + TTL constants
    jira/
      constants.ts       OCPBUGS field IDs, component IDs, version mapping
      prompt.ts          Deterministic markdown bug-triage prompt generator
  components/
    AppShell.tsx         "use client" <Page> wrapper; children stay Server Components
    ThemeSync.tsx        "use client" THEME_BOOTSTRAP script + media-query listeners
    dashboard/
      DashboardClient.tsx   Orchestrator
      ControlBar.tsx        Branch/job/window/view/metric selects + refresh
      LoadProgress.tsx      Progress + cancel
      SummaryStrip.tsx      Run count summary
      HeatmapMatrix.tsx     Suite × run CSS Grid
      HeatmapGrid.tsx       Compact per-suite grid
      HeatmapCell.tsx       Shared cell primitive
      HeatmapLegend.tsx     Bucket legend
      SuiteDetailPanel.tsx  Drawer: stats, runs, top failures, OCPBUGS tab
      BugPromptPanel.tsx    ClipboardCopy of generated markdown
      heatmap.module.css    Grid layout + PF semantic token colors
  hooks/
    useCatalog.ts
    useRunAnalysis.ts    Client fan-out, progress, abort, force-refresh
```

## Critical design decisions

### junit discovery — JUNIT_RE, no path assumptions

Ported verbatim from `openshift/ci-search` (`testgrid/util/gcs/read.go:141`):

```ts
export const JUNIT_RE = /.+\/junit((_[^_]+)?(_\d+-\d+)?(_\d+)?|.+)?\.xml$/;
```

Discovery = full recursive GCS listing of the build prefix, filtered by this regex. No per-job candidate paths, no directory shortcuts — a job rename or new artifact layout changes nothing.

Key: `playwright-standard-junit.xml` does **not** match (basename starts with `playwright-`). This is intentional — that file has already collapsed retries and hides all flakes. `junit-playwright.xml` matches and retains raw retry attempts.

Cost per cold build: ~4.5 s, 10,000 objects, 11 GCS pages. Cached immutably after first fetch.

### Retry dedup

Playwright re-runs failed testcases and emits duplicate `<testcase>` entries in the same file. Group by `(suiteName, name, classname)` in document order. Last attempt wins for `outcome`. A group is `flaked` when `attempts > 1 && outcome === "pass" && any earlier attempt failed`.

Cross-validation: deduping `junit-playwright.xml` must reproduce the case count and failure count in `playwright-standard-junit.xml` exactly.

### Metrics and denominators

Default metric: `unhealthyRate = (failedIn + flakedIn) / appearedIn`. Hard-failure-only would be nearly all-green on builds prow marks FAILURE due to flakes alone (verified empirically — build `2097545731324776448` has 1 hard failure and 8 flakes yet prow Result=FAILURE).

`appearedIn` = analyzed runs where the suite `ran` (≥1 non-skipped case). All-skipped suite appearances are excluded from the denominator. PENDING/ABORTED/ERROR runs are excluded entirely.

### Build IDs

Prow build IDs (e.g. `2097707370711879680`) exceed `Number.MAX_SAFE_INTEGER`. Always keep as strings. Use `BigInt` only for pagination comparisons. Never pass to `parseInt` or `Number`.

### Version mapping for JIRA bugs

`/api/dev-version` finds the in-development version: the lowest-numbered release branch whose HEAD SHA matches `main` on GitHub. Currently: `release-5.1` → version `5.1`.

Bug version selection:
- `main` → `5.1.0` (dev version + `.0`)
- `release-X.Y >= devVersion` → `X.Y.0`
- `release-X.Y < devVersion` → **`X.Y.z`** (z-stream; it is a maintenance branch)

Both `versions` (Affects) and `customfield_10855` (Target Version) receive the same computed string.

Compare versions as int tuples — `release-3.11` must sort below `release-4.1`.

### Cache

`LayeredCache` pinned to `globalThis` survives Turbopack HMR. Memory LRU tier always on. Filesystem tier (`$CI_CACHE_DIR ?? os.tmpdir()/…`) self-disables on `EROFS`/`EACCES` — safe on Vercel's read-only root. Terminal build results (`prowResult ∈ {SUCCESS, FAILURE}`) are immutable and cached forever. PENDING results are never cached.

### All upstream fetching is server-side

Prow HTML and GCS object downloads send no CORS headers. Everything goes through `/api/*` route handlers. No `proxy.ts`, no generic pass-through proxy (SSRF risk). Validate `job` against the catalog before interpolating into a prow URL; validate `buildId` against `/^\d{15,25}$/`.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `CI_CACHE_DIR` | `os.tmpdir()/console-dashboard-squared-cache` | Filesystem cache root |
| `CI_MAX_CONCURRENCY` | `6` | Parallel GCS fetches inside `/api/analyze` |
| `CI_ANALYZE_BATCH` | `8` | Max build IDs per `/api/analyze` POST |
| `CI_CLIENT_CONCURRENCY` | `4` | Parallel `/api/analyze` calls from the browser |
| `GITHUB_TOKEN` | — | Raises GitHub unauthenticated 60 req/hr limit |

## Running

```sh
pnpm dev          # dev server on :3000
pnpm build        # production build
pnpm lint         # Biome check
pnpm format       # Biome format --write
pnpm test         # vitest (offline, uses fixtures)
NET=1 pnpm test   # + network-gated integration tests
```

## OCPBUGS JIRA reference (redhat.atlassian.net)

- cloudId `2b9e35e3-6bd3-4cec-b838-f4249ee02432`
- Project `OCPBUGS` id `10325`, issue type Bug id `10016`
- Required create fields: `project`, `issuetype`, `reporter`, `summary`, `versions`
- Target Version: `customfield_10855` (array of `{"name": "…"}`)
- Release Blocker: `customfield_10847`
- Component "Management Console": id `14749`
- Set versions by name, not id (e.g. `{"name": "5.1.0"}`, `{"name": "5.0.z"}`)
