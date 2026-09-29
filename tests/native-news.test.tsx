import { expect, test } from 'bun:test';
import { createExternalNewsEvents } from '../frontend/steam/news-events';
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

test('native models keep summaries short, preload images and retain dates', async () => {
  const client = new QueryClient();
  const contents = 'Full untruncated summary. '.repeat(40);
  const items = [article('a', new Date(2026, 8, 28).getTime() / 1000, { contents, image: 'https://example.com/image.jpg' }),
    article('b', new Date(2025, 8, 28).getTime() / 1000), article('c', null)];
  const events = createExternalNewsEvents(bindings, '3900360037', items, client);
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
  };
  try {
    const fallbackEvents = createExternalNewsEvents(bindings, '3900360037', items, withBackground);
    expect([...withBackground.data.entries()].filter(([key]) => key.includes('native-image')).map(([, value]) => value))
      .toEqual([['https://example.com/image.jpg'], background, background]);
    expect(fallbackEvents[1].eventModel.jsondata.localized_capsule_image[0])
      .toBe('https://steamloopback.host/customimages/3900360037_hero.jpg');
  } finally {
    (globalThis as any).window = previousWindow;
  }
  const other = createExternalNewsEvents(bindings, '3900360038', items, new QueryClient());
  expect(other[0].eventModel.GID).not.toBe(model.GID);
});
