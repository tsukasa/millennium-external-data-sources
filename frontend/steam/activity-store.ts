import type { NativeActivityEvent, NativeActivityDay, NativeAppActivity } from './news-types';
import { createExternalNewsEvents, type ExternalNewsEvent } from './news-events';
import { MethodHooks } from './method-hooks';
import type { NativeBindings } from './news-discovery';
import { isNonSteamId, steam } from './client';
import type { FeedManager } from '../feed/manager';
import type { NewsItem } from '../feed';

/** Shared empty result so uncached feeds compare equal between syncs. */
const NO_ITEMS: NewsItem[] = [];

/** Determine if an activity event is external (i.e., has an associated external news item). */
const isExternal = (event: NativeActivityEvent) => !!event?.externalNewsItem;

/** Get the start of the day (00:00:00) for a given timestamp in seconds. */
const dayStart = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
};

export interface ActivityStore {
  m_mapAppActivity: Map<number, NativeAppActivity>;
  GetAppActivity(appId: number): NativeAppActivity | undefined;
  RequestRestoreActivity(appId: number): unknown;
  RestoreActivity(appId: number): Promise<unknown>;
  FetchLatestActivity(appId: number, ...args: unknown[]): unknown;
  FetchLatestActivityFromServer(appId: number, ...args: unknown[]): Promise<unknown>;
  FetchActivityHistory(appId: number, ...args: unknown[]): Promise<unknown>;
}

function makeActivity(store: ActivityStore, appId: number): NativeAppActivity {
  const template = [...store.m_mapAppActivity.values()].find(activity =>
    activity?.m_mapActivityByDay && activity.constructor !== Object);

  if (template)
    return new (template.constructor as new(appId: number) => NativeAppActivity)(appId);

  const days = new Map<number, NativeActivityDay>();

  return {
    m_mapActivityByDay: days,
    m_bNoMoreHistoryAvailable: true,
    get appActivityByDay() {
      return [...days.entries()].sort((a, b) => b[0] - a[0]).map(([, day]) => day);
    },
    get lastAddedPartnerEvent() {
      return this.appActivityByDay.flatMap((day: NativeActivityDay) => day.events)[0] || null;
    },
    BHasEvents() {
      return this.appActivityByDay.length > 0;
    },
  };
}

function makeDay(store: ActivityStore, time: number): NativeActivityDay {
  const sample = [...store.m_mapAppActivity.values()]
    .flatMap(activity => activity?.appActivityByDay || [])
    .find(day => day?.constructor !== Object && typeof day?.AddEvent === 'function');

  if (sample) {
    const day = new (sample.constructor as new() => NativeActivityDay)();
    day.m_rtDayBegin = time;
    return day;
  }

  const events: NativeActivityEvent[] = [];

  return {
    m_rtDayBegin: time,
    get dayBegin() {
      return time;
    },
    get events() {
      return events;
    },
    get isValid() {
      return events.length > 0;
    },
    BHasEvents() {
      return events.length > 0;
    },
    AddEvent(event: NativeActivityEvent) {
      events.push(event);
    },
    GetLatestEventTime() {
      return events[0]?.rtEventTime || time;
    },
  };
}

function removeExternal(activity: NativeAppActivity): void {
  for (const [time, day] of activity.m_mapActivityByDay || []) {
    if (!(day.m_rgEvents || day.events)?.some(isExternal))
      continue;
    if (day.m_rgEvents?.replace && day.m_rgEvents.some(isExternal))
      day.m_rgEvents.replace(day.m_rgEvents.filter((event: NativeActivityEvent) => !isExternal(event)));
    else if (Array.isArray(day.events) && day.events.some(isExternal))
      day.events.splice(0, day.events.length, ...day.events.filter((event: NativeActivityEvent) => !isExternal(event)));

    if (!day.BHasEvents())
      activity.m_mapActivityByDay.delete(time);
  }
}

function addEventsToDays(store: ActivityStore, activity: NativeAppActivity, events: ExternalNewsEvent[]): void {
  for (const event of events) {
    const undated = event.externalNewsItem.date === null;

    const time = undated
      ? 0
      : dayStart(event.rtEventTime);

    let day = activity.m_mapActivityByDay.get(time);

    if (!day)
      activity.m_mapActivityByDay.set(time, day = makeDay(store, time));

    if (undated)
      day.undated = true;

    day.AddEvent(event);
    day.SortEvents?.();
  }
}

/** Supplies feed events to the activity store read by both Steam library UIs. */
export function registerActivityStore(feedManager: FeedManager, native: NativeBindings): () => void {
  const store = steam().appActivityStore;
  if (!store?.m_mapAppActivity || !store.GetAppActivity || !store.FetchLatestActivityFromServer)
    throw new Error('Steam activity store is not available');

  const owned = new Map<number, NativeAppActivity>();
  const touched = new Set<number>();
  // Activity and parsed items last written per app; unchanged pairs need no rebuild.
  const synced = new Map<number, { activity: NativeAppActivity; items: NewsItem[] }>();
  let disposed = false;

  const configured = (appId: number) => feedManager.hasFeed(appId);

  const hooks = new MethodHooks();
  let unsubscribeFeedManager: (() => void) | undefined;
  let unsubscribeCache: (() => void) | undefined;

  const sync = (appId: number) => {
    if (disposed)
      return;

    const old = store.m_mapAppActivity.get(appId);
    const ownsCurrent = owned.has(appId) && owned.get(appId) === old;
    if (!ownsCurrent)
      owned.delete(appId);

    if (!configured(appId)) {
      if (old)
        removeExternal(old);

      if (ownsCurrent)
        store.m_mapAppActivity.delete(appId);
      owned.delete(appId);

      touched.delete(appId);
      synced.delete(appId);

      return;
    }

    const url = feedManager.sources[String(appId)].url;
    const items = feedManager.cache.peekLast(url) || NO_ITEMS;
    const last = synced.get(appId);

    if (old && last?.activity === old && last.items === items)
      return;

    // A plain fallback has no MobX-observable day map. Publish a fresh value
    // when the cache changes so both library UIs render the new days.
    const reusable = old?.m_mapActivityByDay && !(ownsCurrent && old.constructor === Object);
    const activity = reusable ? old : makeActivity(store, appId);

    if (!reusable)
      owned.set(appId, activity);

    touched.add(appId);

    removeExternal(activity);

    const events = createExternalNewsEvents(native, String(appId), items);

    addEventsToDays(store, activity, events);

    store.m_mapAppActivity.set(appId, activity);
    synced.set(appId, { activity, items });
  };

  const syncAll = () => {
    const ids = new Set([...touched, ...Object.keys(feedManager.sources).map(Number)]);

    for (const id of ids) {
      if (isNonSteamId(id))
        sync(id);
    }
  };

  /** Rebuilds only the apps that use a refreshed feed URL. */
  const syncFeed = (url: string) => {
    for (const [id, source] of Object.entries(feedManager.sources)) {
      if (source.url === url && isNonSteamId(Number(id)))
        sync(Number(id));
    }
  };

  const cleanup = () => {
    if (disposed)
      return;

    disposed = true;
    unsubscribeFeedManager?.();
    unsubscribeCache?.();

    // Restore reads before observable deletions can trigger a Steam render.
    hooks.restore();

    for (const id of touched) {
      const activity = store.m_mapAppActivity.get(id);
      if (owned.has(id) && owned.get(id) === activity)
        store.m_mapAppActivity.delete(id);
      else if (activity)
        removeExternal(activity);
    }

    owned.clear();
    touched.clear();
    synced.clear();
  };

  try {
    hooks.wrap(store, 'GetAppActivity', (original, instance, [appId]) => {
      if (!configured(appId))
        return original();

      // Steam reads activity during renders. Publish missing activity afterwards
      // so the read path has no side effects; the observable map updates readers.
      if (!instance.m_mapAppActivity.has(appId))
        queueMicrotask(() => sync(appId));

      return instance.m_mapAppActivity.get(appId);
    });

    for (const name of ['RequestRestoreActivity', 'FetchLatestActivity'] as const) {
      hooks.wrap(store, name, (original, _instance, [appId]) =>
        configured(appId) ? undefined : original());
    }

    for (const name of ['RestoreActivity', 'FetchLatestActivityFromServer', 'FetchActivityHistory'] as const) {
      hooks.wrap(store, name, (original, _instance, [appId]) =>
        configured(appId) ? Promise.resolve() : original());
    }

    unsubscribeFeedManager = feedManager.subscribe(syncAll);
    unsubscribeCache = feedManager.cache.subscribe(syncFeed);
    syncAll();

    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
