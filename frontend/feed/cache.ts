import { decodeResponse } from '../transport';
import { EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL } from '../constants';
import { parseFeed } from './parser';
import type { NewsItem, FeedResponse, FeedParseStats } from './types';

interface CacheEntry {
  time: number;
  items: NewsItem[];
}

/** Fetches and caches parsed feeds by URL, sharing in-flight requests. */
export class FeedCache {
  private entries = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<NewsItem[]>>();
  private listeners = new Set<() => void>();
  private ttlMs = EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL * 60_000;

  setRefreshInterval(minutes: number) { this.ttlMs = minutes * 60_000; }

  /**
   * @param fetcher Fetches the raw response for an app ID.
   * @param now Clock used to determine cache expiration.
   */
  constructor(
    private fetcher: (appId: string) => Promise<string>,
    private now = Date.now,
    private onParsed?: (stats: FeedParseStats) => void,
  ) {}

  /**
   * Notifies consumers when a parsed feed replaces a cached entry.
   */
  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Returns only fresh cached items without starting a request.
   */
  peek(url: string): NewsItem[] | undefined {
    const entry = this.entries.get(url);

    return entry && this.now() - entry.time < this.ttlMs
      ? entry.items
      : undefined;
  }

  /**
   * Returns the last successful result, including after it expires for refetching.
   */
  peekLast(url: string): NewsItem[] | undefined {
    return this.entries.get(url)?.items;
  }

  /**
   * Removes the cached entry and pending request for a feed URL.
   */
  invalidate(url: string) {
    this.entries.delete(url);
    this.pending.delete(url);
  }

  /**
   * Removes all cached entries and pending requests.
   */
  clear() {
    this.entries.clear(); this.pending.clear();
  }

  /**
   * Returns news items for a feed, fetching and parsing them when the cache expires.
   * @param appId App ID passed to the fetcher.
   * @param url Expected feed URL and cache key.
   * @throws If the response URL differs from the requested feed URL.
   */
  get(appId: string, url: string): Promise<NewsItem[]> {
    const cached = this.entries.get(url);

    if (cached && this.now() - cached.time < this.ttlMs)
      return Promise.resolve(cached.items);

    const pending = this.pending.get(url);

    if (pending)
      return pending;

    const request = this.fetcher(appId).then(raw => {
      const response = decodeResponse<FeedResponse>(raw);

      if (response.url !== url)
        throw new Error('Feed source changed during request');

      const start = performance.now();
      const items = parseFeed(response.xml, response.url);
      try {
        this.onParsed?.({ appId, durationMs: performance.now() - start, itemCount: items.length });
      } catch {
        /* Diagnostics must not prevent a parsed feed from being cached. */
      }

      if (this.pending.get(url) === request) {
        this.entries.set(url, { time: this.now(), items });
        this.listeners.forEach(listener => listener());
      }

      return items;
    }).finally(() => {
      if (this.pending.get(url) === request)
        this.pending.delete(url);
    });

    this.pending.set(url, request);

    return request;
  }
}
