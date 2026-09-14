/**
 * GCS fetch utilities — always runs server-side in route handlers.
 *
 * The bucket is normally public; requests go out unauthenticated unless a
 * Google OAuth2 bearer token is available. See ./googleAuth.
 */

import { USER_AGENT } from "../constants";
import {
  getGoogleAccessToken,
  invalidateGoogleAccessToken,
} from "./googleAuth";

const BUCKET = "test-platform-results";
const GCS_API = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const GCS_MEDIA = `https://storage.googleapis.com/${BUCKET}`;

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

export const GCS_AUTH_HINT =
  "This bucket is refusing the request. If it now requires authentication, set " +
  "GOOGLE_ACCESS_TOKEN to a credential holding storage.objectViewer on it.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriable(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const token = await getGoogleAccessToken();
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
    headers,
  });

  if (res.status === 401 && token && attempt < MAX_RETRIES - 1) {
    // Token likely expired mid-flight — re-mint once and retry.
    invalidateGoogleAccessToken();
    return fetchWithRetry(url, attempt + 1);
  }
  if (!res.ok && isRetriable(res.status) && attempt < MAX_RETRIES - 1) {
    const delay = 1_000 * 2 ** attempt + Math.random() * 500;
    await sleep(delay);
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
}

function describeError(status: number, body: string): string {
  const detail = body.slice(0, 200);
  return status === 401 || status === 403
    ? `HTTP ${status} — ${GCS_AUTH_HINT} ${detail}`
    : `HTTP ${status} ${detail}`;
}

// ---------------------------------------------------------------------------
// GCS JSON List API
// ---------------------------------------------------------------------------

export interface GcsListItem {
  name: string;
  size?: string;
  updated?: string;
}

export interface GcsListResult {
  items: GcsListItem[];
  nextPageToken?: string;
}

/**
 * List GCS objects under a prefix (one page).
 * Pass delimiter="/" for a single-level listing; omit for a flat listing.
 */
export async function gcsListPage(opts: {
  prefix: string;
  delimiter?: string;
  pageToken?: string;
  maxResults?: number;
  fields?: string;
}): Promise<{
  items: GcsListItem[];
  prefixes: string[];
  nextPageToken?: string;
}> {
  const params = new URLSearchParams({
    prefix: opts.prefix,
    maxResults: String(opts.maxResults ?? 1000),
    fields: opts.fields ?? "items(name,size,updated),prefixes,nextPageToken",
  });
  if (opts.delimiter) params.set("delimiter", opts.delimiter);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const res = await fetchWithRetry(`${GCS_API}?${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GCS list ${opts.prefix}: ${describeError(res.status, text)}`,
    );
  }
  const json = await res.json();
  return {
    items: json.items ?? [],
    prefixes: json.prefixes ?? [],
    nextPageToken: json.nextPageToken,
  };
}

/**
 * Iterate ALL objects under a prefix across multiple pages, yielding names.
 * Uses the flat listing (no delimiter) — call this for full recursive discovery.
 */
export async function* gcsListAll(prefix: string): AsyncGenerator<string> {
  let pageToken: string | undefined;
  do {
    const page = await gcsListPage({
      prefix,
      pageToken,
      fields: "items(name),nextPageToken",
    });
    for (const item of page.items) {
      yield item.name;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

// ---------------------------------------------------------------------------
// GCS media download
// ---------------------------------------------------------------------------

/**
 * Download a GCS object by its full path (no leading slash).
 * Returns null on 404. Throws on other errors.
 * Enforces a 25 MB hard cap.
 */
export async function gcsGetText(objectPath: string): Promise<string | null> {
  const url = `${GCS_MEDIA}/${encodeURIComponent(objectPath).replace(/%2F/g, "/")}`;
  const res = await fetchWithRetry(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GCS get ${objectPath}: ${describeError(res.status, text)}`,
    );
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `GCS get ${objectPath}: too large (${contentLength} bytes)`,
    );
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`GCS get ${objectPath}: too large after download`);
  }
  return new TextDecoder().decode(buf);
}

/**
 * Download a GCS object by its full path as a Buffer.
 * Returns null on 404.
 */
export async function gcsGetBuffer(
  objectPath: string,
): Promise<Uint8Array | null> {
  const url = `${GCS_MEDIA}/${encodeURIComponent(objectPath).replace(/%2F/g, "/")}`;
  const res = await fetchWithRetry(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GCS get ${objectPath}: ${describeError(res.status, text)}`,
    );
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `GCS get ${objectPath}: too large (${contentLength} bytes)`,
    );
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`GCS get ${objectPath}: too large after download`);
  }
  return new Uint8Array(buf);
}
