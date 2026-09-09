/**
 * In-memory LRU cache tier.
 *
 * Eviction policy: LRU by insertion order (delete + re-insert on access).
 * Two caps: max entry count and approx byte size (via JSON.stringify length).
 */

import type { CacheEntry, CacheTier } from "./index";

const MAX_ENTRIES = 500;
const MAX_BYTES = 64 * 1024 * 1024; // 64 MB

export class MemoryTier implements CacheTier {
  readonly name = "memory";
  private map = new Map<
    string,
    { entry: CacheEntry<unknown>; bytes: number }
  >();
  private totalBytes = 0;

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // LRU: move to end
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.entry as CacheEntry<T>;
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    // Remove old entry bytes
    const old = this.map.get(key);
    if (old) {
      this.totalBytes -= old.bytes;
      this.map.delete(key);
    }
    const bytes = JSON.stringify(entry.v).length;
    this.map.set(key, { entry: entry as CacheEntry<unknown>, bytes });
    this.totalBytes += bytes;
    this.evict();
  }

  async delete(key: string): Promise<void> {
    const old = this.map.get(key);
    if (old) {
      this.totalBytes -= old.bytes;
      this.map.delete(key);
    }
  }

  async clearPrefix(prefix: string): Promise<void> {
    for (const [key, val] of this.map.entries()) {
      if (key.startsWith(prefix)) {
        this.totalBytes -= val.bytes;
        this.map.delete(key);
      }
    }
  }

  private evict(): void {
    // Evict oldest entries until under both caps
    const iter = this.map.entries();
    while (this.map.size > MAX_ENTRIES || this.totalBytes > MAX_BYTES) {
      const next = iter.next();
      if (next.done) break;
      const [key, val] = next.value;
      this.totalBytes -= val.bytes;
      this.map.delete(key);
    }
  }
}
