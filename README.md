# CI Watcher — OpenShift prow junit failure heatmap

> [!WARNING]
> This is AI slop and I have not thoroughly vetted the code. Use at your own risk!

Read-only dashboard for analyzing flaky and failing junit test suites across OpenShift CI prow runs for an OpenShift repository.

## What it does

1. Fetches release branches and prow jobs dynamically — no hardcoded lists. Retired jobs appear with their last-run date.
2. Scrapes all prow runs over a configurable window (default 14 days).
3. Discovers and parses junit XML artifacts.
4. Renders a heatmap in two views: suite × run matrix and compact per-suite grid.
5. Links each failing suite to `search.dptools.openshift.org` and generates a copy-pasteable markdown prompt for LLM-assisted OCPBUGS triage.

**The app never calls an LLM.** All numbers are computed from junit XML.

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

The `test-platform-results` bucket is normally readable anonymously, so there is nothing to
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
