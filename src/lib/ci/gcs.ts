/**
 * GCS fetch utilities — always runs server-side in route handlers.
 * Uses only the anonymous public APIs; no credentials required.
 */

const BUCKET = "test-platform-results";
const GCS_API = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const GCS_MEDIA = `https://storage.googleapis.com/${BUCKET}`;

const USER_AGENT =
  "console-dashboard-squared/1.0 (github.com/openshift/console)";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

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
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok && isRetriable(res.status) && attempt < MAX_RETRIES - 1) {
    const delay = 1_000 * 2 ** attempt + Math.random() * 500;
    await sleep(delay);
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
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
      `GCS list ${opts.prefix}: HTTP ${res.status} ${text.slice(0, 200)}`,
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
      `GCS get ${objectPath}: HTTP ${res.status} ${text.slice(0, 200)}`,
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
    throw new Error(`GCS get ${objectPath}: HTTP ${res.status}`);
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
