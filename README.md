# CI Watcher — OpenShift prow junit failure heatmap

> [!WARNING]
> This is AI slop and I have not thoroughly vetted the code. Use at your own risk!

Read-only dashboard for analyzing flaky and failing junit test suites across OpenShift CI prow runs for an OpenShift repository.

## What it does

1. Fetches release branches and prow jobs dynamically — no hardcoded lists. Retired jobs appear with their last-run date.
2. Scrapes all prow runs over a configurable window (default 14 days).
3. Discovers and parses junit XML artifacts.
4. Renders suite statistics as a table, suite × run matrix, or compact per-suite grid. For `openshift/console`, the **CRP timings** view appears only after timing data is found for the selected job. It charts cluster-dashboard loading measurements across runs and repeated page loads, including original and `retryN` attempts.
5. Links each failing suite to `search.dptools.openshift.org` and generates a copy-pasteable markdown prompt for LLM-assisted OCPBUGS triage.

**The app never calls an LLM.** All numbers are computed from junit XML or recorded CRP timing JSON.

## Stack

- **Next.js**, App Router, Turbopack default, `reactCompiler: true`
- **React**, TypeScript + strict mode
- **PatternFly** — `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/patternfly` (CSS), `@patternfly/react-styles`
- **`fast-xml-parser`** — junit parsing, zero runtime deps, Vercel-safe
- **vitest** — unit tests
- **Biome** — lint/format. No ESLint.

## Running

```sh
pnpm dev          # dev server on :3000
pnpm build        # production build
pnpm lint         # Biome check
pnpm format       # Biome format --write
pnpm test         # vitest (offline, uses fixtures)
NET=1 pnpm test   # + network-gated integration tests
```

## CRP graph PNG API

`GET /api/crp-timings/graph` returns `image/png` for `openshift/console`. It uses the same timing statistics and graph definitions as the dashboard. Images render on the server using ECharts SVG rendering and sharp, with no browser required.

Export the mean-duration trend for a job:

```sh
curl --fail --get 'http://localhost:3000/api/crp-timings/graph' \
  --data-urlencode 'job=pull-ci-openshift-console-main-e2e-gcp-console' \
  --data-urlencode 'days=14' \
  --data-urlencode 'hideWithoutTimings=1' \
  --output crp-trend.png
```

Export repeated page loads for a specific build (defaults to the latest recorded retry):

```sh
curl --fail --get 'http://localhost:3000/api/crp-timings/graph' \
  --data-urlencode 'job=pull-ci-openshift-console-main-e2e-gcp-console' \
  --data-urlencode 'view=loads' \
  --data-urlencode 'pr=17379' \
  --data-urlencode 'buildId=2110003893407584256' \
  --output crp-loads.png
```

| Parameter | Default | Meaning |
|---|---|---|
| `job` | Required | Full Console Prow job name, validated against the catalog |
| `view` | `trend` | `trend` or `loads`; loads without a build selects the newest run with timings in the window |
| `days` | `14` | Run window, 1–90 days; up to 32 history pages and the newest 512 runs |
| `metric` | `sum` | Exact timing name, e.g. `LoadingBox:DashboardsPage` |
| `hideWithoutTimings` | `0` | `1` hides runs missing the selected metric in the trend |
| `pr`, `buildId` | — | Supply together for a specific build; requires `view=loads`; keep build IDs as strings |
| `retry` | Latest available | Original attempt = `0`, retries = `1` and up; requires `view=loads` |
| `width`, `height` | `1200`, `600` | PNG dimensions; width 640–2400, height 320–1400 |
| `force` | `0` | `1` bypasses cached runs and timing artifacts |
| `repo` | `openshift/console` | Only Console is supported |

Trend timestamps use UTC. If the history page or run limit is reached, the API still returns a PNG, adds “History truncated” to its subtitle, and sets `X-CI-History-Truncated: true`. `X-CI-Runs-Analyzed` reports the number of runs checked. Complete exports set the truncation header to `false`.

Invalid inputs return JSON with HTTP 400; missing timings, metrics, retries, or builds return 404; unfinished explicit builds return 409; upstream failures return 502. Timing fetch errors are reported rather than silently omitted from the graph.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `CI_CACHE_DIR` | `os.tmpdir()/console-dashboard-squared-cache` | Filesystem cache root |
| `CI_MAX_CONCURRENCY` | `6` | Parallel GCS fetches inside `/api/analyze` |
| `CI_ANALYZE_BATCH` | `8` | Max build IDs per `/api/analyze` POST |
| `CI_CLIENT_CONCURRENCY` | `4` | Parallel `/api/analyze` calls from the browser |
| `GITHUB_TOKEN` | — | Raises GitHub unauthenticated rate limit (60 req/hr) |
| `GOOGLE_ACCESS_TOKEN` | — | Google OAuth2 bearer token for GCS. Falls back to `gcloud auth print-access-token` when unset. |

### Optional GCS authentication

The `test-platform-results-public` bucket is normally readable anonymously, so there is nothing to
configure. Requests are sent unauthenticated unless a token is available.

If GCS returns `401` or `403`, authentication becomes necessary. Provide a credential holding
`roles/storage.objectViewer` on the bucket, either by setting `GOOGLE_ACCESS_TOKEN` to a
service account token or by running `gcloud auth login` locally. Two caveats:

- A Google API key is not enough — it identifies a project for quota but leaves the caller
  anonymous to IAM.
- A token authenticates but does not authorize. An account with no binding on the bucket is
  still refused, just with `403` instead of `401`.

Prow (`prow.ci.openshift.org`) is a separate service with its own access controls, and a Google
credential has no effect there.
