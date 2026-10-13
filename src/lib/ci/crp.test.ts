import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRP_TEST_PREFIX, fetchCrpTimings, parseCrpBuild } from "./crp";
import { parseCrpTimings, summarizeTiming, timingDuration } from "./crpTimings";
import { gcsGetText, gcsListAll } from "./gcs";

vi.mock("./gcs", () => ({ gcsGetText: vi.fn(), gcsListAll: vi.fn() }));

const fixture = readFileSync(
  path.join(__dirname, "__fixtures__/crp-blame-timings.json"),
  "utf8",
);
const job = "pull-ci-openshift-console-main-e2e-gcp-console";
const build = {
  id: "2110003893407584256",
  result: "FAILURE" as const,
  objectPrefix: `pr-logs/pull/openshift_console/17379/${job}/2110003893407584256/`,
};
const prefix = `${build.objectPrefix}${CRP_TEST_PREFIX}`;

function list(paths: string[]) {
  vi.mocked(gcsListAll).mockImplementation(async function* () {
    yield* paths;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  list([]);
  vi.mocked(gcsGetText).mockResolvedValue(fixture);
});

describe("CRP timing parsing and statistics", () => {
  it("parses all three repeated loads from the supplied live build", () => {
    const loads = parseCrpTimings(fixture);
    expect(loads).toHaveLength(3);
    expect(loads.map((load) => timingDuration(load, "sum"))).toEqual([
      2196.2999999998137, 2570.099999999162, 2155.9000000003725,
    ]);
    const summary = summarizeTiming(
      { retry: 1, sourcePath: "fixture", loads },
      "sum",
    )!;
    expect(summary.count).toBe(3);
    expect(summary.mean).toBeCloseTo(2307.433333333);
    expect(summary.min).toBeCloseTo(2155.9);
    expect(summary.max).toBeCloseTo(2570.1);
  });

  it("adds repeated components within a load without recomputing the recorded sum", () => {
    const loads = parseCrpTimings(fixture);
    expect(timingDuration(loads[0], "LoadingBox:DashboardsPage")).toBeCloseTo(
      339.4,
    );
    expect(timingDuration(loads[0], "missing")).toBeNull();
  });

  it("distinguishes missing measurements from measured zero", () => {
    expect(
      summarizeTiming(
        {
          retry: 0,
          sourcePath: "fixture",
          loads: [[], [{ name: "x", duration: 0 }]],
        },
        "x",
      ),
    ).toEqual({ mean: 0, min: 0, max: 0, count: 1 });
    expect(
      summarizeTiming({ retry: 0, sourcePath: "fixture", loads: [[]] }, "x"),
    ).toBeNull();
  });

  it.each([
    "not json",
    "{}",
    '[{"name":"x","duration":1}]',
    '[[{"name":"x","duration":-1}]]',
    '[[{"name":"x","duration":"1"}]]',
    '[[{"name":"x","duration":1e400}]]',
    '[[{"name":"","duration":1}]]',
    "[[null]]",
  ])("rejects malformed timing data: %s", (text) => {
    expect(() => parseCrpTimings(text)).toThrow();
  });
});

describe("fixed CRP artifact discovery", () => {
  it("finds original and numeric retry attempts, ignoring duplicate attachments", async () => {
    list([
      `${prefix}-retry10/crp-blame-timings.json`,
      `${prefix}/crp-blame-timings.json`,
      `${prefix}-retry2/crp-blame-timings.json`,
      `${prefix}-retry2/attachments/crp-blame-timings-hash.json`,
      `${prefix}-retry2/trace.zip`,
      `${prefix}-other/crp-blame-timings.json`,
    ]);
    const result = await fetchCrpTimings(build);
    expect(gcsListAll).toHaveBeenCalledWith(prefix);
    expect(result.status).toBe("analyzed");
    expect(result.attempts.map((attempt) => attempt.retry)).toEqual([0, 2, 10]);
    expect(result.attempts.every((attempt) => attempt.loads.length === 3)).toBe(
      true,
    );
    expect(gcsGetText).toHaveBeenCalledTimes(3);
  });

  it("finds the supplied build's retry1 even when the original has no JSON", async () => {
    list([
      `${prefix}/error-context.md`,
      `${prefix}-retry1/crp-blame-timings.json`,
    ]);
    expect(
      (await fetchCrpTimings(build)).attempts.map((attempt) => attempt.retry),
    ).toEqual([1]);
  });

  it("reports absent or empty artifacts without manufacturing zero timings", async () => {
    expect((await fetchCrpTimings(build)).status).toBe("no-artifact");
    list([`${prefix}/crp-blame-timings.json`]);
    vi.mocked(gcsGetText).mockResolvedValue("[]");
    expect((await fetchCrpTimings(build)).status).toBe("no-artifact");
  });

  it("preserves good attempts while reporting a malformed retry", async () => {
    list([
      `${prefix}/crp-blame-timings.json`,
      `${prefix}-retry1/crp-blame-timings.json`,
    ]);
    vi.mocked(gcsGetText).mockImplementation(async (path) =>
      path.includes("-retry1/") ? "invalid" : fixture,
    );
    const result = await fetchCrpTimings(build);
    expect(result.status).toBe("analyzed");
    expect(result.attempts.map((attempt) => attempt.retry)).toEqual([0]);
    expect(result.error).toContain("-retry1/crp-blame-timings.json");
  });

  it("reports listing failures and disappeared artifacts as errors", async () => {
    vi.mocked(gcsListAll).mockImplementation(async function* () {
      yield `${prefix}/crp-blame-timings.json`;
      throw new Error("HTTP 403");
    });
    expect((await fetchCrpTimings(build)).error).toBe("HTTP 403");
    list([`${prefix}/crp-blame-timings.json`]);
    vi.mocked(gcsGetText).mockResolvedValue(null);
    expect((await fetchCrpTimings(build)).status).toBe("error");
  });

  it.each(["PENDING", "ABORTED", "ERROR"] as const)(
    "excludes %s runs without fetching",
    async (result) => {
      expect((await fetchCrpTimings({ ...build, result })).status).toBe(
        "excluded",
      );
      expect(gcsListAll).not.toHaveBeenCalled();
    },
  );
});

describe("CRP build validation", () => {
  it("retains the exact string build ID", () => {
    expect(parseCrpBuild(build, job)).toEqual(build);
  });
  it.each([
    { ...build, id: Number(build.id) },
    { ...build, id: "123" },
    { ...build, id: "2110003893407584257" },
    {
      ...build,
      objectPrefix: build.objectPrefix.replace(
        "openshift_console",
        "openshift_console-operator",
      ),
    },
    { ...build, objectPrefix: build.objectPrefix.replace(job, `${job}-other`) },
    { ...build, objectPrefix: `${build.objectPrefix}../` },
    { ...build, result: "UNKNOWN" },
    null,
  ])("rejects invalid build %j", (value) => {
    expect(() => parseCrpBuild(value, job)).toThrow();
  });
});
