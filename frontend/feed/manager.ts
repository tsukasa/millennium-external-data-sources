import { FeedCache, httpUrl } from './index';
import { getPluginI18nString } from '../i18n';
import { backendWrite, decodeResponse } from '../transport';
import { notifyListeners } from '../listeners';
import {
  EXTERNAL_NEWS_DEFAULT_MAX_ITEMS, EXTERNAL_NEWS_MAX_ITEMS, EXTERNAL_NEWS_MAX_FETCH_INTERVAL,
  EXTERNAL_NEWS_MIN_FETCH_INTERVAL, EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES,
  EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES, EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL,
  EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES
} from '../constants';
import type { FeedSourceSettings, FeedSourceSettingsByAppId, GlobalFeedSettings } from './types';

export class FeedManager {
  revision = 0;
  refreshIntervalMinutes = EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL;
  concurrentFetches = EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES;
  sources: Record<string, FeedSourceSettings> = {};
  feedRemovedItems = new Set<string>();

  private disposed = false;
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private removalWrite: Promise<void> = Promise.resolve();
  private backgroundRefreshStarted = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private prefetching?: Promise<void>;
  private failedRefreshes = new Map<string, number>();

  readonly cache = new FeedCache(id => backend.fetchFeed(id), Date.now, ({ appId, durationMs, itemCount }) => {
    console.info(`[External Data Sources] Parsed feed for ${appId}: ${itemCount} items in ${durationMs.toFixed(1)} ms`);
  });

  load(): Promise<void> {
    return this.loading ||= Promise.all([
      backend.getFeedSources(),
      backend.getFeedRemovedItems(),
      backend.getFeedSettings(),
    ]).then(([feedSources, removedFeedItemsList, globalFeedSettings]) => {
      const settings = decodeResponse<FeedSourceSettingsByAppId>(feedSources) || {};

      const removedItems = decodeResponse<unknown>(removedFeedItemsList);

      const global = decodeResponse<GlobalFeedSettings>(globalFeedSettings) || {};

      this.refreshIntervalMinutes = FeedManager.isValidGlobalFeedIntervalValue(global.refreshIntervalMinutes)
        ? global.refreshIntervalMinutes
        : EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL;

      this.concurrentFetches = FeedManager.isValidGlobalFeedConcurrencyValue(global.concurrentFetches)
        ? global.concurrentFetches
        : EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES;

      this.cache.setRefreshInterval(this.refreshIntervalMinutes);

      this.sources = Object.fromEntries(Object.entries(settings)
        .map(([id, entry]) => {
          const limit = entry.maxItemsFromFeedInWhatsNew;
          return [id, {
            url: entry.url || '',
            showFeedInWhatsNew: entry.showFeedInWhatsNew !== false,
            maxItemsFromFeedInWhatsNew: typeof limit === 'number'
              && Number.isInteger(limit) && limit >= 0 && limit <= EXTERNAL_NEWS_MAX_ITEMS
              ? limit : EXTERNAL_NEWS_DEFAULT_MAX_ITEMS,
          }];
        })
      );

      this.feedRemovedItems = new Set(Array.isArray(removedItems)
        ? removedItems.filter((url): url is string => typeof url === 'string')
        : []);

      this.notify();
    }).catch(error => {
      this.loading = undefined;
      throw error;
    });
  }

  /**
   * Validates a feed refresh interval in minutes.
   * Interval is only valid if >= 10 and <= 360.
   */
  public static isValidGlobalFeedIntervalValue(value: unknown): value is number {
    return typeof value === 'number'
      && Number.isInteger(value)
      && value >= EXTERNAL_NEWS_MIN_FETCH_INTERVAL
      && value <= EXTERNAL_NEWS_MAX_FETCH_INTERVAL;
  }

  /**
   * Validates the number of simultaneous feed fetches.
   * Concurrency is only valid if >= 1 and <= 8.
   */
  public static isValidGlobalFeedConcurrencyValue(value: unknown): value is number {
    return typeof value === 'number'
      && Number.isInteger(value)
      && value >= EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES
      && value <= EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES;
  }

  /** Updates the plugin feed settings and restarts the background refresh timer. */
  async setPluginFeedSettings(intervalMinutes: number, concurrentFetches: number): Promise<void> {
    const valid = FeedManager.isValidGlobalFeedIntervalValue(intervalMinutes)
      && FeedManager.isValidGlobalFeedConcurrencyValue(concurrentFetches);
    if (!valid)
      throw new Error(getPluginI18nString('couldNotSaveFeedSettings'));

    await backendWrite(() => backend.setFeedSettings(intervalMinutes, concurrentFetches),
      getPluginI18nString('couldNotSaveFeedSettings'));

    this.refreshIntervalMinutes = intervalMinutes;
    this.concurrentFetches = concurrentFetches;

    this.cache.setRefreshInterval(intervalMinutes);

    // Restart the timer for background refresh.
    if (this.backgroundRefreshStarted)
      this.startRefreshTimer();

    this.notify();
  }

  /** Warms the feed cache without delaying library render. */
  prefetchConfigured(preferredId?: string): Promise<void> {
    return this.prefetching ||= this.runPrefetch(preferredId).finally(() => {
      this.prefetching = undefined;
    });
  }

  /** Prefetches all configured feeds, prioritizing the preferred AppID if provided. */
  private async runPrefetch(preferredId?: string): Promise<void> {
    const entries = Object.entries(this.sources).filter(([, source]) => !!source.url);
    const preferred = entries.findIndex(([id]) => id === preferredId);
    let next = 0;

    if (preferred > 0)
      entries.unshift(entries.splice(preferred, 1)[0]);

    const worker = async () => {
      while (!this.disposed && next < entries.length) {
        const [id, { url }] = entries[next++];
        const failedAt = this.failedRefreshes.get(url);

        if (failedAt !== undefined && Date.now() < failedAt + this.refreshIntervalMinutes * 60_000)
          continue;

        try {
          await this.cache.get(id, url);
          this.failedRefreshes.delete(url);
        } catch {
          /* Keep the last successful feed and retry on the next refresh. */
          if (!this.disposed)
            this.failedRefreshes.set(url, Date.now());
        }
      }
    };

    await Promise.all(Array.from({length: Math.min(this.concurrentFetches, entries.length) }, worker));
  }

  /** Starts one background loading loop for all configured feeds. */
  startBackgroundRefresh(preferredId?: string): void {
    if (this.disposed || this.backgroundRefreshStarted)
      return;

    this.backgroundRefreshStarted = true;
    void this.prefetchConfigured(preferredId).then(() => this.startRefreshTimer());
  }

  /** Schedule the next cache expiry. Failed or absent feeds retry after one interval. */
  private startRefreshTimer(): void {
    clearTimeout(this.refreshTimer);
    if (this.disposed || !this.backgroundRefreshStarted)
      return;

    let delay = this.refreshIntervalMinutes * 60_000;

    for (const { url } of Object.values(this.sources)) {
      if (!url)
        continue;
      const failedAt = this.failedRefreshes.get(url);
      const remaining = failedAt === undefined
        ? this.cache.refreshDelay(url)
        : failedAt + this.refreshIntervalMinutes * 60_000 - Date.now();

      // A feed skipped earlier in the queue may have expired during another fetch.
      if (remaining !== undefined)
        delay = Math.min(delay, Math.max(1, remaining));
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.prefetchConfigured().then(() => this.startRefreshTimer());
    }, delay);
  }

  /** Subscribes a listener to be notified when the feed manager's state changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notifies all subscribed listeners about a state change. */
  private notify() {
    this.revision++;
    notifyListeners(this.listeners);
  }

  /** Saves/updates all feed settings for a specific AppID. */
  async save(id: string, value: string,
    showInWhatsNew = this.sources[id]?.showFeedInWhatsNew !== false,
    maxItemsFromFeedInWhatsNew = this.sources[id]?.maxItemsFromFeedInWhatsNew ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS) {
    const url = httpUrl(value.trim());

    if (!url)
      throw new Error(getPluginI18nString('enterFeedUrl'));

    await backendWrite(() => backend.saveFeedSource(id, url, showInWhatsNew, maxItemsFromFeedInWhatsNew),
      getPluginI18nString('couldNotSaveFeedSource'));

    const previousUrl = this.sources[id]?.url;
    const urlChanged = previousUrl !== url;

    if (urlChanged) {
      // Phase out the previous feed URL from the cache and failed refreshes.
      if (previousUrl)
        this.invalidateFeed(previousUrl, id);

      this.invalidateFeed(url, id);
    }

    this.sources[id] = {
      url,
      showFeedInWhatsNew: showInWhatsNew,
      maxItemsFromFeedInWhatsNew
    };

    this.notify();

    // A newly configured feed should be available on the Library home page
    // even when its game details page has never been opened.
    if (urlChanged)
      void this.cache.get(id, url).catch(() => {});
  }

  private invalidateFeed(url: string, appId: string): void {
    if (Object.entries(this.sources).some(([id, source]) => id !== appId && source.url === url))
      return;

    this.cache.invalidate(url);
    this.failedRefreshes.delete(url);
  }

  /** Clears the feed source for a specific feed identified by its AppID. */
  async clear(appId: string) {
    await backendWrite(() => backend.clearFeedSource(appId), getPluginI18nString('couldNotRemoveFeedSource'));

    if (!Object.prototype.hasOwnProperty.call(this.sources, appId))
      return;

    const url = this.sources[appId].url;

    if (url)
      this.invalidateFeed(url, appId);

    delete this.sources[appId];

    this.notify();
  }

  /** Updates the "Show in What's New" setting for a specific feed identified by its AppID. */
  async setShowFeedInWhatsNew(appId: string, value: boolean) {
    await backendWrite(() => backend.setShowFeedInWhatsNew(appId, value),
      getPluginI18nString('couldNotSaveFeedSource'));

    const source = this.sources[appId] ||= { url: '', showFeedInWhatsNew: true };
    source.showFeedInWhatsNew = value;

    this.notify();
  }

  /** Sets how many items of an AppID's feed may appear in "What's New"; 0 means unlimited. */
  async setMaxItemsFromFeedInWhatsNew(appId: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > EXTERNAL_NEWS_MAX_ITEMS)
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    await backendWrite(() => backend.setMaxItemsFromFeedInWhatsNew(appId, value),
      getPluginI18nString('couldNotSaveFeedSource'));

    const source = this.sources[appId] ||= { url: '', showFeedInWhatsNew: true };
    source.maxItemsFromFeedInWhatsNew = value;

    this.notify();
  }

  /** Marks a feed item as removed from "What's New" */
  addUrlToRemovedFeedItems(url: string): Promise<void> {
    if (this.feedRemovedItems.has(url))
      return this.removalWrite;

    this.feedRemovedItems.add(url);
    this.notify();

    const write = this.removalWrite.then(async () => {
      if (!await backend.addFeedRemovedItem(url))
        throw new Error('Could not save removed feed item');
    });

    this.removalWrite = write.catch(error => {
      this.feedRemovedItems.delete(url);
      this.notify();
      console.error('[External Data Sources] Could not save removed feed item:', error);
    });

    return this.removalWrite;
  }

  /** Disposes of the feed manager, clearing all timers, listeners, and cache. */
  dispose() {
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    this.listeners.clear();
    this.cache.clear();
    this.failedRefreshes.clear();
  }
}
