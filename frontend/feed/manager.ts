import { FeedCache, httpUrl } from './index';
import { getPluginI18nString } from '../i18n';
import { decodeResponse } from '../transport';
import {
  EXTERNAL_NEWS_DEFAULT_MAX_ITEMS, EXTERNAL_NEWS_MAX_ITEMS, EXTERNAL_NEWS_MAX_FETCH_INTERVAL,
  EXTERNAL_NEWS_MIN_FETCH_INTERVAL, EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES,
  EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES, EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL,
  EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES
} from '../constants';
import type { FeedSourceSettingsByAppId, GlobalFeedSettings } from './types';

export class FeedManager {
  revision = 0;
  refreshIntervalMinutes = EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL;
  concurrentFetches = EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES;
  values: Record<string, string> = {};
  showFeedInWhatsNew: Record<string, boolean> = {};
  maxItemsFromFeedInWhatsNew: Record<string, number> = {};
  feedRemovedItems = new Set<string>();

  private disposed = false;
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private removalWrite: Promise<void> = Promise.resolve();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private prefetching?: Promise<void>;

  readonly cache = new FeedCache(id => backend.fetchFeed(id), Date.now, ({ appId, durationMs, itemCount }) => {
    console.info(`[External Data Sources] Parsed feed for ${appId}: ${itemCount} items in ${durationMs.toFixed(1)} ms`);
  });

  load(): Promise<void> {
    return this.loading ||= Promise.all([backend.getFeedSources(), backend.getFeedRemovedItems(), backend.getFeedSettings()]).then(([feedSources, removedFeedItemsList, globalFeedSettings]) => {
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

      this.values = Object.fromEntries(Object.entries(settings)
        .filter(([, entry]) => !!entry.url)
        .map(([id, entry]) => [id, entry.url])
      );

      this.showFeedInWhatsNew = Object.fromEntries(Object.entries(settings)
        .map(([id, entry]) => [id, entry.showFeedInWhatsNew !== false])
      );

      this.maxItemsFromFeedInWhatsNew = Object.fromEntries(Object.entries(settings)
        .map(([id, entry]) => {
          const limit = entry.maxItemsFromFeedInWhatsNew;
          return [id, typeof limit === 'number'
            && Number.isInteger(limit)
            && limit >= 0 && limit <= EXTERNAL_NEWS_MAX_ITEMS
            ? limit
            : EXTERNAL_NEWS_DEFAULT_MAX_ITEMS
          ];
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
   * @param value The value to validate as a feed refresh interval in minutes.
   * @returns True if the value is a valid interval, false otherwise.
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
   * @param value The value to validate as the number of simultaneous feed fetches.
   * @returns True if the value is a valid concurrency, false otherwise.
   */
  public static isValidGlobalFeedConcurrencyValue(value: unknown): value is number {
    return typeof value === 'number'
      && Number.isInteger(value)
      && value >= EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES
      && value <= EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES;
  }

  /**
   * Updates the plugin feed settings and restarts the background refresh timer.
   * @param intervalMinutes The new feed refresh interval in minutes.
   * @param concurrentFetches The new number of simultaneous feed fetches.
   */
  async setPluginFeedSettings(intervalMinutes: number, concurrentFetches: number): Promise<void> {
    if (!FeedManager.isValidGlobalFeedIntervalValue(intervalMinutes) || !FeedManager.isValidGlobalFeedConcurrencyValue(concurrentFetches) || !await backend.setFeedSettings(intervalMinutes, concurrentFetches))
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    this.refreshIntervalMinutes = intervalMinutes;
    this.concurrentFetches = concurrentFetches;

    this.cache.setRefreshInterval(intervalMinutes);

    // Restart the timer for background refresh.
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);

      this.startRefreshTimer();
    }

    this.notify();
  }

  /**
   * Warms the feed cache without delaying library render.
   * @param preferredId The preferred AppID to prefetch first.
   */
  prefetchConfigured(preferredId?: string): Promise<void> {
    return this.prefetching ||= this.runPrefetch(preferredId).finally(() => {
      this.prefetching = undefined;
    });
  }

  /**
   * Prefetches all configured feeds, prioritizing the preferred AppID if provided.
   * @param preferredId The preferred AppID to prefetch first.
   */
  private async runPrefetch(preferredId?: string): Promise<void> {
    const entries = Object.entries(this.values);
    const preferred = entries.findIndex(([id]) => id === preferredId);
    let next = 0;

    if (preferred > 0)
      entries.unshift(entries.splice(preferred, 1)[0]);

    const worker = async () => {
      while (!this.disposed && next < entries.length) {
        const [id, url] = entries[next++];
        try {
          await this.cache.get(id, url);
        } catch {
          /* Keep the last successful feed and retry on the next refresh. */
        }
      }
    };

    await Promise.all(Array.from({length: Math.min(this.concurrentFetches, entries.length) }, worker));
  }

  /**
   * Starts one background loading loop for all configured feeds.
   * @param preferredId The preferred AppID to prefetch first.
   */
  startBackgroundRefresh(preferredId?: string): void {
    if (this.disposed || this.refreshTimer)
      return;

    this.startRefreshTimer();
    void this.prefetchConfigured(preferredId);
  }

  /**
   * Starts the refresh timer for background feed updates.
   */
  private startRefreshTimer(): void {
    this.refreshTimer = setInterval(
      () => { void this.prefetchConfigured(); },
      this.refreshIntervalMinutes * 60_000
    );
  }

  /**
   * Subscribes a listener to be notified when the feed manager's state changes.
   * @param listener The callback to invoke on state changes.
   * @returns A function to unsubscribe the listener.
   */
  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifies all subscribed listeners about a state change.
   */
  private notify() {
    this.revision++;
    this.listeners.forEach(listener => listener());
  }

  /**
   * Saves/updates all feed settings for a specific AppID.
   * @param id The feed's AppID being saved.
   * @param value The URL of the feed being saved.
   * @param showInWhatsNew Whether the feed should be shown in "What's New".
   * @param maxItemsFromFeedInWhatsNew The maximum number of items from the feed that can appear in "What's New".
   */
  async save(id: string, value: string, showInWhatsNew = this.showFeedInWhatsNew[id] !== false, maxItemsFromFeedInWhatsNew = this.maxItemsFromFeedInWhatsNew[id] ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS) {
    const url = httpUrl(value.trim());

    if (!url)
      throw new Error(getPluginI18nString('enterFeedUrl'));

    if (!await backend.saveFeedSource(id, url, showInWhatsNew, maxItemsFromFeedInWhatsNew))
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    const urlChanged = this.values[id] !== url;
    if (urlChanged) {
      this.cache.invalidate(this.values[id]);
      this.cache.invalidate(url);
    }

    this.values[id] = url;
    this.showFeedInWhatsNew[id] = showInWhatsNew;
    this.maxItemsFromFeedInWhatsNew[id] = maxItemsFromFeedInWhatsNew;

    this.notify();

    // A newly configured feed should be available on the Library home page
    // even when its game details page has never been opened.
    if (urlChanged)
      void this.cache.get(id, url).catch(() => {});
  }

  /**
   * Clears the feed source for a specific feed identified by its AppID.
   * @param appId The feed's AppID whose feed source is being cleared.
   */
  async clear(appId: string) {
    if (!await backend.clearFeedSource(appId))
      throw new Error(getPluginI18nString('couldNotRemoveFeedSource'));

    this.cache.invalidate(this.values[appId]);

    delete this.values[appId];
    delete this.showFeedInWhatsNew[appId];
    delete this.maxItemsFromFeedInWhatsNew[appId];

    this.notify();
  }

  /**
   * Updates the "Show in What's New" setting for a specific feed identified by its AppID.
   * @param appId The feed's AppID whose "show in What's New" setting is being updated.
   * @param value The new value for the "show in What's New" setting.
   */
  async setShowFeedInWhatsNew(appId: string, value: boolean) {
    if (!await backend.setShowFeedInWhatsNew(appId, value))
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    this.showFeedInWhatsNew[appId] = value;
    this.notify();
  }

  /**
   * Sets the maximum number of items from a feed that can appear in "What's New" for a specific feed identified by its AppID.
   * @param appId The feed's AppID whose maximum items setting is being updated.
   * @param value The new maximum number of items from the feed that can appear in "What's New".
   */
  async setMaxItemsFromFeedInWhatsNew(appId: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > EXTERNAL_NEWS_MAX_ITEMS
      || !await backend.setMaxItemsFromFeedInWhatsNew(appId, value))
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    this.maxItemsFromFeedInWhatsNew[appId] = value;
    this.notify();
  }

  /**
   * Marks a feed item as removed from "What's New"
   * @param url The URL of the feed item to be marked as removed.
   * @returns A promise that resolves when the feed item has been marked as removed.
   */
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

  /**
   * Disposes of the feed manager, clearing all timers, listeners, and cache.
   */
  dispose() {
    this.disposed = true;
    clearInterval(this.refreshTimer);
    this.listeners.clear();
    this.cache.clear();
  }
}
