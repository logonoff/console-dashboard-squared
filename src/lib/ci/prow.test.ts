import { describe, expect, it } from "vitest";
import { type ProwBuild, prowToBuild } from "./prow";
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
