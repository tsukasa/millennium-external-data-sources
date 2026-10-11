import { expect, spyOn, test } from 'bun:test';
import { FeedManager, id, installBackend, tick } from './helpers/ui-runtime';

const initialize = (await import('../frontend/index')).default;

const startupModes = ['normal', 'stopped', 'failed', 'feed-failed', 'stopped-during-feed'];

/** Logged errors that report a failed configuration load. */
const configurationErrors = (errors: { mock: { calls: unknown[][] } }) =>
  errors.mock.calls.filter(([message]) => String(message).includes('Could not load configuration'));

test.each(startupModes)('startup prioritizes tags and handles %s initialization', async mode => {
  installBackend();
  const previousClient = globalThis.SteamClient;
  const previousInterval = globalThis.setInterval;
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  const refresh = spyOn(FeedManager.prototype, 'startBackgroundRefresh').mockImplementation(() => {});
  const previousWindow = {
    appStore: (window as any).appStore, appDetailsStore: (window as any).appDetailsStore,
    collectionStore: (window as any).collectionStore,
    MainWindowBrowserManager: (window as any).MainWindowBrowserManager,
    g_PopupManager: (window as any).g_PopupManager,
  };
  const native = { appid: Number(id), rt_original_release_date: 0, m_setStoreTags: new Set<number>(),
    BHasStoreTag(tag: number) { return this.m_setStoreTags.has(tag); } };
  const apps = new Map([[Number(id), native]]);
  let runInitialization!: () => Promise<void>;
  globalThis.setInterval = ((callback: () => Promise<void>, delay: number) => {
    if (delay === 250) runInitialization = callback;
    return previousInterval(() => {}, 60_000);
  }) as typeof setInterval;
  Object.assign(globalThis, { SteamClient: {
    Settings: { GetCurrentLanguage: async () => 'english' },
    Apps: { RegisterForAppOverviewChanges() {}, RemoveShortcut() {} },
  } });
  Object.assign(window, {
    appStore: { m_mapApps: apps, GetAppOverviewByAppID: (appId: number) => apps.get(appId) || null },
    MainWindowBrowserManager: undefined, g_PopupManager: undefined,
    appDetailsStore: undefined, collectionStore: undefined,
  });
  let finishDetails!: (value: string) => void;
  let failDetails!: (error: Error) => void;
  let detailReads = 0;
  let feedReads = 0;
  backend.getGameDetails = () => {
    detailReads++;
    return new Promise<string>((resolve, reject) => { finishDetails = resolve; failDetails = reject; });
  };
  const getSources = backend.getFeedSources;
  let finishFeed!: () => void;
  backend.getFeedSources = async () => {
    feedReads++;
    expect(apps.get(Number(id))!.BHasStoreTag(19)).toBe(mode !== 'failed');
    if (mode === 'failed')
      expect(errors.mock.calls.some(([message]) => String(message).includes('Could not load game details'))).toBe(true);
    if (mode === 'feed-failed')
      throw new Error('Feed configuration unavailable');
    if (mode === 'stopped-during-feed')
      await new Promise<void>(resolve => { finishFeed = resolve; });
    return getSources();
  };
  const plugin = await initialize();
  try {
    expect(detailReads).toBe(1);
    await runInitialization();
    expect(feedReads).toBe(0);
    if (mode === 'stopped') plugin.onDismount?.();
    if (mode === 'failed') failDetails(new Error('Details unavailable'));
    else finishDetails(JSON.stringify({ [id]: { tags: [19] } }));
    await tick();
    // Feed configuration depends on metadata, not the window managers.
    expect(feedReads).toBe(mode === 'stopped' ? 0 : 1);
    expect(apps.get(Number(id))!.BHasStoreTag(19)).toBe(mode !== 'stopped' && mode !== 'failed');
    if (mode === 'stopped-during-feed') {
      plugin.onDismount?.();
      finishFeed();
      await tick();
    }
    expect(refresh).toHaveBeenCalledTimes(mode === 'normal' || mode === 'failed' ? 1 : 0);
    if (mode === 'feed-failed')
      expect(configurationErrors(errors)).not.toHaveLength(0);
    Object.assign(window, { MainWindowBrowserManager: {}, g_PopupManager: { GetExistingPopup() {} } });
    await runInitialization();
    expect(feedReads).toBe(mode === 'stopped' ? 0 : 1);
  } finally {
    plugin.onDismount?.();
    globalThis.setInterval = previousInterval;
    Object.assign(globalThis, { SteamClient: previousClient });
    Object.assign(window, previousWindow);
    errors.mockRestore();
    refresh.mockRestore();
  }
});

test('startup retries a failed configuration load and starts the background refresh afterwards', async () => {
  installBackend();
  const previousClient = globalThis.SteamClient;
  const previousTimeout = globalThis.setTimeout;
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  const refresh = spyOn(FeedManager.prototype, 'startBackgroundRefresh').mockImplementation(() => {});
  const retries: { callback: () => void; delay: number }[] = [];
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay === 1_000 || delay === 2_000) {
      retries.push({ callback, delay });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return previousTimeout(callback, delay);
  }) as typeof setTimeout;
  Object.assign(globalThis, { SteamClient: {
    Settings: { GetCurrentLanguage: async () => 'english' },
    Apps: { RegisterForAppOverviewChanges() {}, RemoveShortcut() {} },
  } });
  const getSources = backend.getFeedSources;
  let failures = 2;
  backend.getFeedSources = async () => {
    if (failures-- > 0) throw new Error('Backend not ready');
    return getSources();
  };
  const plugin = await initialize();
  try {
    await tick();
    expect(retries.map(retry => retry.delay)).toEqual([1_000]);
    expect(refresh).not.toHaveBeenCalled();
    retries.shift()!.callback();
    await tick();
    expect(retries.map(retry => retry.delay)).toEqual([2_000]);
    retries.shift()!.callback();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(configurationErrors(errors)).toHaveLength(2);
  } finally {
    plugin.onDismount?.();
    globalThis.setTimeout = previousTimeout;
    Object.assign(globalThis, { SteamClient: previousClient });
    errors.mockRestore();
    refresh.mockRestore();
  }
});
