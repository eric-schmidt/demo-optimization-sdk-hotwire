// Replacement for Next.js Cache Components: the "use cache" directive,
// cacheLife(), cacheTag() and revalidateTag().
//
// The property that matters — and the reason ADR 0001 migrated to Cache
// Components in the first place — is that tags are declared *during* the fetch
// rather than derived from its arguments. That lets a cache entry be tagged with
// the sys.id of every entry and asset in the response graph, which is what makes
// the revalidation webhook a one-liner and makes tag identity survive a slug
// rename. So `cached()` hands the work function a `tag()` callback instead of
// taking a tag list up front.
//
// Scope: this cache lives in the Node process. It does not survive a restart and
// does not span instances. That is correct for a demo; the CacheStore surface is
// narrow enough that a Redis adapter is a drop-in when it stops being.

/** Mirrors next.config.js `cacheLife`. Seconds. */
export type CacheProfile = {
  /** How long a browser may treat the response as fresh. */
  stale: number;
  /** After this, serve stale and refresh in the background. */
  revalidate: number;
  /** After this, a read must block on a fresh fetch. */
  expire: number;
};

export const PROFILES = {
  contentful: { stale: 300, revalidate: 900, expire: 3600 },
} as const satisfies Record<string, CacheProfile>;

export type ProfileName = keyof typeof PROFILES;

type StoredEntry = {
  value: unknown;
  storedAt: number;
  tags: Set<string>;
};

const store = new Map<string, StoredEntry>();
/** tag -> cache keys carrying that tag. The inverse index revalidateTag needs. */
const tagIndex = new Map<string, Set<string>>();
/** In-flight fetches, so a stampede of concurrent misses does one request. */
const inflight = new Map<string, Promise<unknown>>();

const now = () => Date.now();

/** Remove a key from every tag bucket it appears in. */
const unlink = (key: string, tags: Iterable<string>) => {
  for (const tag of tags) {
    const keys = tagIndex.get(tag);
    if (!keys) continue;
    keys.delete(key);
    if (keys.size === 0) tagIndex.delete(tag);
  }
};

const commit = (key: string, value: unknown, tags: Set<string>) => {
  const previous = store.get(key);
  if (previous) unlink(key, previous.tags);

  store.set(key, { value, storedAt: now(), tags });
  for (const tag of tags) {
    let keys = tagIndex.get(tag);
    if (!keys) {
      keys = new Set();
      tagIndex.set(tag, keys);
    }
    keys.add(key);
  }
};

const refresh = <T>(
  key: string,
  work: (tag: (tag: string) => void) => Promise<T>,
): Promise<T> => {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const tags = new Set<string>();
  const promise = work((tag) => {
    tags.add(tag);
  })
    .then((value) => {
      commit(key, value, tags);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise as Promise<unknown>);
  return promise;
};

export type CacheOutcome = "hit" | "stale" | "miss";

/** Set by the most recent `cached()` call. Read only for dev logging. */
export let lastOutcome: CacheOutcome = "miss";

/**
 * Cache `work` under `key`, obeying `profile`'s staleness windows.
 *
 * `work` receives a `tag()` callback; every tag it registers is attached to the
 * resulting cache entry, so `revalidateTag()` can evict it later.
 */
export const cached = async <T>(
  key: string,
  profileName: ProfileName,
  work: (tag: (tag: string) => void) => Promise<T>,
): Promise<T> => {
  const profile = PROFILES[profileName];
  const entry = store.get(key);

  if (entry) {
    const ageSeconds = (now() - entry.storedAt) / 1000;

    if (ageSeconds < profile.revalidate) {
      lastOutcome = "hit";
      return entry.value as T;
    }

    if (ageSeconds < profile.expire) {
      // Stale-while-revalidate: answer immediately, refresh behind the response.
      lastOutcome = "stale";
      void refresh(key, work).catch((error) => {
        console.error(`[cache] background refresh failed for ${key}:`, error);
      });
      return entry.value as T;
    }
  }

  lastOutcome = "miss";
  return refresh(key, work);
};

/**
 * Evict every cache entry tagged `tag`.
 *
 * Called by the Contentful webhook handler with a bare sys.id, which works
 * because every entry and asset in a cached response graph contributed a tag.
 */
export const revalidateTag = (tag: string): number => {
  const keys = tagIndex.get(tag);
  if (!keys || keys.size === 0) return 0;

  const evicted = [...keys];
  for (const key of evicted) {
    const entry = store.get(key);
    if (entry) unlink(key, entry.tags);
    store.delete(key);
  }
  tagIndex.delete(tag);
  return evicted.length;
};

/** Diagnostics for the verification steps in the README. */
export const cacheStats = () => ({
  entries: store.size,
  tags: tagIndex.size,
  inflight: inflight.size,
});
