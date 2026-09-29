import type { NativeEventModel } from './news-types';
import { EXTERNAL_NEWS_PREFIX, EXTERNAL_NEWS_MAX_AGE, EXTERNAL_NEWS_DEFAULT_MAX_ITEMS } from '../constants';
import { createExternalNewsEvents } from './news-events';
import type { NewsItem } from '../feed';
import type { NativeBindings } from './news-discovery';
import type { FeedManager } from '../feed/manager';

interface WhatsNewModelEntry {
  selected: NewsItem[];
  events: WhatsNewModelItem[];
}

interface WhatsNewModelItem {
  model: NativeEventModel;
  item: NewsItem;
}

export interface WhatsNewEvents {
  articleUrl(gid: string): string | undefined;
  hide(gid: string): void;
  clear(): void;
  list(): NativeEventModel[];
}

/**
 * Builds the synthetic event list and tracks its article URLs for Steam actions.
 * @param feedManager The FeedManager instance containing the feed settings.
 * @param native The NativeBindings instance for interacting with Steam's native news system.
 * @returns An object implementing the WhatsNewEvents interface.
 */
export function createWhatsNewEvents(feedManager: FeedManager, native: NativeBindings): WhatsNewEvents {
  const hidden = new Set<string>();
  const articles = new Map<string, string>();
  const models = new Map<string, WhatsNewModelEntry>();

  const dummyClient = {
    setQueryData() {}
  };

  return {
    articleUrl(gid: string) {
      return articles.get(gid);
    },

    hide(gid: string) {
      hidden.add(gid);
    },

    clear() {
      articles.clear();
      models.clear();
    },

    list() {
      const events: NativeEventModel[] = [];

      // Calculate cut-off date; items older than this timestamp will be ignored.
      const oldest = Date.now() / 1000 - EXTERNAL_NEWS_MAX_AGE;

      articles.clear();

      for (const [appId, url] of Object.entries(feedManager.values)) {
        // Skip feed if presence in "What's New" is explicitly disabled.
        if (feedManager.showFeedInWhatsNew[appId] === false)
          continue;

        // Skip if there are no items in the feed.
        const items = feedManager.cache.peekLast(url);

        if (!items?.length)
          continue;

        // Select visible items on every call because age and hidden state can change
        // while the parsed feed stays the same.
        const limit = feedManager.maxItemsFromFeedInWhatsNew[appId] ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS;
        const mostRecentItems = items.filter(item => item.date !== null && item.date >= oldest && !feedManager.feedRemovedItems.has(item.url));
        const cappedItems = limit === 0 ? mostRecentItems : mostRecentItems.slice(0, limit);
        const visibleExternalNews = cappedItems.filter(item => !hidden.has(`${EXTERNAL_NEWS_PREFIX}${appId}:${item.gid}`));

        // Detect if we have items to purge from the model due to changes in visibility or recency.
        let entry = models.get(appId);

        if (!entry
          || entry.selected.length !== visibleExternalNews.length
          || visibleExternalNews.some((item, index) => item !== entry?.selected[index])) {
          const feedEvents = createExternalNewsEvents(native, appId, visibleExternalNews, dummyClient);

          entry = {
            selected: visibleExternalNews,
            events: feedEvents.map(event => {
              const model = event.eventModel;
              model.startTime = model.postTime;
              model.endTime = undefined;

              return {
                model,
                item: event.externalNewsItem
              };
            })
          };

          models.set(appId, entry);
        }

        for (const { model, item } of entry.events) {
          articles.set(model.GID, item.url);
          events.push(model);
        }
      }

      return events.sort((a, b) => b.postTime - a.postTime);
    },
  };
}
