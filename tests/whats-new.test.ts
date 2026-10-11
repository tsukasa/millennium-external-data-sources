import { JSDOM } from 'jsdom';
import { beforeEach, expect, test, setSystemTime } from 'bun:test';
import { installBackend, FeedManager, registerWhatsNew, id, url, tick, runtime } from './helpers/ui-runtime';
import type { NativeBindings } from '../frontend/steam/news-discovery';

beforeEach(installBackend);

function setupWhatsNew() {
  runtime.removed = [];
  const originalFetch = backend.fetchFeed;
  const freshFeed = () => '<rss><channel><item><title>Fresh article</title><link>https://example.com/fresh</link>'
    + `<pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  backend.fetchFeed = async () => JSON.stringify({ url, xml: freshFeed() });
  const feedManager = new FeedManager();
  feedManager.sources[id] = { url, showFeedInWhatsNew: true };
  class EventModel {
    clanSteamID = { GetAccountID: () => 0 };
    jsondata = {};
    static GenerateSummaryFromText(value: string) { return value; }
  }
  class ActivityEvent {
    constructor(..._args: unknown[]) {}
  }
  const nativeBindings = {
    EventModel, ActivityEvent, language: 0, imageQueryKey: ['image', 'probe'], probeGid: 'probe',
  } as unknown as NativeBindings;
  const counters = { tracked: 0, navigated: 0, appNavigated: 0 };
  const priorityCalls: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const steamEvents = [
    { GID: 'newer-steam-event', GetStartTimeAndDateUnixSeconds: () => now + 3600 },
    { GID: 'older-steam-event', GetStartTimeAndDateUnixSeconds: () => now - 3600 },
  ];
  const steamStore = {
    m_vecHomeBestEventsForUser: steamEvents,
    GetWhatsNewEvents() {
      return { bEventsLoaded: true, eventsToShow: this.m_vecHomeBestEventsForUser, takeoverEvents: [] };
    },
    TrackEventShownToUser(_event?: unknown) { counters.tracked++; },
    TrackEventClickedByUser(_event?: unknown) { counters.tracked++; },
    TrackEventShownToUserByGID(_gid: string) { counters.tracked++; },
    RemoveEvent(_gid?: string) { counters.tracked++; },
    GetUserAppPrioritySetting(_appId: number) { return 0; },
    async RaiseAppPriorityForApp(appId: number) { priorityCalls.push(`more:${appId}`); return true; },
    async LowerAppPriorityForApp(appId: number) { priorityCalls.push(`less:${appId}`); return true; },
    async ResetUserAppPriorityForApp(appId: number) { priorityCalls.push(`reset:${appId}`); return true; },
  };
  const navigator = {
    Home(_event?: unknown) { counters.navigated++; },
    App(_appId?: number, _options?: unknown) { counters.appNavigated++; },
  };
  const navStore = { GetNavigator: () => navigator, SetNavigator(_navigator: { Home(): unknown }) {} };
  const settings = { clientSettings: { library_whats_new_show_only_product_updates: false } };
  const hero = '/customimages/game_hero.jpg';
  const previousWindow = Object.fromEntries(['appStore', 'appDetailsStore', 'g_PopupManager',
    'libraryEventStore', 'tempNavStore', 'settingsStore'].map(key => [key, (window as any)[key]]));
  const bpmDocument = new JSDOM('<body></body>').window.document;
  const laterBpmDocument = new JSDOM('<body></body>').window.document;
  let popupCreated: ((popup: any) => void) | undefined;
  Object.assign(window, {
    libraryEventStore: steamStore, tempNavStore: navStore, settingsStore: settings,
    appStore: { GetAppOverviewByAppID: () => ({ appid: Number(id) }) },
    appDetailsStore: { GetHeroImages: () => ({ rgHeroImages: [hero] }) },
    g_PopupManager: {
      GetExistingPopup: (name: string) => name === 'SP BPM_uid0' ? { window: { document: bpmDocument } } : undefined,
      AddPopupCreatedCallback(callback: (popup: any) => void) {
        popupCreated = callback;
        return { Unregister() { popupCreated = undefined; } };
      },
    },
  });
  const originalEvents = steamStore.GetWhatsNewEvents;
  const originalHome = navigator.Home;
  const originalApp = navigator.App;
  const originalRaise = steamStore.RaiseAppPriorityForApp;
  const originalLower = steamStore.LowerAppPriorityForApp;
  const cleanup = registerWhatsNew(feedManager, nativeBindings)!;
  return {
    feedManager, nativeBindings, EventModel, steamEvents, steamStore, navigator, navStore,
    settings, hero, bpmDocument, laterBpmDocument, counters, priorityCalls, cleanup, originalFetch,
    get popupCreated() { return popupCreated; },
    dispose() {
      cleanup();
      expect(document.head.querySelector('style')).toBeNull();
      expect(bpmDocument.head.querySelector('style')).toBeNull();
      expect(laterBpmDocument.head.querySelector('style')).toBeNull();
      expect(steamStore.GetWhatsNewEvents).toBe(originalEvents);
      expect(navigator.Home).toBe(originalHome);
      expect(navigator.App).toBe(originalApp);
      expect(steamStore.RaiseAppPriorityForApp).toBe(originalRaise);
      expect(steamStore.LowerAppPriorityForApp).toBe(originalLower);
      feedManager.dispose();
      backend.fetchFeed = originalFetch;
      Object.assign(window, previousWindow);
    },
  };
}

/** Declares a test that runs with a fresh What's New setup and disposes it afterwards. */
function testWhatsNew(name: string, check: (context: ReturnType<typeof setupWhatsNew>) => Promise<void>) {
  test(name, async () => {
    const context = setupWhatsNew();
    try {
      await check(context);
    } finally {
      context.dispose();
    }
  });
}

function captureArticle(action: () => void): string | undefined {
  let opened: string | undefined;
  const capture = (event: Event) => {
    const anchor = event.target as HTMLAnchorElement;
    if (anchor.tagName === 'A') { opened = anchor.href; event.preventDefault(); }
  };
  document.addEventListener('click', capture, true);
  try {
    action();
    return opened;
  } finally {
    document.removeEventListener('click', capture, true);
  }
}

testWhatsNew("What's New uses native models, orders articles and styles both popup modes", async ({
  feedManager, steamStore, EventModel, hero, bpmDocument, laterBpmDocument, popupCreated,
}) => {
  expect(document.head.querySelector('style')?.textContent)
    .toContain('.EventRowCarousel img.PartnerEventRowCapsule_MainImage');
  expect(document.head.querySelector('style')?.textContent).toContain('object-fit: cover');
  expect(bpmDocument.head.querySelector('style')?.textContent)
    .toContain('.BasicHomeUpdates .EventCarousel img.EventImage');
  popupCreated?.({ m_strName: 'SP BPM_uid0', window: { document: laterBpmDocument } });
  expect(laterBpmDocument.head.querySelector('style')?.textContent).toContain('aspect-ratio: 16 / 9');
  await feedManager.prefetchConfigured();
  const events = steamStore.GetWhatsNewEvents().eventsToShow;
  expect(events).toHaveLength(3);
  expect(events.map(event => event.GID))
    .toEqual(['newer-steam-event', expect.stringContaining('external-news:'), 'older-steam-event']);
  expect(events[1]).toBeInstanceOf(EventModel);
  expect((events[1] as any).AnnouncementGID).toBe((events[1] as any).GID);
  expect((events[1] as any).name.get(0)).toBe('Fresh article');
  expect((events[1] as any).jsondata.localized_capsule_image[0]).toBe(new URL(hero, window.location.href).href);
  expect((events[1] as any).startTime).toBeGreaterThan(0);
});

testWhatsNew("What's New retains expired feeds, excludes old articles and respects visibility settings", async ({
  feedManager, steamStore, originalFetch, steamEvents, settings, navigator, counters,
}) => {
  await feedManager.prefetchConfigured();
  const originalNow = Date.now;
  let extraFetches = 0;
  backend.fetchFeed = async () => { extraFetches++; throw new Error('unexpected fetch'); };
  try {
    setSystemTime(originalNow() + 599_000);
    await feedManager.prefetchConfigured();
    expect(extraFetches).toBe(0);
    setSystemTime(originalNow() + 601_000);
    expect(feedManager.cache.refreshDelay(url)).toBe(0);
    expect(steamStore.GetWhatsNewEvents().eventsToShow).toHaveLength(3);
    setSystemTime(originalNow() + 31 * 24 * 60 * 60 * 1_000);
    expect(steamStore.GetWhatsNewEvents().eventsToShow).toHaveLength(2);
  } finally {
    setSystemTime();
    backend.fetchFeed = originalFetch;
  }
  feedManager.sources[id].showFeedInWhatsNew = false;
  expect(steamStore.GetWhatsNewEvents().eventsToShow).toEqual(steamEvents);
  feedManager.sources[id].showFeedInWhatsNew = true;
  expect(steamStore.GetWhatsNewEvents().eventsToShow).toHaveLength(3);
  settings.clientSettings.library_whats_new_show_only_product_updates = true;
  expect(steamStore.GetWhatsNewEvents().eventsToShow).toEqual(steamEvents);
  navigator.Home();
  expect(counters.navigated).toBe(1);
});

testWhatsNew("What's New suppresses external tracking and priority writes while preserving native actions", async ({
  feedManager, steamStore, priorityCalls, counters,
}) => {
  await feedManager.prefetchConfigured();
  const events = steamStore.GetWhatsNewEvents().eventsToShow;
  steamStore.TrackEventShownToUser(events[1]);
  steamStore.TrackEventClickedByUser(events[1]);
  steamStore.TrackEventShownToUserByGID((events[1] as any).GID);
  expect(counters.tracked).toBe(0);
  expect(steamStore.GetUserAppPrioritySetting(Number(id))).toBeUndefined();
  expect(await steamStore.RaiseAppPriorityForApp(Number(id))).toBe(false);
  expect(await steamStore.LowerAppPriorityForApp(Number(id))).toBe(false);
  expect(await steamStore.ResetUserAppPriorityForApp(Number(id))).toBe(false);
  expect(priorityCalls).toEqual([]);
  expect(await steamStore.RaiseAppPriorityForApp(570)).toBe(true);
  expect(await steamStore.LowerAppPriorityForApp(570)).toBe(true);
  expect(priorityCalls).toEqual(['more:570', 'less:570']);
  expect(await steamStore.ResetUserAppPriorityForApp(570)).toBe(true);
  expect(priorityCalls).toEqual(['more:570', 'less:570', 'reset:570']);
  steamStore.TrackEventShownToUserByGID('native-event');
  expect(counters.tracked).toBe(1);
  counters.tracked = 0;
});

testWhatsNew("What's New opens articles even after their feed is hidden from the carousel", async ({
  feedManager, steamStore, navigator, counters,
}) => {
  await feedManager.prefetchConfigured();
  const events = steamStore.GetWhatsNewEvents().eventsToShow;
  const opened = captureArticle(() => {
    navigator.Home({ partnerEvent: { appid: Number(id), gid: events[1].GID } });
    feedManager.sources[id].showFeedInWhatsNew = false;
    steamStore.GetWhatsNewEvents();
    navigator.App(Number(id), { gidPartnerEvent: events[1].GID });
  });
  expect(opened).toBe('https://example.com/fresh');
  expect(counters.navigated).toBe(0);
  expect(counters.appNavigated).toBe(0);
});

testWhatsNew("What's New persists removals, fills vacancies, applies item limits and opens capped articles", async ({
  feedManager, steamStore, navigator, steamEvents, counters,
}) => {
  await feedManager.prefetchConfigured();
  const events = steamStore.GetWhatsNewEvents().eventsToShow;
  steamStore.RemoveEvent((events[1] as any).GID);
  expect(steamStore.GetWhatsNewEvents().eventsToShow).toEqual(steamEvents);
  expect(counters.tracked).toBe(0);
  await tick();
  expect(runtime.removed).toEqual(['https://example.com/fresh']);
  const removalRestart = new FeedManager();
  await removalRestart.load();
  expect(removalRestart.feedRemovedItems.has('https://example.com/fresh')).toBe(true);
  removalRestart.dispose();

  const sameDay = new Date();
  sameDay.setUTCHours(12, 0, 0, 0);
  const articles = Array.from({ length: 8 }, (_, index) => index).reverse().map(index =>
    `<item><title>Article ${index}</title><link>https://example.com/article-${index}</link>` +
    `<pubDate>${new Date(sameDay.getTime() - index * 60_000).toUTCString()}</pubDate></item>`).join('');
  backend.fetchFeed = async () => JSON.stringify({ url, xml: `<rss><channel>${articles}</channel></rss>` });
  feedManager.cache.invalidate(url);
  await feedManager.prefetchConfigured();
  const feedEvents = (): any[] => (steamStore.GetWhatsNewEvents().eventsToShow as any[])
    .filter(event => event.GID.startsWith('external-news:'));
  expect(feedEvents().map(event => event.name.get(0))).toEqual(['Article 0', 'Article 1', 'Article 2']);
  steamStore.RemoveEvent(feedEvents()[0].GID);
  expect(feedEvents().map(event => event.name.get(0))).toEqual(['Article 1', 'Article 2', 'Article 3']);
  await tick();
  expect(runtime.removed).toEqual(['https://example.com/fresh', 'https://example.com/article-0']);
  await feedManager.setMaxItemsFromFeedInWhatsNew(id, 0);
  expect(feedEvents()).toHaveLength(7);
  await feedManager.setMaxItemsFromFeedInWhatsNew(id, 1);
  expect(feedEvents().map(event => event.name.get(0))).toEqual(['Article 1']);

  const cachedArticle = feedManager.cache.peekLast(url)?.find(item => item.url.endsWith('/article-7'));
  expect(cachedArticle).toBeDefined();
  const gid = `external-news:${id}:${cachedArticle!.gid}`;
  const opened = captureArticle(() => navigator.Home({ partnerEvent: { gid } }));
  expect(opened).toBe('https://example.com/article-7');
});

testWhatsNew("What's New cleanup preserves later plugins' wrappers and stops intercepting navigation", async ({
  feedManager, steamStore, navigator, navStore, settings, cleanup, nativeBindings, steamEvents, counters,
}) => {
  await feedManager.prefetchConfigured();
  const cachedArticle = feedManager.cache.peekLast(url)![0];
  cleanup();
  settings.clientSettings.library_whats_new_show_only_product_updates = false;
  const originals = {
    GetWhatsNewEvents: steamStore.GetWhatsNewEvents,
    RaiseAppPriorityForApp: steamStore.RaiseAppPriorityForApp,
    Home: navigator.Home,
    App: navigator.App,
    SetNavigator: navStore.SetNavigator,
  };
  const secondCleanup = registerWhatsNew(feedManager, nativeBindings)!;
  const innerEvents = steamStore.GetWhatsNewEvents;
  const innerRaise = steamStore.RaiseAppPriorityForApp;
  const innerHome = navigator.Home;
  const innerApp = navigator.App;
  const innerSet = navStore.SetNavigator;
  const foreignEvents = () => innerEvents.call(steamStore);
  const foreignRaise = (appId: number) => innerRaise.call(steamStore, appId);
  const foreignHome = (...args: Parameters<typeof innerHome>) => innerHome.apply(navigator, args);
  const foreignApp = (...args: Parameters<typeof innerApp>) => innerApp.apply(navigator, args);
  const foreignSet = (...args: Parameters<typeof innerSet>) => innerSet.apply(navStore, args);
  Object.assign(steamStore, { GetWhatsNewEvents: foreignEvents, RaiseAppPriorityForApp: foreignRaise });
  Object.assign(navigator, { Home: foreignHome, App: foreignApp });
  navStore.SetNavigator = foreignSet;
  try {
    secondCleanup();
    expect(steamStore.GetWhatsNewEvents).toBe(foreignEvents);
    expect(steamStore.RaiseAppPriorityForApp).toBe(foreignRaise);
    expect(navigator.Home).toBe(foreignHome);
    expect(navigator.App).toBe(foreignApp);
    expect(navStore.SetNavigator).toBe(foreignSet);
    expect(steamStore.GetWhatsNewEvents().eventsToShow).toEqual(steamEvents);
    expect(await steamStore.RaiseAppPriorityForApp(Number(id))).toBe(true);
    const beforeHome = counters.navigated;
    const beforeApp = counters.appNavigated;
    navigator.Home({ partnerEvent: { gid: `external-news:${id}:${cachedArticle!.gid}` } });
    navigator.App(Number(id), { gidPartnerEvent: `external-news:${id}:${cachedArticle!.gid}` });
    expect(counters.navigated).toBe(beforeHome + 1);
    expect(counters.appNavigated).toBe(beforeApp + 1);
    const laterNavigator = { Home() {} };
    const laterHome = laterNavigator.Home;
    navStore.SetNavigator(laterNavigator);
    expect(laterNavigator.Home).toBe(laterHome);
  } finally {
    secondCleanup();
    Object.assign(steamStore, {
      GetWhatsNewEvents: originals.GetWhatsNewEvents,
      RaiseAppPriorityForApp: originals.RaiseAppPriorityForApp,
    });
    Object.assign(navigator, { Home: originals.Home, App: originals.App });
    navStore.SetNavigator = originals.SetNavigator;
  }
});

test('What\'s New installation failure removes partial hooks, popup subscriptions and styles', () => {
  const previousStore = (window as any).libraryEventStore;
  const previousNav = (window as any).tempNavStore;
  const previousSettings = (window as any).settingsStore;
  const previousPopups = (window as any).g_PopupManager;
  const calls: string[] = [];
  const store = {
    GetWhatsNewEvents() { return { eventsToShow: [] }; },
    TrackEventShownToUser() {}, TrackEventClickedByUser() {}, RemoveEvent() {},
    GetUserAppPrioritySetting() { return 0; },
    async RaiseAppPriorityForApp() {}, async LowerAppPriorityForApp() {},
  };
  const originals = { ...store };
  Object.defineProperty(store, 'RaiseAppPriorityForApp', { configurable: false, writable: false });
  const feedManager = new FeedManager();
  const listeners = new Set<() => void>();
  feedManager.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  Object.assign(window, {
    libraryEventStore: store,
    settingsStore: { clientSettings: {} },
    tempNavStore: { SetNavigator() {}, GetNavigator() {} },
    g_PopupManager: {
      GetExistingPopup() {},
      AddPopupCreatedCallback() { calls.push('subscribe'); return { Unregister() { calls.push('unsubscribe'); } }; },
    },
  });
  try {
    expect(() => registerWhatsNew(feedManager, {} as NativeBindings)).toThrow();
    for (const name of Object.keys(originals))
      expect((store as any)[name]).toBe((originals as any)[name]);
    expect(calls).toEqual(['subscribe', 'unsubscribe']);
    expect(document.head.querySelector('style')).toBeNull();
    expect(listeners.size).toBe(0);
  } finally {
    Object.assign(window, { libraryEventStore: previousStore, tempNavStore: previousNav,
      settingsStore: previousSettings, g_PopupManager: previousPopups });
    feedManager.dispose();
  }
});
