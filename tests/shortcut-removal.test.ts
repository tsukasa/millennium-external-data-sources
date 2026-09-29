import { beforeEach, expect, test } from 'bun:test';
import { installBackend, FeedManager, ReleaseDateManager, registerShortcutRemoval, id, otherId, url, tick, runtime } from './helpers/ui-runtime';

beforeEach(installBackend);

test('removing a non-Steam shortcut clears only its configured feed', async () => {
  runtime.saved = { [id]: url, [otherId]: 'https://other.test/rss' };
  runtime.savedDates = { [id]: { year: 2004, month: 11, day: 23 } };
  const feedManager = new FeedManager(); await feedManager.load();
  const releaseDates = new ReleaseDateManager(); await releaseDates.load();
  const removedShortcuts: number[] = [];
  const apps = { RemoveShortcut(appId: number) { removedShortcuts.push(appId); } };
  Object.assign(globalThis, { SteamClient: { Apps: apps } });
  const original = apps.RemoveShortcut;
  const unregister = registerShortcutRemoval(feedManager, releaseDates);
  try {
    apps.RemoveShortcut(570);
    apps.RemoveShortcut(3000000000);
    expect(runtime.saved).toEqual({ [id]: url, [otherId]: 'https://other.test/rss' });
    apps.RemoveShortcut(Number(id));
    await tick();
    expect(removedShortcuts).toEqual([570, 3000000000, Number(id)]);
    expect(runtime.saved).toEqual({ [otherId]: 'https://other.test/rss' });
    expect(feedManager.values).toEqual(runtime.saved);
    expect(runtime.savedDates[id]).toBeUndefined();
  } finally {
    unregister();
    feedManager.dispose();
    releaseDates.dispose();
  }
  expect(apps.RemoveShortcut).toBe(original);
});

