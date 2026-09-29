import { beforeEach, expect, test } from 'bun:test';
import { installBackend, FeedManager, id, otherId, url, tick, runtime } from './helpers/ui-runtime';

beforeEach(installBackend);

test('persistent feed settings stay separate by AppID and failed writes retain previous state', async () => {
  runtime.saved = {};
  runtime.shown = {};
  runtime.maxed = {};
  runtime.removed = [];
  const feedManager = new FeedManager(); await feedManager.load();
  await feedManager.save(id, url, false); await feedManager.save(otherId, 'https://other.test/rss');
  const restart = new FeedManager(); await restart.load();
  expect(restart.values).toEqual({ [id]: url, [otherId]: 'https://other.test/rss' });
  expect(restart.showFeedInWhatsNew).toEqual({ [id]: false, [otherId]: true });
  expect(restart.maxItemsFromFeedInWhatsNew).toEqual({ [id]: 3, [otherId]: 3 });
  await feedManager.addUrlToRemovedFeedItems('https://example.com/article');
  await feedManager.addUrlToRemovedFeedItems('https://example.com/article');
  await tick();
  expect(runtime.removed).toEqual(['https://example.com/article']);
  const removalRestart = new FeedManager(); await removalRestart.load();
  expect(removalRestart.feedRemovedItems.has('https://example.com/article')).toBe(true);
  await feedManager.setMaxItemsFromFeedInWhatsNew(id, 5);
  const limitRestart = new FeedManager(); await limitRestart.load();
  expect(limitRestart.maxItemsFromFeedInWhatsNew[id]).toBe(5);
  await expect(feedManager.save(id, 'https://fail.test/')).rejects.toThrow('disk error');
  expect(feedManager.values[id]).toBe(url);
  expect(feedManager.showFeedInWhatsNew[id]).toBe(false);
  await feedManager.clear(id); expect(runtime.saved[id]).toBeUndefined(); expect(runtime.saved[otherId]).toBeDefined();
  expect(runtime.shown[id]).toBeUndefined();
  expect(runtime.maxed[id]).toBeUndefined();
  expect(runtime.removed).toEqual(['https://example.com/article']);
  feedManager.dispose(); restart.dispose(); limitRestart.dispose(); removalRestart.dispose();
});


test('failed removal writes restore the card and leave saved URLs untouched', async () => {
  runtime.removed = [];
  const feedManager = new FeedManager();
  const original = backend.addFeedRemovedItem;
  const originalError = console.error;
  let updates = 0;
  const unsubscribe = feedManager.subscribe(() => { updates++; });
  backend.addFeedRemovedItem = async () => { throw new Error('disk error'); };
  console.error = () => {};
  try {
    await feedManager.addUrlToRemovedFeedItems('https://example.com/failed');
    expect(feedManager.feedRemovedItems.has('https://example.com/failed')).toBe(false);
    expect(runtime.removed).toEqual([]);
    expect(updates).toBe(2);
  } finally {
    backend.addFeedRemovedItem = original;
    console.error = originalError;
    unsubscribe();
    feedManager.dispose();
  }
});


test('background prefetch shares the feed request with an opened game', async () => {
  const original = backend.fetchFeed;
  let requests = 0;
  let finish!: (response: string) => void;
  const response = new Promise<string>(resolve => { finish = resolve; });
  backend.fetchFeed = async () => { requests++; return response; };
  const feedManager = new FeedManager();
  feedManager.values[id] = url;
  try {
    const prefetch = feedManager.prefetchConfigured(id);
    const opened = feedManager.cache.get(id, url);
    expect(requests).toBe(1);
    finish(JSON.stringify({ url, xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' }));
    await prefetch;
    expect((await opened)[0].title).toBe('Update');
    expect((await feedManager.cache.get(id, url))[0].title).toBe('Update');
    expect(requests).toBe(1);
  } finally {
    backend.fetchFeed = original;
    feedManager.dispose();
  }
});


test('background refresh starts once and fetches at most two feeds concurrently', async () => {
  const original = backend.fetchFeed;
  const ids = [id, otherId, '3000000001'];
  const feedManager = new FeedManager();
  const requested: string[] = [];
  const release = new Map<string, () => void>();
  let active = 0;
  let peak = 0;
  for (const feedId of ids) feedManager.values[feedId] = `https://example.com/${feedId}`;
  backend.fetchFeed = feedId => {
    requested.push(feedId);
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.set(feedId, () => {
      release.delete(feedId);
      active--;
      resolve(JSON.stringify({ url: feedManager.values[feedId], xml: '<rss><channel/></rss>' }));
    }));
  };
  try {
    feedManager.startBackgroundRefresh(ids[2]);
    feedManager.startBackgroundRefresh(ids[0]);
    expect(requested).toEqual([ids[2], ids[1]]);
    release.get(ids[2])?.();
    await tick();
    expect(requested).toEqual([ids[2], ids[1], ids[0]]);
    expect(peak).toBe(2);
  } finally {
    for (const finish of release.values()) finish();
    feedManager.dispose();
    backend.fetchFeed = original;
  }
});


test('background refresh fetches a configured feed again after ten minutes', async () => {
  const originalFetch = backend.fetchFeed;
  const originalSetInterval = globalThis.setInterval;
  const originalNow = Date.now;
  let now = 0;
  let intervalMs = 0;
  let runInterval!: () => void;
  let requests = 0;
  Date.now = () => now;
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    runInterval = callback;
    intervalMs = delay;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  backend.fetchFeed = async () => {
    requests++;
    return JSON.stringify({ url, xml: `<rss><channel><item><title>Update ${requests}</title><link>https://example.com/update</link></item></channel></rss>` });
  };
  const feedManager = new FeedManager();
  feedManager.values[id] = url;
  try {
    feedManager.startBackgroundRefresh();
    await tick();
    expect(intervalMs).toBe(600_000);
    expect(requests).toBe(1);
    expect(feedManager.cache.peek(url)?.[0].title).toBe('Update 1');

    now = 599_999;
    runInterval();
    await tick();
    expect(requests).toBe(1);

    now = 600_000;
    runInterval();
    await tick();
    expect(requests).toBe(2);
    expect(feedManager.cache.peek(url)?.[0].title).toBe('Update 2');
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setInterval = originalSetInterval;
    Date.now = originalNow;
  }
});


test('global feed settings persist and update the active refresh timer and cache', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalNow = Date.now;
  const originalFetch = backend.fetchFeed;
  const originalSettings = runtime.globalFeedSettings;
  let now = 0;
  const delays: number[] = [];
  const cleared: unknown[] = [];
  Date.now = () => now;
  globalThis.setInterval = ((_: () => void, delay: number) => {
    delays.push(delay); return delays.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer: unknown) => { cleared.push(timer); }) as typeof clearInterval;
  let requests = 0;
  backend.fetchFeed = async () => {
    requests++;
    return JSON.stringify({ url, xml: '<rss><channel/></rss>' });
  };
  const feedManager = new FeedManager();
  try {
    await feedManager.load();
    feedManager.values = { [id]: url };
    feedManager.startBackgroundRefresh();
    await tick();
    expect(delays).toEqual([600_000]);
    expect(requests).toBe(1);

    await feedManager.setPluginFeedSettings(15, 3);
    expect(runtime.globalFeedSettings).toEqual({ refreshIntervalMinutes: 15, concurrentFetches: 3 });
    expect(delays).toEqual([600_000, 900_000]);
    expect(cleared).toContain(1);
    now = 600_000;
    expect(feedManager.cache.peek(url)).toBeDefined();
    now = 900_000;
    expect(feedManager.cache.peek(url)).toBeUndefined();

    const restarted = new FeedManager();
    await restarted.load();
    expect([restarted.refreshIntervalMinutes, restarted.concurrentFetches]).toEqual([15, 3]);
    restarted.dispose();
    await expect(feedManager.setPluginFeedSettings(9, 3)).rejects.toThrow();
    expect(runtime.globalFeedSettings.refreshIntervalMinutes).toBe(15);
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalNow;
    runtime.globalFeedSettings = originalSettings;
  }
});


test('configured worker count limits simultaneous background fetches', async () => {
  const originalFetch = backend.fetchFeed;
  const feedManager = new FeedManager();
  const ids = [id, otherId, '3000000001', '3000000002'];
  const release: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  for (const feedId of ids) feedManager.values[feedId] = `https://example.com/${feedId}`;
  feedManager.concurrentFetches = 3;
  backend.fetchFeed = feedId => {
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.push(() => {
      active--;
      resolve(JSON.stringify({ url: feedManager.values[feedId], xml: '<rss><channel/></rss>' }));
    }));
  };
  try {
    const prefetch = feedManager.prefetchConfigured();
    expect(active).toBe(3);
    release.shift()?.();
    await tick();
    expect(peak).toBe(3);
    expect(active).toBe(3);
    while (release.length) release.shift()?.();
    await prefetch;
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
  }
});

test('overlapping background refreshes reuse one worker group', async () => {
  const originalFetch = backend.fetchFeed;
  const feedManager = new FeedManager();
  const ids = [id, otherId, '3000000001', '3000000002'];
  const release: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  for (const feedId of ids) feedManager.values[feedId] = `https://example.com/${feedId}`;
  backend.fetchFeed = feedId => {
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.push(() => {
      active--;
      resolve(JSON.stringify({ url: feedManager.values[feedId], xml: '<rss><channel/></rss>' }));
    }));
  };
  try {
    const first = feedManager.prefetchConfigured();
    const second = feedManager.prefetchConfigured();
    expect(second).toBe(first);
    expect(active).toBe(2);
    while (release.length) {
      release.shift()?.();
      await tick();
    }
    await first;
    expect(peak).toBe(2);
  } finally {
    for (const finish of release) finish();
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
  }
});

