import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBuildsInWindow, type ProwBuild, prowToBuild } from "./prow";
import { objectPrefixRE, REPOSITORIES } from "./repository";

const TEST_REPO = REPOSITORIES["openshift/console"];
const OBJECT_PREFIX_RE = objectPrefixRE(TEST_REPO);

const JOB_NAME = "pull-ci-openshift-console-release-5.0-e2e-gcp-console";
const BUILD_ID = "2097545731324776448";
const RELATIVE_PATH = `pr-logs/pull/openshift_console/17149/${JOB_NAME}/${BUILD_ID}`;

function makeRaw(
  spyglassLink: string,
  overrides: Partial<ProwBuild> = {},
): ProwBuild {
  return {
    SpyglassLink: spyglassLink,
    ID: BUILD_ID,
    Started: "2026-09-01T00:00:00Z",
    Duration: 60_000_000_000,
    Result: "FAILURE",
    ...overrides,
  };
}

describe("prowToBuild — bucket rename edge case", () => {
  it("strips the current bucket name into a valid relative objectPrefix", () => {
    const raw = makeRaw(
      `/view/gs/test-platform-results-public/${RELATIVE_PATH}`,
    );
    const build = prowToBuild(raw, JOB_NAME);
    expect(build.objectPrefix).toBe(`${RELATIVE_PATH}/`);
    expect(OBJECT_PREFIX_RE.test(build.objectPrefix)).toBe(true);
  });

  it("strips an old/renamed bucket name the same way (regression: bucket migration)", () => {
    // Older prow job-history entries can still reference a bucket that has
    // since been retired. Historically the strip was pinned to the literal
    // current bucket name, so this case left objectPrefix as
    // "/view/gs/origin-ci-test/pr-logs/..." — which failed the API route's
    // objectPrefixRE validation and 400'd the entire analyze batch.
    const raw = makeRaw(`/view/gs/origin-ci-test/${RELATIVE_PATH}`);
    const build = prowToBuild(raw, JOB_NAME);
    expect(build.objectPrefix).toBe(`${RELATIVE_PATH}/`);
    expect(OBJECT_PREFIX_RE.test(build.objectPrefix)).toBe(true);
  });

  it("produces the same objectPrefix regardless of which bucket the link names", () => {
    const current = prowToBuild(
      makeRaw(`/view/gs/test-platform-results-public/${RELATIVE_PATH}`),
      JOB_NAME,
    );
    const retired = prowToBuild(
      makeRaw(`/view/gs/some-other-retired-bucket/${RELATIVE_PATH}`),
      JOB_NAME,
    );
    expect(retired.objectPrefix).toBe(current.objectPrefix);
  });

  it("normalizes a missing trailing slash", () => {
    const raw = makeRaw(
      `/view/gs/test-platform-results-public/${RELATIVE_PATH}`,
    );
    const build = prowToBuild(raw, JOB_NAME);
    expect(build.objectPrefix.endsWith("/")).toBe(true);
  });

  it("preserves the original bucket in the human-facing spyglassUrl", () => {
    const raw = makeRaw(`/view/gs/origin-ci-test/${RELATIVE_PATH}`);
    const build = prowToBuild(raw, JOB_NAME);
    expect(build.spyglassUrl).toBe(
      `https://prow.ci.openshift.org/view/gs/origin-ci-test/${RELATIVE_PATH}`,
    );
  });
});

describe("job-history pagination limits", () => {
  afterEach(() => vi.unstubAllGlobals());

  function history() {
    const pages = Array.from({ length: 13 }, (_, index) => {
      const id = (BigInt(BUILD_ID) - BigInt(index)).toString();
      const next = (BigInt(BUILD_ID) - BigInt(index + 1)).toString();
      const raw = makeRaw(
        `/view/gs/test-platform-results-public/${RELATIVE_PATH}`,
        {
          ID: id,
          Started: new Date(Date.UTC(2026, 9, 13 - index)).toISOString(),
        },
      );
      return {
        id,
        html: `var allBuilds = ${JSON.stringify([raw])};\n<a href="?buildId=${next}">Older</a>`,
      };
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const id = new URL(String(url)).searchParams.get("buildId");
      const page =
        id === null ? pages[0] : pages.find((entry) => entry.id === id);
      if (!page) throw new Error("Unexpected pagination cursor");
      return new Response(page.html);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("keeps the default eight-page cap for dashboard calls", async () => {
    const fetchMock = history();
    const result = await fetchBuildsInWindow({
      jobName: JOB_NAME,
      cutoffMs: Date.UTC(2026, 9, 3),
    });
    expect(result.truncated).toBe(true);
    expect(result.pagesFetched).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("can continue beyond eight pages to cover the PNG's requested window", async () => {
    const fetchMock = history();
    const result = await fetchBuildsInWindow({
      jobName: JOB_NAME,
      cutoffMs: Date.UTC(2026, 9, 3),
      maxPages: 32,
    });
    expect(result.truncated).toBe(false);
    expect(result.pagesFetched).toBe(12);
    expect(result.builds).toHaveLength(11);
    expect(result.builds.at(-1)?.id).toBe(
      (BigInt(BUILD_ID) - BigInt(10)).toString(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });
});
