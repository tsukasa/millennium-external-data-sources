import { expect, test } from 'bun:test';
import { createExternalNewsEvents, createExternalNewsModels } from '../frontend/steam/news-events';
import type { NativeBindings } from '../frontend/steam/news-discovery';
import type { NewsItem } from '../frontend/feed';

class QueryClient {
  data = new Map<string, unknown>();
  setQueryData(key: unknown[], value: unknown) { this.data.set(JSON.stringify(key), value); }
}
class EventModel {
  clanSteamID = {};
  jsondata = {};
  static GenerateSummaryFromText(text: string) { return text.slice(0, 180); }
}
class ActivityEvent {
  constructor(readonly rtEventTime: number, ..._args: unknown[]) {}
}
const bindings = {
  EventModel, ActivityEvent, language: 0,
  imageQueryKey: ['native-image', 'probe', 'capsule', 0, '_400x225', undefined], probeGid: 'probe',
} as unknown as NativeBindings;
const article = (gid: string, date: number | null, extra = {}): NewsItem => ({
  gid, date, title: 'External article', contents: 'Summary', url: `https://example.com/${gid}`, ...extra,
});

test('carousel models need neither ActivityEvent construction nor query-cache writes', () => {
  class UnusedActivityEvent {
    constructor() { throw new Error('Carousel must not construct activity events'); }
  }
  const native = { ...bindings, ActivityEvent: UnusedActivityEvent } as unknown as NativeBindings;
  const item = article('carousel', 123, { image: 'https://example.com/image.png' });
  const [{ model, item: source }] = createExternalNewsModels(native, '3900360037', [item]);
  expect(source).toBe(item);
  expect(model.GID).toBe('external-news:3900360037:carousel');
  expect(model.postTime).toBe(123);
  expect(model.jsondata.localized_capsule_image[0]).toBe('https://example.com/image.png');
});

test('native models keep summaries short, preload images and retain dates', async () => {
  const client = new QueryClient();
  const contents = 'Full untruncated summary. '.repeat(40);
  const items = [article('a', new Date(2026, 8, 28).getTime() / 1000, { contents, image: 'https://example.com/image.jpg' }),
    article('b', new Date(2025, 8, 28).getTime() / 1000), article('c', null)];
  const events = createExternalNewsEvents({ ...bindings, sharedClient: client }, '3900360037', items);
  expect(events.map(event => event.rtEventTime)).toEqual(items.map(item => item.date ?? 0));
  const event = events[0];
  expect((event as any).IsEventLoaded()).toBe(true);
  const model = await event.GetEvent();
  expect(await event.ReloadEvent()).toBe(model);
  expect(model.type).toBe(28);
  expect(model.name.get(0)).toBe('External article');
  expect(model.jsondata.localized_summary[0]).toHaveLength(180);
  expect(model.description.get(0)).toBe(contents);
  expect(model.AnnouncementGID).toBe(model.GID);
  expect([...client.data.entries()].filter(([key]) => key.includes('native-image')).map(([, value]) => value))
    .toEqual([['https://example.com/image.jpg'], [], []]);
  expect(client.data.get(JSON.stringify(['useFallbackArtworkScreenshot', model.GID]))).toBeNull();
  expect(events[1].eventModel.jsondata.localized_capsule_image[0]).toStartWith('data:image/gif;base64,');
  const background = ['/customimages/3900360037_hero.jpg', '/customimages/3900360037_hero.png'];
  const withBackground = new QueryClient();
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: { href: 'https://steamloopback.host/library/home' },
    appStore: { GetAppOverviewByAppID: () => ({ appid: 3900360037 }) },
    appDetailsStore: { GetHeroImages: () => ({ rgHeroImages: background }) },
    App: { m_CurrentUser: { strSteamID: '76561197960356529' } },
  };
  try {
    const fallbackEvents = createExternalNewsEvents({ ...bindings, sharedClient: withBackground }, '3900360037', items);
    expect([...withBackground.data.entries()].filter(([key]) => key.includes('native-image')).map(([, value]) => value))
      .toEqual([['https://example.com/image.jpg'], background, background]);
    expect(fallbackEvents[1].eventModel.jsondata.localized_capsule_image[0])
      .toBe('https://steamloopback.host/customimages/3900360037_hero.jpg');
    // Steam drops inactive image queries after five minutes. Reloading the
    // existing event must restore both candidates, not just the model's JPG.
    for (const load of ['GetEvent', 'ReloadEvent'] as const) {
      withBackground.data.clear();
      expect(await fallbackEvents[1][load]()).toBe(fallbackEvents[1].eventModel);
      const gid = fallbackEvents[1].eventModel.GID;
      const imageKey = bindings.imageQueryKey.map(value => value === bindings.probeGid ? gid : value);
      expect(withBackground.data.get(JSON.stringify(imageKey))).toEqual(background);
      expect(withBackground.data.get(JSON.stringify(['useFallbackArtworkScreenshot', gid]))).toBeNull();
      // Steam's vote observer must find "no vote" cached, or it queries Steam with the synthetic GID.
      const voteKey = JSON.stringify(['GetClanAnnouncementVoteForUser', 90801, gid]);
      expect(withBackground.data.has(voteKey)).toBe(true);
      expect(withBackground.data.get(voteKey)).toBeNull();
    }
  } finally {
    (globalThis as any).window = previousWindow;
  }
  const other = createExternalNewsEvents({ ...bindings, sharedClient: new QueryClient() }, '3900360038', items);
  expect(other[0].eventModel.GID).not.toBe(model.GID);
});
