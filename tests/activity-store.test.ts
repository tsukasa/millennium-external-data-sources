import { expect, test } from 'bun:test';
import { registerActivityStore } from '../frontend/steam/activity-store';
import type { NewsItem } from '../frontend/feed';
import type { NativeBindings } from '../frontend/steam/news-discovery';
import type { FeedManager } from '../frontend/feed/manager';

const appId = 4066412613;
const url = 'https://example.com/feed';
const item: NewsItem = { gid: 'article-1', title: 'News', url: 'https://example.com/article-1',
  contents: 'Summary', date: 1790776800, image: 'https://example.com/image.png' };

class Day {
  m_rtDayBegin = 0;
  m_rgEvents: any[] = [];
  AddEvent(event: any) { this.m_rgEvents.push(event); }
  get events() { return this.m_rgEvents; }
  BHasEvents() { return this.events.length > 0; }
  SortEvents() { this.m_rgEvents.sort((a, b) => b.rtEventTime - a.rtEventTime); }
}
class Activity {
  m_mapActivityByDay = new Map<number, Day>();
  constructor(readonly appId: number) {}
  get appActivityByDay() { return [...this.m_mapActivityByDay.values()]; }
}
class EventModel {
  clanSteamID = {};
  jsondata = {};
  static GenerateSummaryFromText(value: string) { return value; }
}
class ActivityEvent {
  rtEventTime: number;
  constructor(time: number) { this.rtEventTime = time; }
  BIsValid() { return true; }
}

test('activity store shares feed days without Steam requests and restores native state', async () => {
  const requests: string[] = [];
  const base = new Activity(0);
  base.m_mapActivityByDay.set(1, new Day());
  const map = new Map<number, Activity>([[0, base]]);
  const store = {
    m_mapAppActivity: map,
    GetAppActivity(id: number) { requests.push(`get:${id}`); return map.get(id); },
    RequestRestoreActivity(id: number) { requests.push(`restore-request:${id}`); },
    async RestoreActivity(id: number) { requests.push(`restore:${id}`); },
    FetchLatestActivity(id: number) { requests.push(`latest:${id}`); },
    async FetchLatestActivityFromServer(id: number) { requests.push(`server:${id}`); },
    async FetchActivityHistory(id: number) { requests.push(`history:${id}`); },
  };
  const originalGet = store.GetAppActivity;
  const originalDelete = map.delete.bind(map);
  let restoredBeforeDelete = false;
  map.delete = function (id) {
    const removed = originalDelete(id);
    if (id === appId) {
      restoredBeforeDelete = store.GetAppActivity === originalGet;
      store.GetAppActivity(id); // A MobX observer reads during the delete notification.
    }
    return removed;
  };
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: { location: { href: 'https://steamloopback.host/' }, appActivityStore: store } });
  const sourceListeners = new Set<() => void>();
  const cacheListeners = new Set<() => void>();
  let items = [item];
  const feedManager = {
    values: { [appId]: url },
    subscribe(listener: () => void) { sourceListeners.add(listener); return () => sourceListeners.delete(listener); },
    cache: {
      peekLast: () => items,
      subscribe(listener: () => void) { cacheListeners.add(listener); return () => cacheListeners.delete(listener); },
    },
  } as unknown as FeedManager;
  const native = {
    EventModel, ActivityEvent, language: 0, imageQueryKey: ['image', 'probe'], probeGid: 'probe',
    sharedClient: { setQueryData() {} },
  } as unknown as NativeBindings;
  const dispose = registerActivityStore(feedManager, native);
  try {
    const activity = store.GetAppActivity(appId)!;
    expect(activity.appActivityByDay).toHaveLength(1);
    expect(activity.appActivityByDay[0].events[0].externalNewsItem).toBe(item);
    expect(activity.appActivityByDay[0].events[0].eventModel.GID).toBe(`external-news:${appId}:article-1`);
    store.RequestRestoreActivity(appId);
    await store.RestoreActivity(appId);
    store.FetchLatestActivity(appId);
    await store.FetchLatestActivityFromServer(appId);
    await store.FetchActivityHistory(appId);
    expect(requests).toEqual([]);

    items = [];
    cacheListeners.forEach(listener => listener());
    expect(store.GetAppActivity(appId)?.appActivityByDay).toHaveLength(0);
    expect(requests).toEqual([]);
    store.GetAppActivity(570);
    expect(requests).toEqual(['get:570']);
  } finally {
    dispose();
    Object.assign(globalThis, { window: previousWindow });
  }
  expect(store.GetAppActivity).toBe(originalGet);
  expect(restoredBeforeDelete).toBe(true);
  expect(map.has(appId)).toBe(false);
  expect(map.get(0)).toBe(base);
});

test('cold activity store publishes feed updates for several shortcuts', () => {
  const map = new Map<number, any>();
  const store = {
    m_mapAppActivity: map,
    GetAppActivity(id: number) { throw new Error(`Steam request for ${id}`); },
    RequestRestoreActivity() { throw new Error('restore request'); },
    async RestoreActivity() { throw new Error('restore'); },
    FetchLatestActivity() { throw new Error('latest'); },
    async FetchLatestActivityFromServer() { throw new Error('server'); },
    async FetchActivityHistory() { throw new Error('history'); },
  };
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: { location: { href: 'https://steamloopback.host/' }, appActivityStore: store } });
  const cacheListeners = new Set<() => void>();
  let items: NewsItem[] | undefined;
  const otherId = 4066412614;
  const feedManager = {
    values: { [appId]: url, [otherId]: url },
    subscribe() { return () => {}; },
    cache: {
      peekLast: () => items,
      subscribe(listener: () => void) { cacheListeners.add(listener); return () => cacheListeners.delete(listener); },
    },
  } as unknown as FeedManager;
  const native = {
    EventModel, ActivityEvent, language: 0, imageQueryKey: ['image', 'probe'], probeGid: 'probe',
    sharedClient: { setQueryData() {} },
  } as unknown as NativeBindings;
  const dispose = registerActivityStore(feedManager, native);
  try {
    const first = map.get(appId);
    expect(map.get(otherId)?.m_mapActivityByDay).toBeDefined();
    expect(first.appActivityByDay).toHaveLength(0);
    items = [item];
    cacheListeners.forEach(listener => listener());
    expect(map.get(appId)).not.toBe(first);
    expect(map.get(appId)?.appActivityByDay).toHaveLength(1);
    expect(map.get(otherId)?.appActivityByDay).toHaveLength(1);
    // Local calendar days must stay distinct across years, with undated entries last.
    items = [
      { ...item, date: new Date(2026, 8, 28, 12).getTime() / 1000 },
      { ...item, gid: 'previous-year', date: new Date(2025, 8, 28, 12).getTime() / 1000 },
      { ...item, gid: 'undated', date: null },
    ];
    cacheListeners.forEach(listener => listener());
    const days = map.get(appId).appActivityByDay;
    expect(days).toHaveLength(3);
    expect(days.map((day: any) => day.events[0].externalNewsItem.gid))
      .toEqual(['article-1', 'previous-year', 'undated']);
    expect(days[2].undated).toBe(true);
  } finally {
    dispose();
    Object.assign(globalThis, { window: previousWindow });
  }
  expect(map.size).toBe(0);
});

test('activity cleanup preserves foreign entries and later method wrappers', async () => {
  const map = new Map<number, any>();
  const calls: string[] = [];
  const store = {
    m_mapAppActivity: map,
    GetAppActivity(id: number) { calls.push('get'); return map.get(id); },
    RequestRestoreActivity() { calls.push('restore-request'); },
    async RestoreActivity() { calls.push('restore'); },
    FetchLatestActivity() { calls.push('latest'); },
    async FetchLatestActivityFromServer() { calls.push('server'); },
    async FetchActivityHistory() { calls.push('history'); },
  };
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: { appActivityStore: store } });
  const listeners = new Set<() => void>();
  const otherId = appId + 1;
  const values: Record<string, string> = { [appId]: url, [otherId]: url };
  const feedManager = {
    values,
    subscribe() { return () => {}; },
    cache: {
      peekLast: () => [item],
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    },
  } as unknown as FeedManager;
  const native = {
    EventModel, ActivityEvent, language: 0, imageQueryKey: ['image', 'probe'], probeGid: 'probe',
    sharedClient: { setQueryData() {} },
  } as unknown as NativeBindings;
  const dispose = registerActivityStore(feedManager, native);
  try {
    const day = new Day();
    const foreignEvent = { rtEventTime: 1 };
    day.AddEvent(foreignEvent);
    const emptyDay = new Day();
    const replacement = { m_mapActivityByDay: new Map([[1, day], [2, emptyDay]]) };
    map.set(appId, replacement);
    listeners.forEach(listener => listener());
    expect(map.get(appId)).toBe(replacement);
    expect(day.events).toContain(foreignEvent);
    delete values[String(appId)];
    listeners.forEach(listener => listener());
    expect(map.get(appId)).toBe(replacement);
    expect([...replacement.m_mapActivityByDay.values()]).toEqual([day, emptyDay]);

    // Another plugin replaces the second activity immediately before cleanup.
    const secondReplacement = { m_mapActivityByDay: new Map([[1, day]]) };
    map.set(otherId, secondReplacement);
    const wrappers = new Map<string, Function>();
    for (const name of ['GetAppActivity', 'RequestRestoreActivity', 'RestoreActivity',
      'FetchLatestActivity', 'FetchLatestActivityFromServer', 'FetchActivityHistory']) {
      const inner = (store as any)[name];
      const wrapper = function (this: unknown, ...args: unknown[]) { return inner.apply(this, args); };
      (store as any)[name] = wrapper;
      wrappers.set(name, wrapper);
    }
    dispose();
    expect(map.get(otherId)).toBe(secondReplacement);
    expect(map.get(appId)).toBe(replacement);
    for (const [name, wrapper] of wrappers) {
      expect((store as any)[name]).toBe(wrapper);
      await (store as any)[name](otherId);
    }
    expect(calls).toEqual(['get', 'restore-request', 'restore', 'latest', 'server', 'history']);
  } finally {
    dispose();
    Object.assign(globalThis, { window: previousWindow });
  }
});


test('activity installation failure restores hooks, subscriptions and partial feed entries', () => {
  const previousWindow = globalThis.window;
  const map = new Map<number, Activity>();
  const store = {
    m_mapAppActivity: map,
    GetAppActivity(id: number) { return map.get(id); },
    RequestRestoreActivity() {},
    async RestoreActivity() {},
    FetchLatestActivity() {},
    async FetchLatestActivityFromServer() {},
    async FetchActivityHistory() {},
  };
  const originals = { ...store };
  const sourceListeners = new Set<() => void>();
  const cacheListeners = new Set<() => void>();
  let broken = true;
  class FailingModel extends EventModel {
    static GenerateSummaryFromText(value: string) {
      if (broken) throw new Error('Steam model changed');
      return value;
    }
  }
  const feedManager = {
    values: { [appId]: url },
    subscribe(listener: () => void) { sourceListeners.add(listener); return () => sourceListeners.delete(listener); },
    cache: {
      peekLast: () => [item],
      subscribe(listener: () => void) { cacheListeners.add(listener); return () => cacheListeners.delete(listener); },
    },
  } as unknown as FeedManager;
  const native = {
    EventModel: FailingModel, ActivityEvent, language: 0,
    imageQueryKey: ['image', 'probe'], probeGid: 'probe', sharedClient: { setQueryData() {} },
  } as unknown as NativeBindings;
  Object.assign(globalThis, { window: { appActivityStore: store } });
  try {
    expect(() => registerActivityStore(feedManager, native)).toThrow('Steam model changed');
    expect(sourceListeners.size).toBe(0);
    expect(cacheListeners.size).toBe(0);
    expect(map.size).toBe(0);
    for (const name of Object.keys(originals))
      expect((store as any)[name]).toBe((originals as any)[name]);
    broken = false;
    const cleanup = registerActivityStore(feedManager, native);
    expect(store.GetAppActivity(appId)?.appActivityByDay[0].events).toHaveLength(1);
    cleanup();
    expect(map.size).toBe(0);
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
});
