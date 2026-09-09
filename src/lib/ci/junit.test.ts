import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate } from "./aggregate";
import { JUNIT_RE } from "./artifacts";
import { parseJunit } from "./junit";
import type { Build, JobRef, RunResult, SuiteResult } from "./types";

// ---------------------------------------------------------------------------
// objectPrefix validation regex (mirrors src/app/api/analyze/route.ts)
// ---------------------------------------------------------------------------

const OBJECT_PREFIX_RE =
  /^pr-logs\/pull\/openshift_console\/\d+\/[a-z0-9.-]+-[a-z0-9-]+\/\d+\/$/;

describe("OBJECT_PREFIX_RE", () => {
  const pass = [
    "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-release-5.0-e2e-gcp-console/2097545731324776448/",
    "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-release-4.12-e2e-gcp-console/2097545731324776448/",
    "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-main-e2e-gcp-console/2097545731324776448/",
    "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-release-5.0-frontend/2097545731324776448/",
    "pr-logs/pull/openshift_console/1/pull-ci-openshift-console-release-4.23-backend/123456789012345/",
  ];
  const fail = [
    // double-slash (missing PR number — the bug this fixed)
    "pr-logs/pull/openshift_console///pull-ci-openshift-console-release-5.0-e2e-gcp-console/2097545731324776448/",
    // path traversal
    "pr-logs/pull/openshift_console///../evil/2097545731324776448/",
    // absolute path injection
    "/etc/passwd",
    // missing trailing slash
    "pr-logs/pull/openshift_console/17149/pull-ci-openshift-console-release-5.0-e2e-gcp-console/2097545731324776448",
    // uppercase
    "pr-logs/pull/openshift_console/17149/Pull-CI/2097545731324776448/",
    // empty
    "",
  ];

  for (const p of pass) {
    it(`accepts valid prefix: …${p.slice(p.indexOf("/pull-ci"))}`, () => {
      expect(OBJECT_PREFIX_RE.test(p)).toBe(true);
    });
  }
  for (const p of fail) {
    it(`rejects: ${JSON.stringify(p).slice(0, 60)}`, () => {
      expect(OBJECT_PREFIX_RE.test(p)).toBe(false);
    });
  }
});

const FIX = path.join(__dirname, "__fixtures__");
const load = (name: string) => readFileSync(path.join(FIX, name), "utf8");

// ---------------------------------------------------------------------------
// JUNIT_RE — the ci-search filename filter
// ---------------------------------------------------------------------------

describe("JUNIT_RE", () => {
  it("matches junit-playwright.xml", () => {
    expect(
      JUNIT_RE.test(
        "artifacts/e2e-gcp-console/test/artifacts/junit-playwright.xml",
      ),
    ).toBe(true);
  });
  it("matches junit.xml", () => {
    expect(JUNIT_RE.test("artifacts/test/artifacts/junit.xml")).toBe(true);
  });
  it("matches junit_cypress-hash.xml", () => {
    expect(JUNIT_RE.test("artifacts/gui/junit_cypress-3f2a91bc.xml")).toBe(
      true,
    );
  });
  it("matches junit_operator.xml", () => {
    expect(JUNIT_RE.test("artifacts/junit_operator.xml")).toBe(true);
  });
  it("matches junit under a sub-directory named junit/", () => {
    expect(
      JUNIT_RE.test(
        "artifacts/e2e/gather-extra/artifacts/junit/junit_e2e_analysis.xml",
      ),
    ).toBe(true);
  });
  it("matches eslint.junit.xml (*.junit.xml convention)", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/eslint.junit.xml"),
    ).toBe(true);
  });
  it("matches gherkin-lint.junit.xml (hyphen in stem)", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/gherkin-lint.junit.xml"),
    ).toBe(true);
  });
  it("matches 'duplicated deps.junit.xml' (spaces in filename)", () => {
    expect(
      JUNIT_RE.test(
        "artifacts/test/artifacts/duplicated deps.junit.xml",
      ),
    ).toBe(true);
  });
  it("matches eslint.junit.xml (*.junit.xml — frontend job convention)", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/eslint.junit.xml"),
    ).toBe(true);
  });
  it("matches gherkin-lint.junit.xml", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/gherkin-lint.junit.xml"),
    ).toBe(true);
  });
  it("matches 'duplicated deps.junit.xml' (spaces in filename)", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/duplicated deps.junit.xml"),
    ).toBe(true);
  });
  it("matches playwright-standard-junit.xml (prow includes it; retry-dedup still correct)", () => {
    expect(
      JUNIT_RE.test("artifacts/test/artifacts/playwright-standard-junit.xml"),
    ).toBe(true);
  });
  it("matches prowjob_junit.xml (always healthy; hidden by default low-sample filter)", () => {
    expect(JUNIT_RE.test("prowjob_junit.xml")).toBe(true);
  });
  it("does NOT match build-log.txt", () => {
    expect(JUNIT_RE.test("artifacts/build-log.txt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Golden fixture: junit-playwright.xml (build 2097545731324776448)
// ---------------------------------------------------------------------------

describe("parseJunit — playwright (golden)", () => {
  const xml = load("junit-playwright.xml");
  const { suites, unwrapped } = parseJunit(xml);

  it("is wrapped (has <testsuites>)", () => {
    expect(unwrapped).toBe(false);
  });
  it("yields exactly 104 suites", () => {
    expect(suites.length).toBe(104);
  });
  it("yields 414 cases after retry dedup", () => {
    const total = suites.reduce((acc, s) => acc + s.cases.length, 0);
    expect(total).toBe(414);
  });
  it("has exactly 1 hard failure (console/crud/other-routes.spec.ts, never retried)", () => {
    const failed = suites.reduce((acc, s) => acc + s.counts.failed, 0);
    expect(failed).toBe(1);
  });
  it("has exactly 8 flaked cases", () => {
    const flaked = suites.reduce((acc, s) => acc + s.counts.flaked, 0);
    expect(flaked).toBe(8);
  });
  it("has exactly 45 skipped cases", () => {
    const skipped = suites.reduce((acc, s) => acc + s.counts.skipped, 0);
    expect(skipped).toBe(45);
  });
  it("counts <error> element as a failure in key-value.spec.ts", () => {
    const suite = suites.find((s) => s.name.includes("key-value.spec.ts"));
    expect(suite).toBeDefined();
    // The case with <error> had a retry that passed — it shows up as flaked, not failed
    const c = suite!.cases.find((c) =>
      c.name.includes("creates a key/value secret w"),
    );
    expect(c).toBeDefined();
    expect(c!.flaked).toBe(true);
    expect(c!.attempts).toBe(2);
  });
  it("the 8 flake groups are all FAIL→PASS in document order", () => {
    const flakedSuites = [
      "console/crud/resource-crud.spec.ts",
      "console/crud/secrets/key-value.spec.ts",
      "console/dashboards/cluster-dashboard.spec.ts",
      "dev-console/import-from-devfile.spec.ts",
      "dev-console/search.spec.ts",
      "olm/descriptors.spec.ts",
      "olm/operator-install-single-namespace.spec.ts",
      "olm/operator-uninstall.spec.ts",
    ];
    for (const suiteName of flakedSuites) {
      const suite = suites.find((s) => s.name === suiteName);
      expect(suite, `suite ${suiteName} not found`).toBeDefined();
      const flaked = suite!.cases.filter((c) => c.flaked);
      expect(
        flaked.length,
        `expected >=1 flake in ${suiteName}`,
      ).toBeGreaterThan(0);
    }
  });

  it("cross-validation: deduped playwright == playwright-standard stats (414 cases, 1 failure)", () => {
    // The playwright-standard-junit.xml is already-collapsed; our dedup should
    // reproduce the same final outcome counts.
    const stdXml = load("playwright-standard-junit.xml");
    const { suites: stdSuites } = parseJunit(stdXml);
    const stdCases = stdSuites.reduce((acc, s) => acc + s.cases.length, 0);
    const stdFailed = stdSuites.reduce((acc, s) => acc + s.counts.failed, 0);
    expect(stdCases).toBe(414);
    expect(stdFailed).toBe(1);

    // Our deduped result matches the standard file's totals
    const ourFailed = suites.reduce((acc, s) => acc + s.counts.failed, 0);
    expect(ourFailed).toBe(stdFailed);
  });
});

// ---------------------------------------------------------------------------
// Frontend jest fixture
// ---------------------------------------------------------------------------

describe("parseJunit — frontend jest", () => {
  const xml = load("junit-frontend.xml");
  const { suites } = parseJunit(xml);

  it("parses without error", () => {
    expect(suites.length).toBeGreaterThan(0);
  });
  it("all suites are marked as test origin", () => {
    expect(suites.every((s) => s.origin === "test")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CI operator fixture
// ---------------------------------------------------------------------------

describe("parseJunit — junit_operator (ci-operator step graph)", () => {
  const xml = load("junit_operator.xml");
  const { suites } = parseJunit(xml);

  it("parses without error", () => {
    expect(suites.length).toBeGreaterThan(0);
  });
  it("marks step graph suite as ci-operator origin", () => {
    const sg = suites.find((s) => s.name === "step graph");
    expect(sg).toBeDefined();
    expect(sg!.origin).toBe("ci-operator");
  });
});

// ---------------------------------------------------------------------------
// devVersion — branch-to-Jira-version mapping
// ---------------------------------------------------------------------------

import { branchToJiraVersion } from "./devVersion";
import type { DevVersionResult } from "./types";

describe("branchToJiraVersion", () => {
  const devVersion: DevVersionResult = {
    version: "5.1",
    jiraVersion: "5.1.0",
    sourceBranch: "release-5.1",
    resolvedVia: "sha",
  };

  it("main → 5.1.0", () => {
    expect(branchToJiraVersion("main", devVersion)).toBe("5.1.0");
  });
  it("release-5.1 (dev version) → 5.1.0", () => {
    expect(branchToJiraVersion("release-5.1", devVersion)).toBe("5.1.0");
  });
  it("release-5.2 (above dev) → 5.2.0", () => {
    expect(branchToJiraVersion("release-5.2", devVersion)).toBe("5.2.0");
  });
  it("release-5.0 (below dev) → 5.0.z", () => {
    expect(branchToJiraVersion("release-5.0", devVersion)).toBe("5.0.z");
  });
  it("release-4.21 (below dev) → 4.21.z", () => {
    expect(branchToJiraVersion("release-4.21", devVersion)).toBe("4.21.z");
  });
  it("release-3.11 (semver sort check, way below dev) → 3.11.z", () => {
    expect(branchToJiraVersion("release-3.11", devVersion)).toBe("3.11.z");
  });
  it("unavailable devVersion → null", () => {
    expect(
      branchToJiraVersion("release-5.0", {
        ...devVersion,
        resolvedVia: "unavailable",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregate — branches field
// ---------------------------------------------------------------------------

function makeJob(branch: string, suffix: string): JobRef {
  return {
    branch,
    suffix,
    name: `pull-ci-openshift-console-${branch}-${suffix}`,
    lastRunIso: null,
  };
}

function makeBuild(
  id: string,
  jobName: string,
  result: "SUCCESS" | "FAILURE" = "SUCCESS",
): Build {
  return {
    id,
    jobName,
    result,
    startedIso: "2026-09-01T00:00:00Z",
    startedMs: 1756684800000,
    durationMs: 60000,
    prNumber: 1,
    prTitle: null,
    prAuthor: null,
    baseRef: "main",
    objectPrefix: `pr-logs/pull/openshift_console/1/${jobName}/1/`,
    spyglassUrl: "",
  };
}

function makeSuite(name: string, ran = true): SuiteResult {
  const outcome = ran ? "pass" : "skip";
  return {
    name,
    file: null,
    origin: "test",
    cases: [
      {
        name: "t",
        classname: null,
        outcome,
        attempts: 1,
        flaked: false,
        failureType: null,
        failureMessage: null,
        timeSec: 1,
      },
    ],
    counts: {
      total: 1,
      passed: ran ? 1 : 0,
      failed: 0,
      skipped: ran ? 0 : 1,
      flaked: 0,
    },
    ran,
  };
}

function makeRun(buildId: string, suites: SuiteResult[]): RunResult {
  return {
    buildId,
    startedIso: "2026-09-01T00:00:00Z",
    prowResult: "SUCCESS",
    status: "analyzed",
    sourcePaths: [],
    suites,
  };
}

const SUFFIX = "e2e-gcp-console";
const JOB_50 = `pull-ci-openshift-console-release-5.0-${SUFFIX}`;
const JOB_51 = `pull-ci-openshift-console-release-5.1-${SUFFIX}`;
const JOB_MAIN = `pull-ci-openshift-console-main-${SUFFIX}`;

describe("aggregate — SuiteStat.branches", () => {
  it("single branch: branches contains just that branch", () => {
    const job = makeJob("release-5.0", SUFFIX);
    const builds = [makeBuild("1", JOB_50)];
    const runs = [makeRun("1", [makeSuite("suite-a")])];
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["release-5.0"]);
  });

  it("multi-branch: branches contains all branches where the suite ran", () => {
    const job = makeJob("__aggregate__", SUFFIX);
    const builds = [
      makeBuild("1", JOB_50),
      makeBuild("2", JOB_51),
      makeBuild("3", JOB_MAIN),
    ];
    const runs = builds.map((b) => makeRun(b.id, [makeSuite("suite-a")]));
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["main", "release-5.0", "release-5.1"]);
  });

  it("suite absent from one branch: branches only lists branches where it ran", () => {
    const job = makeJob("__aggregate__", SUFFIX);
    const builds = [makeBuild("1", JOB_50), makeBuild("2", JOB_51)];
    const runs = [
      makeRun("1", [makeSuite("suite-a")]),
      makeRun("2", [makeSuite("suite-b")]), // suite-a not present in release-5.1
    ];
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["release-5.0"]);
  });

  it("suite skipped in one branch: skipped run excluded from branches", () => {
    const job = makeJob("__aggregate__", SUFFIX);
    const builds = [makeBuild("1", JOB_50), makeBuild("2", JOB_51)];
    const runs = [
      makeRun("1", [makeSuite("suite-a", true)]), // ran in 5.0
      makeRun("2", [makeSuite("suite-a", false)]), // all-skipped in 5.1
    ];
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["release-5.0"]);
  });

  it("unrecognised jobName format: branches is empty", () => {
    const job = makeJob("release-5.0", SUFFIX);
    const builds = [makeBuild("1", "unknown-job-format")];
    const runs = [makeRun("1", [makeSuite("suite-a")])];
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual([]);
  });

  it("branches are sorted lexicographically (main before release-*)", () => {
    const job = makeJob("__aggregate__", SUFFIX);
    // Intentionally insert in non-sorted order
    const builds = [
      makeBuild("1", JOB_51),
      makeBuild("2", JOB_MAIN),
      makeBuild("3", JOB_50),
    ];
    const runs = builds.map((b) => makeRun(b.id, [makeSuite("suite-a")]));
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["main", "release-5.0", "release-5.1"]);
  });

  it("release-3.11 is parsed correctly (double-digit minor version)", () => {
    const job311 = `pull-ci-openshift-console-release-3.11-${SUFFIX}`;
    const job = makeJob("release-3.11", SUFFIX);
    const builds = [makeBuild("1", job311)];
    const runs = [makeRun("1", [makeSuite("suite-a")])];
    const analysis = aggregate(job, builds, runs, 14);
    const suite = analysis.suites.find((s) => s.name === "suite-a");
    expect(suite?.branches).toEqual(["release-3.11"]);
  });
});
