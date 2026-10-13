import { beforeEach, describe, expect, it, vi } from "vitest";
import { keys, TTL } from "@/lib/cache/keys";
import { fetchCrpTimings } from "@/lib/ci/crp";
import { POST } from "./route";

const cache = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getOrLoad: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ getCache: () => cache }));
vi.mock("@/lib/ci/crp", async (original) => ({
  ...(await original<object>()),
  fetchCrpTimings: vi.fn(),
}));

const job = "pull-ci-openshift-console-main-e2e-gcp-console";
const build = {
  id: "2110003893407584256",
  result: "FAILURE",
  objectPrefix: `pr-logs/pull/openshift_console/17379/${job}/2110003893407584256/`,
};
const body = { repo: "openshift/console", job, builds: [build] };
const request = (data: unknown) =>
  new Request("http://localhost/api/crp-timings", {
    method: "POST",
    body: JSON.stringify(data),
  });

beforeEach(() => {
  vi.resetAllMocks();
  cache.getOrLoad.mockResolvedValue([{ id: "main", jobs: [{ name: job }] }]);
  vi.mocked(fetchCrpTimings).mockResolvedValue({
    buildId: build.id,
    status: "no-artifact",
    attempts: [],
  });
});

describe("Console CRP timings API", () => {
  it.each([
    null,
    [],
    { ...body, repo: "openshift/console-operator" },
    { ...body, builds: Array(9).fill(build) },
    { ...body, builds: [{ ...build, id: Number(build.id) }] },
    {
      ...body,
      builds: [{ ...build, objectPrefix: `${build.objectPrefix}../` }],
    },
    { ...body, job: "https://example.com" },
  ])("rejects invalid requests before any upstream fetch: %j", async (data) => {
    expect((await POST(request(data))).status).toBe(400);
    expect(cache.getOrLoad).not.toHaveBeenCalled();
    expect(fetchCrpTimings).not.toHaveBeenCalled();
  });

  it("requires the job to exist in the Console catalog", async () => {
    cache.getOrLoad.mockResolvedValue([]);
    expect((await POST(request(body))).status).toBe(400);
    expect(fetchCrpTimings).not.toHaveBeenCalled();
  });

  it("returns exact string build IDs and caches completed results", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ buildId: build.id, status: "no-artifact", attempts: [] }],
    });
    expect(cache.set).toHaveBeenCalledWith(
      keys.crpTimings(build.id),
      expect.objectContaining({ buildId: build.id }),
      TTL.IMMUTABLE,
    );
  });

  it("uses the timing cache unless force is requested", async () => {
    const cached = { buildId: build.id, status: "analyzed", attempts: [] };
    cache.get.mockResolvedValue(cached);
    expect(await (await POST(request(body))).json()).toEqual({
      results: [cached],
    });
    expect(fetchCrpTimings).not.toHaveBeenCalled();
    await POST(request({ ...body, force: true }));
    expect(fetchCrpTimings).toHaveBeenCalledOnce();
  });

  it.each(["error", "analyzed"] as const)(
    "does not cache %s results with upstream errors",
    async (status) => {
      vi.mocked(fetchCrpTimings).mockResolvedValue({
        buildId: build.id,
        status,
        attempts: [],
        error: "HTTP 403",
      });
      expect((await POST(request(body))).status).toBe(200);
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it("does not read or write immutable timing caches for pending builds", async () => {
    vi.mocked(fetchCrpTimings).mockResolvedValue({
      buildId: build.id,
      status: "excluded",
      attempts: [],
    });
    await POST(request({ ...body, builds: [{ ...build, result: "PENDING" }] }));
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("returns upstream catalog failures as 502 responses", async () => {
    cache.getOrLoad.mockRejectedValue(new Error("GCS unavailable"));
    const response = await POST(request(body));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "GCS unavailable" });
  });
});
