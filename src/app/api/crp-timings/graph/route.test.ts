import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCatalog } from "@/lib/ci/catalog";
import { fetchCrpTimings } from "@/lib/ci/crp";
import {
  crpChartRows,
  crpLoadOption,
  crpTrendOption,
  crpTrendRows,
} from "@/lib/ci/crpCharts";
import { parseCrpTimings } from "@/lib/ci/crpTimings";
import { gcsGetText } from "@/lib/ci/gcs";
import { fetchBuildsInWindow } from "@/lib/ci/prow";
import type { Build, CrpTimingResult } from "@/lib/ci/types";
import { GET } from "./route";

const cache = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getOrLoad: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ getCache: () => cache }));
vi.mock("@/lib/ci/catalog", () => ({ fetchCatalog: vi.fn() }));
vi.mock("@/lib/ci/prow", () => ({ fetchBuildsInWindow: vi.fn() }));
vi.mock("@/lib/ci/gcs", () => ({ gcsGetText: vi.fn() }));
vi.mock("@/lib/ci/crp", async (original) => ({
  ...(await original<object>()),
  fetchCrpTimings: vi.fn(),
}));

const job = "pull-ci-openshift-console-main-e2e-gcp-console";
const build: Build = {
  id: "2110003893407584256",
  result: "FAILURE",
  jobName: job,
  startedIso: "2026-10-13T13:45:40.000Z",
  startedMs: 1791899140000,
  durationMs: 1,
  objectPrefix: `pr-logs/pull/openshift_console/17379/${job}/2110003893407584256/`,
  prNumber: 17379,
  prTitle: null,
  prAuthor: null,
  baseRef: "main",
  spyglassUrl: "",
};
const loads = parseCrpTimings(
  readFileSync(
    path.join(
      __dirname,
      "../../../../lib/ci/__fixtures__/crp-blame-timings.json",
    ),
    "utf8",
  ),
);
const result: CrpTimingResult = {
  buildId: build.id,
  status: "analyzed",
  attempts: [
    { retry: 0, sourcePath: "original", loads: loads.slice(0, 1) },
    { retry: 1, sourcePath: "retry", loads },
  ],
};
function request(params: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams({ job });
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, value);
  }
  return new Request(`http://localhost/api/crp-timings/graph?${query}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  cache.getOrLoad.mockImplementation(async (_key, _ttl, load) => load());
  vi.mocked(fetchCatalog).mockResolvedValue([
    {
      id: "main",
      jobs: [
        {
          name: job,
          branch: "main",
          suffix: "e2e-gcp-console",
          lastRunIso: null,
        },
      ],
    },
  ]);
  vi.mocked(fetchBuildsInWindow).mockResolvedValue({
    builds: [build],
    pagesFetched: 1,
    truncated: false,
  });
  vi.mocked(fetchCrpTimings).mockResolvedValue(result);
  vi.mocked(gcsGetText).mockImplementation(async (name) =>
    name.endsWith("started.json")
      ? '{"timestamp":1791899140}'
      : '{"result":"FAILURE"}',
  );
});

describe("CRP graph PNG API", () => {
  it("renders a real PNG with the requested dimensions and graph pixels", async () => {
    const response = await GET(
      request({ width: "800", height: "400", hideWithoutTimings: "1" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-CI-History-Truncated")).toBe("false");
    expect(response.headers.get("Content-Disposition")).toContain(
      "crp-timings-trend.png",
    );
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(400);
    const statistics = await sharp(png).stats();
    expect(statistics.channels[0].stdev).toBeGreaterThan(5);
  });

  it("renders a specific build and retry from GCS without requiring Prow history", async () => {
    const response = await GET(
      request({ view: "loads", pr: "17379", buildId: build.id, retry: "0" }),
    );
    expect(response.status).toBe(200);
    expect(fetchBuildsInWindow).not.toHaveBeenCalled();
    expect(gcsGetText).toHaveBeenCalledWith(
      `${build.objectPrefix}finished.json`,
    );
    expect(fetchCrpTimings).toHaveBeenCalledWith(
      expect.objectContaining({
        id: build.id,
        result: "FAILURE",
        objectPrefix: build.objectPrefix,
      }),
    );
    expect(response.headers.get("Content-Disposition")).toContain(
      "crp-timings-loads.png",
    );
  });

  it.each([
    { job: "https://example.com" },
    { repo: "openshift/console-operator" },
    { view: "invalid" },
    { metric: "" },
    { width: "30000" },
    { height: "NaN" },
    { days: "Infinity" },
    { days: "0" },
    { width: "800.5" },
    { hideWithoutTimings: "yes" },
    { force: "invalid" },
    { retry: "-1", view: "loads" },
    { view: "loads", buildId: build.id },
    { view: "loads", pr: "17379" },
    { view: "loads", pr: "../17379", buildId: build.id },
    { view: "loads", pr: "17379", buildId: "2110003893407584256/../" },
    { buildId: build.id, pr: "17379" },
    { retry: "0" },
  ])("rejects invalid inputs before upstream fetching: %j", async (params) => {
    const response = await GET(request(params));
    expect(response.status).toBe(400);
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("validates the Console job against the catalog", async () => {
    vi.mocked(fetchCatalog).mockResolvedValue([]);
    expect((await GET(request())).status).toBe(400);
    expect(fetchCrpTimings).not.toHaveBeenCalled();
  });

  it("renders a PNG and labels truncation when the larger page cap is reached", async () => {
    vi.mocked(fetchBuildsInWindow).mockResolvedValue({
      builds: [build],
      pagesFetched: 8,
      truncated: true,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-CI-History-Truncated")).toBe("true");
    expect(fetchBuildsInWindow).toHaveBeenCalledWith(
      expect.objectContaining({ maxPages: 32 }),
    );
    expect(fetchCrpTimings).toHaveBeenCalledOnce();
  });

  it("does not reuse the dashboard's truncated eight-page history cache", async () => {
    cache.get.mockImplementation(async (key: string) =>
      key.startsWith("runs:")
        ? { builds: [], pagesFetched: 8, truncated: true }
        : undefined,
    );
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-CI-History-Truncated")).toBe("false");
    expect(fetchBuildsInWindow).toHaveBeenCalledWith(
      expect.objectContaining({ maxPages: 32 }),
    );
  });

  it("reuses complete dashboard history without refetching it", async () => {
    cache.get.mockImplementation(async (key: string) =>
      key.startsWith("runs:")
        ? { builds: [build], pagesFetched: 1, truncated: false }
        : undefined,
    );
    expect((await GET(request())).status).toBe(200);
    expect(fetchBuildsInWindow).not.toHaveBeenCalled();
  });

  it.each([{}, { metric: "missing" }, { view: "loads", retry: "2" }])(
    "returns 404 when timing data, the metric, or the retry is absent: %j",
    async (params) => {
      if (Object.keys(params).length === 0)
        vi.mocked(fetchCrpTimings).mockResolvedValue({
          ...result,
          status: "no-artifact",
          attempts: [],
        });
      expect((await GET(request(params))).status).toBe(404);
    },
  );

  it("reports partial upstream failures instead of silently exporting an incomplete graph", async () => {
    vi.mocked(fetchCrpTimings).mockResolvedValue({
      ...result,
      error: "HTTP 403",
    });
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("HTTP 403");
  });

  it("returns 404 for a missing build and 409 for an unfinished build", async () => {
    vi.mocked(gcsGetText).mockResolvedValue(null);
    expect(
      (await GET(request({ view: "loads", pr: "17379", buildId: build.id })))
        .status,
    ).toBe(404);
    vi.mocked(gcsGetText).mockImplementation(async (name) =>
      name.endsWith("started.json") ? '{"timestamp":1791899140}' : null,
    );
    expect(
      (await GET(request({ view: "loads", pr: "17379", buildId: build.id })))
        .status,
    ).toBe(409);
  });

  it("shares timing caches and force refresh with the JSON endpoint", async () => {
    cache.get.mockImplementation(async (key: string) =>
      key.startsWith("crptimings:") ? result : undefined,
    );
    expect((await GET(request())).status).toBe(200);
    expect(fetchCrpTimings).not.toHaveBeenCalled();
    expect((await GET(request({ force: "1" }))).status).toBe(200);
    expect(fetchCrpTimings).toHaveBeenCalledOnce();
  });
});

describe("shared dashboard and PNG chart definitions", () => {
  it("retains zero measurements, filters only absent metrics, and keeps matching labels and points", () => {
    const other = {
      ...build,
      id: "2110003893407584257",
      startedMs: build.startedMs + 1,
    };
    const zero = {
      ...result,
      attempts: [
        {
          retry: 0,
          sourcePath: "zero",
          loads: [[{ name: "sum", duration: 0 }]],
        },
      ],
    };
    const rows = crpChartRows({ builds: [other, build], results: [zero] });
    const filtered = crpTrendRows(rows, "sum", true);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].stats?.mean).toBe(0);
    const option = crpTrendOption(filtered, "sum", {
      textColor: "#151515",
      timeZone: "UTC",
      interactive: false,
    });
    expect(option.dataZoom).toBeUndefined();
    expect(option.xAxis).toMatchObject({ data: ["Oct 13, 01:45 PM"] });
    expect(option.yAxis).toMatchObject({
      name: "Duration (ms)",
      axisLine: { show: true },
    });
    expect(option.series).toMatchObject([{ data: [{ value: 0 }] }]);
  });

  it("uses the selected retry's page loads and sums repeated component occurrences", () => {
    const option = crpLoadOption(
      result.attempts[1],
      "LoadingBox:DashboardsPage",
    );
    expect(option.xAxis).toMatchObject({
      data: ["Load 1", "Load 2", "Load 3"],
    });
    expect(option.series).toMatchObject([
      {
        data: [
          { value: expect.closeTo(339.4) },
          { value: expect.closeTo(320.5) },
          { value: expect.closeTo(314.1) },
        ],
      },
    ]);
  });
});
