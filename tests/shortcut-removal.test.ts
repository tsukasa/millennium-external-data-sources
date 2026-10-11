import { beforeEach, expect, test } from 'bun:test';
import {
  installBackend, FeedManager, GameDetailsManager, registerShortcutRemoval, id, otherId, url, tick, runtime
} from './helpers/ui-runtime';

beforeEach(installBackend);

test('removing a shortcut clears options even when no feed URL was saved', async () => {
  runtime.shown = { [id]: false, [otherId]: false };
  runtime.maxed = { [id]: 5, [otherId]: 0 };
  const feedManager = new FeedManager(); await feedManager.load();
  const gameDetails = new GameDetailsManager(); await gameDetails.load();
  const apps = { RemoveShortcut(_appId: number) {} };
  Object.assign(globalThis, { SteamClient: { Apps: apps } });
  const unregister = registerShortcutRemoval(feedManager, gameDetails);
  try {
    apps.RemoveShortcut(Number(id));
    await tick();
    expect(runtime.shown).toEqual({ [otherId]: false });
    expect(runtime.maxed).toEqual({ [otherId]: 0 });
    expect(feedManager.sources).toEqual({
      [otherId]: { url: '', showFeedInWhatsNew: false, maxItemsFromFeedInWhatsNew: 0 },
    });
    const restarted = new FeedManager();
    await restarted.load();
    expect(restarted.sources[id]?.showFeedInWhatsNew).toBeUndefined();
    expect(restarted.sources[id]?.maxItemsFromFeedInWhatsNew).toBeUndefined();
    restarted.dispose();
  } finally {
    unregister();
    feedManager.dispose();
    gameDetails.dispose();
  }
});

test('removing a non-Steam shortcut clears only its configured feed', async () => {
  runtime.saved = { [id]: url, [otherId]: 'https://other.test/rss' };
  runtime.savedDetails = {
    [id]: {
      releaseDate: '2004-11-23', addedToLibraryDate: '2020-01-01', developer: ['Studio'], publisher: ['Publisher'],
    },
  };
  const feedManager = new FeedManager(); await feedManager.load();
  const gameDetails = new GameDetailsManager(); await gameDetails.load();
  const removedShortcuts: number[] = [];
  const apps = { RemoveShortcut(appId: number) { removedShortcuts.push(appId); } };
  Object.assign(globalThis, { SteamClient: { Apps: apps } });
  const original = apps.RemoveShortcut;
  const unregister = registerShortcutRemoval(feedManager, gameDetails);
  try {
    apps.RemoveShortcut(570);
    apps.RemoveShortcut(3000000000);
    expect(runtime.saved).toEqual({ [id]: url, [otherId]: 'https://other.test/rss' });
    apps.RemoveShortcut(Number(id));
    await tick();
    expect(removedShortcuts).toEqual([570, 3000000000, Number(id)]);
    expect(runtime.saved).toEqual({ [otherId]: 'https://other.test/rss' });
    expect(feedManager.sources).toEqual({
      [otherId]: { url: 'https://other.test/rss', showFeedInWhatsNew: true, maxItemsFromFeedInWhatsNew: 3 },
    });
    expect(runtime.savedDetails[id]).toBeUndefined();
  } finally {
    unregister();
    feedManager.dispose();
    gameDetails.dispose();
  }
  expect(apps.RemoveShortcut).toBe(original);
});

test('removing a shortcut clears stored settings even when they were never loaded', async () => {
  runtime.saved = { [id]: url };
  runtime.savedDetails = { [id]: { developer: ['Studio'] } };
  const feedManager = new FeedManager();
  const gameDetails = new GameDetailsManager();
  const apps = { RemoveShortcut(_appId: number) {} };
  Object.assign(globalThis, { SteamClient: { Apps: apps } });
  const unregister = registerShortcutRemoval(feedManager, gameDetails);
  try {
    apps.RemoveShortcut(Number(id));
    await tick();
    expect(runtime.saved[id]).toBeUndefined();
    expect(runtime.savedDetails[id]).toBeUndefined();
  } finally {
    unregister();
    feedManager.dispose();
    gameDetails.dispose();
  }
});
