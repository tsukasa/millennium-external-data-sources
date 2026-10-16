import type { NativeEventModel } from './news-types';
import { EXTERNAL_NEWS_MAX_AGE, EXTERNAL_NEWS_DEFAULT_MAX_ITEMS } from '../constants';
import { createExternalNewsModels, externalGid } from './news-events';
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

function selectVisibleItems(items: NewsItem[], appId: string, oldest: number, limit: number,
  removed: Set<string>, hidden: Set<string>): NewsItem[] {
  const recent = items.filter(item => item.date !== null && item.date >= oldest && !removed.has(item.url));
  // Persistent removals fill vacancies; temporary hiding does not change the cap.
  const capped = limit === 0 ? recent : recent.slice(0, limit);
  return capped.filter(item => !hidden.has(externalGid(appId, item.gid)));
}

/** Builds the synthetic event list and tracks its article URLs for Steam actions. */
export function createWhatsNewEvents(feedManager: FeedManager, native: NativeBindings): WhatsNewEvents {
  const hidden = new Set<string>();
  const articles = new Map<string, string>();
  const models = new Map<string, WhatsNewModelEntry>();

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

      for (const [appId, source] of Object.entries(feedManager.sources)) {
        const { url, showFeedInWhatsNew, maxItemsFromFeedInWhatsNew } = source;

        // Skip feed if presence in "What's New" is explicitly disabled.
        if (!url || showFeedInWhatsNew === false)
          continue;

        // Skip if there are no items in the feed.
        const items = feedManager.cache.peekLast(url);

        if (!items?.length)
          continue;

        // Select visible items on every call because age and hidden state can change
        // while the parsed feed stays the same.
        const limit = maxItemsFromFeedInWhatsNew ?? EXTERNAL_NEWS_DEFAULT_MAX_ITEMS;
        const visibleExternalNews = selectVisibleItems(items, appId, oldest, limit,
          feedManager.feedRemovedItems, hidden);

        // Detect if we have items to purge from the model due to changes in visibility or recency.
        let entry = models.get(appId);

        if (!entry
          || entry.selected.length !== visibleExternalNews.length
          || visibleExternalNews.some((item, index) => item !== entry?.selected[index])) {
          entry = {
            selected: visibleExternalNews,
            events: createExternalNewsModels(native, appId, visibleExternalNews).map(({ model, item }) => {
              model.startTime = model.postTime;
              model.endTime = undefined;

              return {
                model,
                item
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

      // GetWhatsNewEvents sorts these together with Steam's own events.
      return events;
    },
  };
}
