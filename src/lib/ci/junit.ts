/**
 * junit XML parser.
 *
 * Uses fast-xml-parser (v5, pure JS, zero native deps).
 *
 * Design follows the ci-search approach:
 *   - Accept root <testsuites> OR a bare <testsuite> (unwrapped)
 *   - Retry dedup: group by (suiteName, caseName, classname) preserving
 *     document order; final outcome = last attempt; flaked = FAIL→PASS
 *   - <error> counts as a failure (deliberate divergence from ci-search's
 *     Go struct which misroutes <error> to system-err)
 *   - Never trust header attributes — recount from elements
 */

import { XMLParser } from "fast-xml-parser";
import { isCiOperatorJunit } from "./artifacts";
import type {
  CaseOutcome,
  CaseResult,
  SuiteOrigin,
  SuiteResult,
} from "./types";

// ---------------------------------------------------------------------------
// fast-xml-parser config
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false, // keep strings; parse numbers ourselves
  parseTagValue: false,
  trimValues: true,
  cdataPropName: "#cdata",
  textNodeName: "#text",
  processEntities: true,
  allowBooleanAttributes: true,
  isArray: (name) =>
    [
      "testsuites",
      "testsuite",
      "testcase",
      "failure",
      "error",
      "skipped",
    ].includes(name),
});

// ---------------------------------------------------------------------------
// Raw XML shape helpers
// ---------------------------------------------------------------------------

type Cdata = string | { "#cdata": string };

function cdataText(v: Cdata | Cdata[] | undefined): string | null {
  if (v === undefined || v === null) return null;
  const arr = Array.isArray(v) ? v : [v];
  const parts = arr.map((item) =>
    typeof item === "string" ? item : (item["#cdata"] ?? ""),
  );
  return parts.join("").trim() || null;
}

function attr(obj: Record<string, unknown>, name: string): string {
  return String(obj[`@_${name}`] ?? "");
}

// ---------------------------------------------------------------------------
// Message normalisation
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function normaliseMessage(raw: string | null): string | null {
  if (!raw) return null;
  return (
    raw
      .replace(ANSI_RE, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 300) || null
  );
}

// ---------------------------------------------------------------------------
// Retry dedup
// ---------------------------------------------------------------------------

interface RawCase {
  name: string;
  classname: string | null;
  outcome: CaseOutcome;
  failureType: string | null;
  failureMessage: string | null;
  timeSec: number;
}

function dedup(raw: RawCase[], suiteName: string): CaseResult[] {
  // Group by (suiteName, caseName, classname) in document order
  type Key = string;
  const groups = new Map<Key, RawCase[]>();
  const order: Key[] = [];

  for (const c of raw) {
    const key = `${suiteName}\0${c.name}\0${c.classname ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)?.push(c);
  }

  return order.flatMap((key): CaseResult[] => {
    const group = groups.get(key);
    if (!group || group.length === 0) return [];
    const last = group[group.length - 1];
    const attempts = group.length;
    const flaked =
      attempts > 1 &&
      last.outcome === "pass" &&
      group.slice(0, -1).some((c) => c.outcome === "fail");
    return [
      {
        name: last.name,
        classname: last.classname,
        outcome: last.outcome,
        attempts,
        flaked,
        failureType: last.failureType,
        failureMessage: last.failureMessage,
        timeSec: last.timeSec,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Parsing one <testsuite> element
// ---------------------------------------------------------------------------

function parseSuite(
  suiteObj: Record<string, unknown>,
  origin: SuiteOrigin,
): SuiteResult {
  const name = attr(suiteObj, "name");
  const file = attr(suiteObj, "file") || null;

  const rawCases: RawCase[] = [];
  const testcases = (suiteObj.testcase as Array<Record<string, unknown>>) ?? [];

  for (const tc of testcases) {
    const caseName = attr(tc, "name");
    const classname = attr(tc, "classname") || null;
    const timeSec = parseFloat(attr(tc, "time")) || 0;

    // biome-ignore lint/complexity/useLiteralKeys: xml element names
    const failures = (tc["failure"] as Array<Record<string, unknown>>) ?? [];
    // biome-ignore lint/complexity/useLiteralKeys: xml element names
    const errors = (tc["error"] as Array<Record<string, unknown>>) ?? [];
    // biome-ignore lint/complexity/useLiteralKeys: xml element names
    const skipped = tc["skipped"] !== undefined && tc["skipped"] !== null;

    let outcome: CaseOutcome = "pass";
    let failureType: string | null = null;
    let failureMessage: string | null = null;

    if (failures.length > 0) {
      outcome = "fail";
      const f = failures[0] as Record<string, unknown>;
      failureType = attr(f, "type") || null;
      failureMessage = normaliseMessage(
        cdataText(f["#cdata"] as Cdata | undefined) ??
          attr(f, "message") ??
          null,
      );
    } else if (errors.length > 0) {
      // <error> counts as a failure — deliberate divergence from ci-search
      outcome = "fail";
      const e = errors[0] as Record<string, unknown>;
      failureType = attr(e, "type") || "error";
      failureMessage = normaliseMessage(
        cdataText(e["#cdata"] as Cdata | undefined) ??
          attr(e, "message") ??
          null,
      );
    } else if (skipped) {
      outcome = "skip";
    }

    rawCases.push({
      name: caseName,
      classname,
      outcome,
      failureType,
      failureMessage,
      timeSec,
    });
  }

  const cases = dedup(rawCases, name);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let flaked = 0;
  for (const c of cases) {
    if (c.outcome === "pass" && !c.flaked) passed++;
    else if (c.outcome === "pass" && c.flaked) {
      passed++;
      flaked++;
    } else if (c.outcome === "fail") failed++;
    else if (c.outcome === "skip") skipped++;
  }

  return {
    name,
    file,
    origin,
    cases,
    counts: { total: cases.length, passed, failed, skipped, flaked },
    ran: cases.some((c) => c.outcome !== "skip"),
  };
}

// ---------------------------------------------------------------------------
// Parse a full XML document
// ---------------------------------------------------------------------------

export interface ParseResult {
  suites: SuiteResult[];
  unwrapped: boolean;
}

export function parseJunit(xml: string): ParseResult {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { suites: [], unwrapped: false };
  }

  let suiteArray: Array<Record<string, unknown>>;
  let unwrapped = false;

  if (doc.testsuites) {
    // Root <testsuites>
    const ts = doc.testsuites as Array<Record<string, unknown>>;
    const root = ts[0] ?? {};
    suiteArray = (root.testsuite as Array<Record<string, unknown>>) ?? [];
  } else if (doc.testsuite) {
    // Bare <testsuite>
    const ts = doc.testsuite as Array<Record<string, unknown>>;
    suiteArray = ts;
    unwrapped = true;
  } else {
    return { suites: [], unwrapped: false };
  }

  const suites: SuiteResult[] = [];

  for (const s of suiteArray) {
    const suiteName = attr(s, "name");
    // Drop Root Suite placeholders (Cypress emits one per spec with tests="0")
    const testCount = parseInt(attr(s, "tests"), 10);
    if (
      suiteName === "Root Suite" &&
      (Number.isNaN(testCount) || testCount === 0)
    ) {
      continue;
    }

    const origin: SuiteOrigin = isCiOperatorJunit(suiteName)
      ? "ci-operator"
      : "test";
    suites.push(parseSuite(s, origin));
  }

  return { suites, unwrapped };
}
