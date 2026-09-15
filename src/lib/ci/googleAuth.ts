/**
 * Google OAuth2 access tokens for GCS.
 *
 * Optional. `test-platform-results-public` is normally public, and callers treat a
 * missing token as "send it anonymously".
 *
 * When the bucket does demand credentials it asks for
 * `www-authenticate: Bearer realm="https://accounts.google.com/"`. An API key
 * cannot satisfy that — it identifies a project for quota but leaves the caller
 * anonymous to IAM — so a bearer token is the only option. The token must also
 * carry a binding on the bucket; authenticating without one yields 403.
 *
 * Two sources, in order:
 *   1. GOOGLE_ACCESS_TOKEN  — a pre-minted token (containers, CI, Vercel)
 *   2. `gcloud auth print-access-token` — local development
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GCLOUD_TIMEOUT_MS = 10_000;
/** gcloud tokens last ~1 h; re-mint well before that. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string | null> | null = null;
let gcloudUnavailable = false;

async function mintFromGcloud(): Promise<string | null> {
  if (gcloudUnavailable) return null;
  try {
    const { stdout } = await execFileAsync(
      "gcloud",
      ["auth", "print-access-token"],
      {
        timeout: GCLOUD_TIMEOUT_MS,
      },
    );
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch (err) {
    // ENOENT means gcloud is not installed — stop retrying it every request.
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      gcloudUnavailable = true;
    return null;
  }
}

/**
 * Returns a bearer token, or null when no credential source is configured.
 * Callers treat null as "attempt anonymously" so the failure surfaces as a
 * GCS 401 with actionable text rather than an opaque startup error.
 */
export async function getGoogleAccessToken(): Promise<string | null> {
  const fromEnv = process.env.GOOGLE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  if (cached && Date.now() < cached.expiresAtMs) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const token = await mintFromGcloud();
    cached = token ? { token, expiresAtMs: Date.now() + TOKEN_TTL_MS } : null;
    return token;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Drop the cached token so the next call re-mints. Used after a 401. */
export function invalidateGoogleAccessToken(): void {
  cached = null;
}
