/**
 * Layered cache: in-memory LRU + filesystem tier.
 *
 * The FS tier is self-disabling on read-only or inaccessible filesystems,
 * so deployment on Vercel (/tmp) and in containers works without config.
 *
 * Singleton is pinned to globalThis so Turbopack HMR module re-evaluation
 * doesn't create a fresh (empty) instance on every hot reload.
 */

import { FsTier } from "./fs";
import type { TtlMs } from "./keys";
import { MemoryTier } from "./memory";

export type { TtlMs };

export interface CacheEntry<T> {
  v: T;
  /** Unix ms expiry; null = immutable (never expires) */
  exp: number | null;
}

export interface CacheTier {
  readonly name: string;
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  clearPrefix(prefix: string): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  fsEnabled: boolean;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl: TtlMs): Promise<void>;
  getOrLoad<T>(
    key: string,
    ttl: TtlMs,
    load: () => Promise<T>,
    opts?: { force?: boolean },
  ): Promise<T>;
  invalidate(key: string): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
  stats(): CacheStats;
}

// ---------------------------------------------------------------------------
// LayeredCache
// ---------------------------------------------------------------------------

class LayeredCache implements Cache {
  private memory: MemoryTier;
  private fs: FsTier;
  private hits = 0;
  private misses = 0;
  // In-flight dedupe: concurrent callers for the same key share one Promise.
  private inFlight = new Map<string, Promise<unknown>>();

  constructor() {
    this.memory = new MemoryTier();
    this.fs = new FsTier();
  }

  async get<T>(key: string): Promise<T | undefined> {
    // Memory tier
    const memEntry = await this.memory.get<T>(key);
    if (memEntry && (memEntry.exp === null || memEntry.exp > Date.now())) {
      this.hits++;
      return memEntry.v;
    }
    // FS tier
    const fsEntry = await this.fs.get<T>(key);
    if (fsEntry && (fsEntry.exp === null || fsEntry.exp > Date.now())) {
      this.hits++;
      // Promote into memory
      await this.memory.set(key, fsEntry);
      return fsEntry.v;
    }
    this.misses++;
    return undefined;
  }

  async set<T>(key: string, value: T, ttl: TtlMs): Promise<void> {
    const exp = ttl === "immutable" ? null : Date.now() + ttl;
    const entry: CacheEntry<T> = { v: value, exp };
    await this.memory.set(key, entry);
    await this.fs.set(key, entry);
  }

  async getOrLoad<T>(
    key: string,
    ttl: TtlMs,
    load: () => Promise<T>,
    opts?: { force?: boolean },
  ): Promise<T> {
    if (!opts?.force) {
      const cached = await this.get<T>(key);
      if (cached !== undefined) return cached;
    }
    // Dedupe concurrent loads for the same key
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      const value = await load();
      await this.set(key, value, ttl);
      return value;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise as Promise<T>;
  }

  async invalidate(key: string): Promise<void> {
    await this.memory.delete(key);
    await this.fs.delete(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    await this.memory.clearPrefix(prefix);
    await this.fs.clearPrefix(prefix);
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      fsEnabled: !this.fs.disabled,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const CACHE_SYMBOL = Symbol.for("console-dashboard-squared.cache");
type GlobalWithCache = typeof globalThis & { [CACHE_SYMBOL]?: Cache };

export function getCache(): Cache {
  const g = globalThis as GlobalWithCache;
  if (!g[CACHE_SYMBOL]) {
    g[CACHE_SYMBOL] = new LayeredCache();
  }
  // biome-ignore lint/style/noNonNullAssertion: we just set it above
  return g[CACHE_SYMBOL]!;
}
