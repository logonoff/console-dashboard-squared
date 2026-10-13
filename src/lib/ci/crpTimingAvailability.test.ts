import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCrpTimingAvailability } from "./crpTimingAvailability";
import { hasCrpTimingData } from "./crpTimings";
import type { Build, CrpTimingResult } from "./types";

const fetchMock = vi.fn<typeof fetch>();
const signal = () => new AbortController().signal;
const build = (suffix = "e2e-gcp-console", index = 0): Build => ({
  id: `21100038934075842${String(index).padStart(2, "0")}`,
  jobName: `pull-ci-openshift-console-main-${suffix}`,
  result: "SUCCESS",
  startedIso: "2026-10-13T15:00:00Z",
  startedMs: index,
  durationMs: 1,
  prNumber: 17379,
  prTitle: null,
  prAuthor: null,
  baseRef: "main",
  objectPrefix: "unused-by-client-probe",
  spyglassUrl: "",
});
const timings: CrpTimingResult = {
  buildId: build().id,
  status: "analyzed",
  attempts: [
    {
      retry: 1,
      sourcePath: "example",
      loads: [[{ name: "sum", duration: 0 }]],
    },
  ],
};
const absent: CrpTimingResult = {
  buildId: build().id,
  status: "no-artifact",
  attempts: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    Response.json({ results: [absent] }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("CRP timing availability", () => {
  it.each(["frontend", "analyze"])(
    "keeps %s hidden when its runs have no timing data",
    async (job) => {
      expect(await checkCrpTimingAvailability([build(job)], signal())).toBe(
        false,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("uses recorded data rather than job names to establish availability", async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [timings] }));
    expect(
      await checkCrpTimingAvailability(
        [build("renamed-playwright-job")],
        signal(),
      ),
    ).toBe(true);
    expect(hasCrpTimingData([timings])).toBe(true);
    expect(
      hasCrpTimingData([
        {
          ...timings,
          attempts: [{ retry: 0, sourcePath: "empty", loads: [[]] }],
        },
      ]),
    ).toBe(false);
  });

  it("does not probe pending, aborted, or errored runs", async () => {
    expect(
      await checkCrpTimingAvailability(
        ["PENDING", "ABORTED", "ERROR"].map((result) => ({
          ...build(),
          result: result as Build["result"],
        })),
        signal(),
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks newest runs first and stops after a batch confirms data", async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [timings] }));
    expect(
      await checkCrpTimingAvailability(
        Array.from({ length: 20 }, (_, i) => build(undefined, i)),
        signal(),
        true,
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.builds).toHaveLength(8);
    expect(request.builds[0].startedMs).toBe(19);
    expect(request.force).toBe(true);
  });

  it("finds data in an older run when the newest batch has no artifact", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ results: [absent] }))
      .mockResolvedValueOnce(Response.json({ results: [timings] }));
    expect(
      await checkCrpTimingAvailability(
        Array.from({ length: 9 }, (_, i) => build(undefined, i)),
        signal(),
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps branch jobs separate and accepts data even if another branch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ error: "unavailable" }, { status: 502 }),
      )
      .mockResolvedValueOnce(Response.json({ results: [timings] }));
    expect(
      await checkCrpTimingAvailability(
        [
          build(),
          {
            ...build(),
            jobName: "pull-ci-openshift-console-release-5.1-e2e-gcp-console",
          },
        ],
        signal(),
      ),
    ).toBe(true);
    const jobs = fetchMock.mock.calls.map(
      ([, request]) => JSON.parse(String(request?.body)).job,
    );
    expect(new Set(jobs).size).toBe(2);
  });

  it("does not treat aborted responses as evidence of available data", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return Response.json({ results: [timings] });
    });
    expect(
      await checkCrpTimingAvailability(
        Array.from({ length: 20 }, (_, i) => build(undefined, i)),
        controller.signal,
      ),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
