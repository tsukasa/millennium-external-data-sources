import { FeedCache, httpUrl } from './feed';
import { getPluginI18nString } from './i18n';
import { decodeResponse } from './transport';

export class Sources {
  revision = 0;
  values: Record<string, string> = {};
  private disposed = false;
  private listeners = new Set<() => void>();
  readonly cache = new FeedCache(id => backend.fetchFeed(id));
  private loading?: Promise<void>;

  load(): Promise<void> {
    return this.loading ||= backend.getFeedSources().then(raw => {
      this.values = decodeResponse<Record<string, string>>(raw) || {};
      this.notify();
    }).catch(error => {
      this.loading = undefined;
      throw error;
    });
  }

  /** Warm the existing ten-minute feed cache without delaying library render. */
  async prefetchConfigured(preferredId?: string): Promise<void> {
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
          /* The section can retry on visit. */
        }
      }
    };
    
    await Promise.all(Array.from({length: Math.min(2, entries.length) }, worker));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.revision++;
    this.listeners.forEach(listener => listener());
  }

  async save(id: string, value: string) {
    const url = httpUrl(value.trim());
    
    if (!url)
      throw new Error(getPluginI18nString('enterFeedUrl'));

    if (!await backend.saveFeedSource(id, url))
      throw new Error(getPluginI18nString('couldNotSaveFeedSource'));

    this.cache.invalidate(this.values[id]);
    this.cache.invalidate(url);
    this.values[id] = url;
    this.notify();
  }

  async clear(id: string) {
    if (!await backend.clearFeedSource(id))
      throw new Error(getPluginI18nString('couldNotRemoveFeedSource'));

    this.cache.invalidate(this.values[id]);
    delete this.values[id];
    this.notify();
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
    this.cache.clear();
  }
}
