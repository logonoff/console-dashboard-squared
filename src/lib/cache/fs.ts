/**
 * Filesystem cache tier.
 *
 * Self-disabling on read-only / inaccessible filesystems (Vercel read-only FS).
 * Uses /tmp by default, or CI_CACHE_DIR if set.
 *
 * Keys are namespaced (first segment) so clearPrefix can rm -rf a directory.
 * Writes are atomic: writeFile(tmp) → rename(tmp, final).
 *
 * Imports node: builtins explicitly so accidental client bundling fails loudly.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CacheEntry, CacheTier } from "./index";

const DISABLE_CODES = new Set([
  "EROFS",
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EMFILE",
  "ENOTDIR",
]);
const ROOT =
  process.env.CI_CACHE_DIR ?? join(tmpdir(), "console-dashboard-squared-cache");

function keyToPath(key: string): string {
  const namespace = key.split(":")[0] ?? "misc";
  const hash = createHash("sha256").update(key).digest("hex");
  const shard = hash.slice(0, 2);
  return join(ROOT, namespace, shard, `${hash}.json`);
}

function namespaceDir(prefix: string): string {
  return join(/* turbopackIgnore: true */ ROOT, prefix.split(":")[0] ?? "misc");
}

export class FsTier implements CacheTier {
  readonly name = "fs";
  disabled = false;
  private initPromise: Promise<void> | null = null;

  private async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = mkdir(ROOT, { recursive: true })
        .then(() => undefined)
        .catch((err: NodeJS.ErrnoException) => {
          if (DISABLE_CODES.has(err.code ?? "")) {
            this.disabled = true;
            console.warn(`[cache/fs] disabled: ${err.code} on ${ROOT}`);
          }
        });
    }
    return this.initPromise;
  }

  private handleError(err: NodeJS.ErrnoException, op: string): void {
    if (DISABLE_CODES.has(err.code ?? "")) {
      if (!this.disabled) {
        this.disabled = true;
        console.warn(`[cache/fs] disabled: ${err.code} during ${op}`);
      }
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    if (this.disabled) return undefined;
    await this.init();
    if (this.disabled) return undefined;
    const path = keyToPath(key);
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as CacheEntry<T>;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return undefined;
      if (e.code === "SyntaxError" || e.name === "SyntaxError") {
        await unlink(path).catch(() => {});
        return undefined;
      }
      this.handleError(e, "get");
      return undefined;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    if (this.disabled) return;
    await this.init();
    if (this.disabled) return;
    const path = keyToPath(key);
    const dir = join(path, "..");
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, path);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      await unlink(tmp).catch(() => {});
      if (e.code === "ENOENT") {
        // mkdir might have raced; try once more
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(tmp, JSON.stringify(entry), "utf8");
          await rename(tmp, path);
        } catch (err2) {
          this.handleError(err2 as NodeJS.ErrnoException, "set-retry");
        }
      } else {
        this.handleError(e, "set");
      }
    }
  }

  async delete(key: string): Promise<void> {
    if (this.disabled) return;
    const path = keyToPath(key);
    await unlink(path).catch(() => {});
  }

  async clearPrefix(prefix: string): Promise<void> {
    if (this.disabled) return;
    const dir = namespaceDir(prefix);
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      this.handleError(err as NodeJS.ErrnoException, "clearPrefix");
    });
  }
}
