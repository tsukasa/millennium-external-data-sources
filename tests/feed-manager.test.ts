import { beforeEach, expect, test } from 'bun:test';
import { installBackend, FeedManager, id, otherId, url, tick, runtime } from './helpers/ui-runtime';

beforeEach(installBackend);

test('shared feed cache survives another game joining, switching URLs or clearing its source', async () => {
  const feedManager = new FeedManager();
  const originalFetch = backend.fetchFeed;
  let requests = 0;
  backend.fetchFeed = async appId => {
    requests++;
    return JSON.stringify({ url: runtime.saved[appId], xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' });
  };
  try {
    await feedManager.save(id, url);
    const items = await feedManager.cache.get(id, url);
    expect(items).toHaveLength(1);

    await feedManager.save(otherId, url);
    expect(feedManager.cache.peekLast(url)).toBe(items);
    expect(requests).toBe(1);

    const newUrl = 'https://other.test/rss';
    await feedManager.save(id, newUrl);
    expect(feedManager.sources[otherId]?.url).toBe(url);
    expect(feedManager.cache.peekLast(url)).toBe(items);
    await feedManager.cache.get(id, newUrl);

    await feedManager.save(id, url);
    expect(feedManager.cache.peekLast(newUrl)).toBeUndefined();
    expect(feedManager.cache.peekLast(url)).toBe(items);
    expect(requests).toBe(2);

    await feedManager.clear(id);
    expect(feedManager.cache.peekLast(url)).toBe(items);
    await feedManager.clear(otherId);
    expect(feedManager.cache.peekLast(url)).toBeUndefined();
  } finally {
    backend.fetchFeed = originalFetch;
    feedManager.dispose();
  }
});

test('settings without a URL survive loading and never start a feed request', async () => {
  runtime.shown = { [id]: false };
  runtime.maxed = { [id]: 5 };
  const feedManager = new FeedManager();
  const originalFetch = backend.fetchFeed;
  let requests = 0;
  backend.fetchFeed = async () => { requests++; throw new Error('No feed configured'); };
  try {
    await feedManager.load();
    expect(feedManager.sources[id]).toEqual({ url: '', showFeedInWhatsNew: false, maxItemsFromFeedInWhatsNew: 5 });
    await feedManager.prefetchConfigured(id);
    expect(requests).toBe(0);
  } finally {
    backend.fetchFeed = originalFetch;
    feedManager.dispose();
  }
});

test('persistent feed settings stay separate by AppID and failed writes retain previous state', async () => {
  runtime.saved = {};
  runtime.shown = {};
  runtime.maxed = {};
  runtime.removed = [];
  const feedManager = new FeedManager(); await feedManager.load();
  await feedManager.save(id, url, false); await feedManager.save(otherId, 'https://other.test/rss');
  const restart = new FeedManager(); await restart.load();
  expect(restart.sources).toEqual({
    [id]: { url, showFeedInWhatsNew: false, maxItemsFromFeedInWhatsNew: 3 },
    [otherId]: { url: 'https://other.test/rss', showFeedInWhatsNew: true, maxItemsFromFeedInWhatsNew: 3 },
  });
  await feedManager.addUrlToRemovedFeedItems('https://example.com/article');
  await feedManager.addUrlToRemovedFeedItems('https://example.com/article');
  await tick();
  expect(runtime.removed).toEqual(['https://example.com/article']);
  const removalRestart = new FeedManager(); await removalRestart.load();
  expect(removalRestart.feedRemovedItems.has('https://example.com/article')).toBe(true);
  await feedManager.setMaxItemsFromFeedInWhatsNew(id, 5);
  const limitRestart = new FeedManager(); await limitRestart.load();
  expect(limitRestart.sources[id]?.maxItemsFromFeedInWhatsNew).toBe(5);
  await expect(feedManager.save(id, 'https://fail.test/')).rejects.toThrow('Could not save feed source.');
  expect(feedManager.sources[id]?.url).toBe(url);
  expect(feedManager.sources[id]?.showFeedInWhatsNew).toBe(false);
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
  feedManager.sources[id] = { url, showFeedInWhatsNew: true };
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
  for (const feedId of ids) feedManager.sources[feedId] = { url: `https://example.com/${feedId}`, showFeedInWhatsNew: true };
  backend.fetchFeed = feedId => {
    requested.push(feedId);
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.set(feedId, () => {
      release.delete(feedId);
      active--;
      resolve(JSON.stringify({ url: feedManager.sources[feedId]?.url, xml: '<rss><channel/></rss>' }));
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

test('background refresh follows cache expiry after a nonzero fetch duration', async () => {
  const originalFetch = backend.fetchFeed;
  const originalSetTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let now = 0;
  let delayMs = 0;
  let runTimer!: () => void;
  let requests = 0;
  Date.now = () => now;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    runTimer = callback;
    delayMs = delay;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  backend.fetchFeed = async () => {
    requests++;
    now += 1_000;
    return JSON.stringify({ url, xml: `<rss><channel><item><title>Update ${requests}</title><link>https://example.com/update</link></item></channel></rss>` });
  };
  const feedManager = new FeedManager();
  feedManager.sources[id] = { url, showFeedInWhatsNew: true };
  try {
    feedManager.startBackgroundRefresh();
    await feedManager.prefetchConfigured();
    expect(delayMs).toBe(600_000);
    expect(now).toBe(1_000);
    expect(requests).toBe(1);
    expect(feedManager.cache.peekLast(url)?.[0].title).toBe('Update 1');

    now = 600_000;
    await feedManager.prefetchConfigured();
    expect(requests).toBe(1);

    now = 601_000;
    runTimer();
    await feedManager.prefetchConfigured();
    expect(requests).toBe(2);
    expect(feedManager.cache.peekLast(url)?.[0].title).toBe('Update 2');
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalNow;
  }
});

test('queued feeds refresh at the earliest expiry and failed refreshes retain their last result', async () => {
  const originalFetch = backend.fetchFeed;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  let now = 0;
  let delay = 0;
  let runTimer!: () => void;
  let fail = false;
  const requests: string[] = [];
  Date.now = () => now;
  globalThis.setTimeout = ((callback: () => void, milliseconds: number) => {
    runTimer = callback;
    delay = milliseconds;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
  const feedManager = new FeedManager();
  feedManager.concurrentFetches = 1;
  feedManager.sources = {
    [id]: { url, showFeedInWhatsNew: true },
    [otherId]: { url: `${url}/other`, showFeedInWhatsNew: true },
  };
  backend.fetchFeed = async appId => {
    requests.push(appId);
    now += 1_000;
    if (fail)
      throw new Error('offline');
    return JSON.stringify({ url: feedManager.sources[appId]?.url, xml: '<rss><channel/></rss>' });
  };
  try {
    feedManager.startBackgroundRefresh(id);
    await feedManager.prefetchConfigured();
    expect(requests).toEqual([id, otherId]);
    expect(now).toBe(2_000);
    expect(delay).toBe(599_000);

    const lastItems = feedManager.cache.peekLast(url);
    fail = true;
    now += delay;
    runTimer();
    await feedManager.prefetchConfigured();
    expect(requests).toEqual([id, otherId, id]);
    expect(feedManager.cache.peekLast(url)).toBe(lastItems);
    expect(delay).toBe(1);

    now += delay;
    runTimer();
    await feedManager.prefetchConfigured();
    expect(requests).toEqual([id, otherId, id, otherId]);
    expect(delay).toBe(598_999);

    fail = false;
    now += delay;
    runTimer();
    await feedManager.prefetchConfigured();
    expect(requests).toHaveLength(5);
    expect(feedManager.cache.refreshDelay(url)).toBeGreaterThan(0);
    now += delay;
    runTimer();
    await feedManager.prefetchConfigured();
    expect(requests).toHaveLength(6);
    expect(feedManager.cache.refreshDelay(`${url}/other`)).toBeGreaterThan(0);
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalNow;
  }
});

test('disposing during the first background request does not create a refresh timer', async () => {
  const originalFetch = backend.fetchFeed;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timers = 0;
  let finish!: (response: string) => void;
  backend.fetchFeed = () => new Promise(resolve => { finish = resolve; });
  globalThis.setTimeout = ((_callback: () => void, _milliseconds: number) => {
    timers++;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
  const feedManager = new FeedManager();
  feedManager.sources[id] = { url, showFeedInWhatsNew: true };
  try {
    feedManager.startBackgroundRefresh();
    const pending = feedManager.prefetchConfigured();
    feedManager.dispose();
    finish(JSON.stringify({ url, xml: '<rss><channel/></rss>' }));
    await pending;
    expect(timers).toBe(0);
    expect(feedManager.cache.peekLast(url)).toBeUndefined();
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('global feed settings persist and update the active refresh timer and cache', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  const originalFetch = backend.fetchFeed;
  const originalSettings = runtime.globalFeedSettings;
  let now = 0;
  const delays: number[] = [];
  const cleared: unknown[] = [];
  Date.now = () => now;
  globalThis.setTimeout = ((_: () => void, delay: number) => {
    delays.push(delay); return delays.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: unknown) => { cleared.push(timer); }) as typeof clearTimeout;
  let requests = 0;
  backend.fetchFeed = async () => {
    requests++;
    return JSON.stringify({ url, xml: '<rss><channel/></rss>' });
  };
  const feedManager = new FeedManager();
  try {
    await feedManager.load();
    feedManager.sources = { [id]: { url, showFeedInWhatsNew: true } };
    feedManager.startBackgroundRefresh();
    await feedManager.prefetchConfigured();
    expect(delays).toEqual([600_000]);
    expect(requests).toBe(1);

    await feedManager.setPluginFeedSettings(15, 3);
    expect(runtime.globalFeedSettings).toEqual({ refreshIntervalMinutes: 15, concurrentFetches: 3 });
    expect(delays).toEqual([600_000, 900_000]);
    expect(cleared).toContain(1);
    now = 600_000;
    expect(feedManager.cache.refreshDelay(url)).toBeGreaterThan(0);
    now = 900_000;
    expect(feedManager.cache.refreshDelay(url)).toBe(0);

    const restarted = new FeedManager();
    await restarted.load();
    expect([restarted.refreshIntervalMinutes, restarted.concurrentFetches]).toEqual([15, 3]);
    restarted.dispose();
    await expect(feedManager.setPluginFeedSettings(9, 3)).rejects.toThrow('Could not save feed settings.');
    expect(runtime.globalFeedSettings.refreshIntervalMinutes).toBe(15);
  } finally {
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
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
  for (const feedId of ids) feedManager.sources[feedId] = { url: `https://example.com/${feedId}`, showFeedInWhatsNew: true };
  feedManager.concurrentFetches = 3;
  backend.fetchFeed = feedId => {
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.push(() => {
      active--;
      resolve(JSON.stringify({ url: feedManager.sources[feedId]?.url, xml: '<rss><channel/></rss>' }));
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
  for (const feedId of ids) feedManager.sources[feedId] = { url: `https://example.com/${feedId}`, showFeedInWhatsNew: true };
  backend.fetchFeed = feedId => {
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => release.push(() => {
      active--;
      resolve(JSON.stringify({ url: feedManager.sources[feedId]?.url, xml: '<rss><channel/></rss>' }));
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

test('a failing subscriber neither rejects completed writes nor starves other subscribers', async () => {
  const feedManager = new FeedManager();
  const originalFetch = backend.fetchFeed;
  const originalError = console.error;
  const notified: string[] = [];
  backend.fetchFeed = async appId => JSON.stringify({ url: runtime.saved[appId], xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' });
  console.error = () => {};
  feedManager.subscribe(() => { throw new Error('Steam store changed'); });
  feedManager.subscribe(() => notified.push('manager'));
  feedManager.cache.subscribe(() => { throw new Error('Steam store changed'); });
  feedManager.cache.subscribe(changed => notified.push(changed));
  try {
    await feedManager.save(id, url);
    expect(runtime.saved[id]).toBe(url);
    expect(notified).toContain('manager');

    await expect(feedManager.cache.get(id, url)).resolves.toHaveLength(1);
    expect(notified).toContain(url);
    expect(feedManager.cache.peekLast(url)).toHaveLength(1);
  } finally {
    backend.fetchFeed = originalFetch;
    console.error = originalError;
    feedManager.dispose();
  }
});
