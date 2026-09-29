import type { NativeActivityEvent, NativeActivityDay, NativeAppActivity } from './news-types';
import { createExternalNewsEvents } from './news-events';
import { MethodHooks } from './method-hooks';
import type { NativeBindings } from './news-discovery';
import { isNonSteamId, steam } from './client';
import type { FeedManager } from '../feed/manager';

/**
 * Determine if an activity event is external (i.e., has an associated external news item).
 */
const isExternal = (event: NativeActivityEvent) => !!event?.externalNewsItem;

/**
 * Get the start of the day (00:00:00) for a given timestamp in seconds.
 * @param seconds The timestamp in seconds.
 * @returns The timestamp in seconds representing the start of the day.
 */
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

/**
 * Supplies feed events to the activity store read by both Steam library UIs.
 * @param feedManager The feed manager instance.
 * @param native The native bindings instance.
 * @returns A function to unregister the activity store hooks.
 */
export function registerActivityStore(feedManager: FeedManager, native: NativeBindings): () => void {
  const store = steam().appActivityStore;
  if (!store?.m_mapAppActivity || !store.GetAppActivity || !store.FetchLatestActivityFromServer)
    throw new Error('Steam activity store is not available');

  const owned = new Map<number, NativeAppActivity>();
  const touched = new Set<number>();
  let disposed = false;
  const configured = (appId: number) => isNonSteamId(appId) && !!feedManager.values[String(appId)];

  const hooks = new MethodHooks();
  let unsubscribeFeedManager: (() => void) | undefined;
  let unsubscribeCache: (() => void) | undefined;

  const makeActivity = (appId: number) => {
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
  };

  const makeDay = (time: number) => {
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
  };

  const removeExternal = (activity: NativeAppActivity) => {
    for (const [time, day] of activity.m_mapActivityByDay || []) {
      if (!(day.m_rgEvents || day.events)?.some(isExternal))
        continue;
      if (day.m_rgEvents?.replace && day.m_rgEvents.some(isExternal)) {
        day.m_rgEvents.replace(day.m_rgEvents.filter((event: NativeActivityEvent) => !isExternal(event)));
      } else if (Array.isArray(day.events) && day.events.some(isExternal)) {
        day.events.splice(0, day.events.length, ...day.events.filter((event: NativeActivityEvent) => !isExternal(event)));
      }

      if (!day.BHasEvents())
        activity.m_mapActivityByDay.delete(time);
    }
  };

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

      return;
    }

    // A plain fallback has no MobX-observable day map. Publish a fresh value
    // when the cache changes so both library UIs render the new days.
    const reusable = old?.m_mapActivityByDay && !(ownsCurrent && old.constructor === Object);
    const activity = reusable ? old : makeActivity(appId);

    if (!reusable)
      owned.set(appId, activity);

    touched.add(appId);

    removeExternal(activity);

    const url = feedManager.values[String(appId)];
    const items = feedManager.cache.peekLast(url) || [];
    const events = createExternalNewsEvents(native, String(appId), items, native.sharedClient);

    for (const event of events) {
      const undated = event.externalNewsItem.date === null;

      const time = undated
        ? 0
        : dayStart(event.rtEventTime);

      let day = activity.m_mapActivityByDay.get(time);

      if (!day)
        activity.m_mapActivityByDay.set(time, day = makeDay(time));

      if (undated)
        day.undated = true;

      day.AddEvent(event);
      day.SortEvents?.();
    }

    store.m_mapAppActivity.set(appId, activity);
  };

  const syncAll = () => {
    const ids = new Set([...touched, ...Object.keys(feedManager.values).map(Number)]);

    for (const id of ids) {
      if (isNonSteamId(id)) {
        sync(id);
      }
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
  };

  try {
    hooks.wrap(store, 'GetAppActivity', (original, instance, [appId]) => {
      if (!configured(appId))
        return original();
      if (!instance.m_mapAppActivity.has(appId))
        sync(appId);
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
    unsubscribeCache = feedManager.cache.subscribe(syncAll);
    syncAll();
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
