import { beforeAll, expect, mock, setSystemTime, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, createElement as h, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { LayoutProps, SeekTarget } from '../frontend/renderers/library-layout';

const dom = new JSDOM('<body></body>', { url: 'https://steamloopback.host' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true });
mock.module('millennium', () => ({
  findClassModule: (): undefined => undefined,
  Button: (): null => null, TextField: (): null => null,
  beforePatch: (object: Record<string, unknown>, property: string, handler: (this: unknown, args: unknown[]) => void) => {
    const original = object[property] as (...args: unknown[]) => unknown;
    object[property] = function(this: unknown, ...args: unknown[]) { handler.call(this, args); return original.apply(this, args); };
    return { unpatch: () => { object[property] = original; } };
  },
  afterPatch: (object: Record<string, unknown>, property: string, handler: (args: unknown[], result: unknown) => unknown) => {
    const original = object[property] as (...args: unknown[]) => unknown;
    object[property] = function(this: unknown, ...args: unknown[]) { return handler(args, original.apply(this, args)); };
    return { unpatch: () => { object[property] = original; } };
  },
}));
const { Sources } = await import('../frontend/sources');
const { registerShortcutRemoval } = await import('../frontend/shortcuts');
const { createLibraryLayout } = await import('../frontend/renderers/library-layout');
const { registerProperties, PLUGIN_PROPERTIES_ROUTE: NEWS_ROUTE } = await import('../frontend/properties');
const { renderNewsFeed } = await import('../frontend/news');
const { initI18n, getPluginI18nString } = await import('../frontend/i18n');
const { APP_SECTION_CLASSES_FALLBACK } = await import('../frontend/classes');

const id = '3900360037', otherId = '2436693853', url = 'https://example.com/feed';
let saved: Record<string, string> = {};
beforeAll(() => {
  Object.assign(globalThis, { backend: {
    // Actual Millennium FFI decodes the backend JSON before returning it.
    getFeedSources: async () => ({ ...saved }),
    saveFeedSource: async (key: string, value: string) => { if (value.includes('fail')) throw new Error('disk error'); saved[key] = value; return true; },
    clearFeedSource: async (key: string) => { delete saved[key]; return true; },
    fetchFeed: async () => JSON.stringify({ url, xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' }),
  } });
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('persistent sources stay separate by AppID and failed writes retain previous state', async () => {
  saved = {};
  const sources = new Sources(); await sources.load();
  await sources.save(id, url); await sources.save(otherId, 'https://other.test/rss');
  const restart = new Sources(); await restart.load();
  expect(restart.values).toEqual({ [id]: url, [otherId]: 'https://other.test/rss' });
  await expect(sources.save(id, 'https://fail.test/')).rejects.toThrow('disk error');
  expect(sources.values[id]).toBe(url);
  await sources.clear(id); expect(saved[id]).toBeUndefined(); expect(saved[otherId]).toBeDefined();
});

test('removing a non-Steam shortcut clears only its configured feed', async () => {
  saved = { [id]: url, [otherId]: 'https://other.test/rss' };
  const sources = new Sources(); await sources.load();
  const removed: number[] = [];
  const apps = { RemoveShortcut(appId: number) { removed.push(appId); } };
  Object.assign(globalThis, { SteamClient: { Apps: apps } });
  const original = apps.RemoveShortcut;
  const unregister = registerShortcutRemoval(sources);
  try {
    apps.RemoveShortcut(570);
    apps.RemoveShortcut(3000000000);
    expect(saved).toEqual({ [id]: url, [otherId]: 'https://other.test/rss' });
    apps.RemoveShortcut(Number(id));
    await tick();
    expect(removed).toEqual([570, 3000000000, Number(id)]);
    expect(saved).toEqual({ [otherId]: 'https://other.test/rss' });
    expect(sources.values).toEqual(saved);
  } finally {
    unregister();
    sources.dispose();
  }
  expect(apps.RemoveShortcut).toBe(original);
});

test('background prefetch shares the feed request with an opened game', async () => {
  const original = backend.fetchFeed;
  let requests = 0;
  let finish!: (response: string) => void;
  const response = new Promise<string>(resolve => { finish = resolve; });
  backend.fetchFeed = async () => { requests++; return response; };
  const sources = new Sources();
  sources.values[id] = url;
  try {
    const prefetch = sources.prefetchConfigured(id);
    const opened = sources.cache.get(id, url);
    expect(requests).toBe(1);
    finish(JSON.stringify({ url, xml: '<rss><channel><item><title>Update</title><link>https://example.com/update</link></item></channel></rss>' }));
    await prefetch;
    expect((await opened)[0].title).toBe('Update');
    expect((await sources.cache.get(id, url))[0].title).toBe('Update');
    expect(requests).toBe(1);
  } finally {
    backend.fetchFeed = original;
    sources.dispose();
  }
});

test('properties tab guards, duplicates, coexistence with Playtime and cleanup', () => {
  const sources = new Sources();
  const pages: { title: string; route: string; link: string; content: unknown }[] = [{ title: 'Shortcut', route: '/app/:appid/properties/general', link: `/app/${id}/properties/general`, content: null },
    { title: 'Playtime', route: '/app/:appid/properties/playtime', link: `/app/${id}/properties/playtime`, content: null }];
  const unregister = registerProperties(sources);
  pages.map(page => page.title); pages.map(page => page.title);
  expect(pages.filter(page => page.route === NEWS_ROUTE)).toHaveLength(1);
  const steamPages = [{ ...pages[0], link: '/app/570/properties/general' }];
  steamPages.map(page => page.title); expect(steamPages).toHaveLength(1);
  unregister(); expect(pages.map(page => page.title)).toEqual(['Shortcut', 'Playtime']);
});

test('native cards: all medium-image news events have individual Steam panels and safe content', () => {
  const contents = `${'Long summary text. '.repeat(20)}End of summary.`;
  const root = renderNewsFeed(document, Array.from({ length: 4 }, (_, i) => ({ gid: String(i), title: '<img onerror=alert(1)>',
    url: `${url}/${i}`, contents, date: Date.UTC(2020, 8, 26) / 1000, image: i === 1 ? 'https://example.com/broken' : undefined })));
  expect(root.querySelectorAll('[role="button"]')).toHaveLength(4);
  const nativeEvents = root.querySelectorAll('.By7D93oEZkZtBeg23NDoR');
  expect(nativeEvents).toHaveLength(4);
  // Keep the full text; the mounted renderer truncates by visible lines, not characters.
  expect(nativeEvents[0].querySelector('.PartnerEventMediumImage_Summary')?.textContent).toBe(contents);
  expect(nativeEvents[0].querySelector(':scope > .Panel[role="button"]')?.className).toContain('_1HZy7BvOZuPT8feUwadL4W');
  const dayContents = root.querySelector('.AppActivityDay > div')!;
  // Steam has one outer Panel per announcement. Themes use these siblings to
  // round only the first/last card and draw separators between adjacent cards.
  expect(dayContents.children).toHaveLength(4);
  expect(dayContents.querySelectorAll(':scope > .Panel > .Event.Panel > .Panel > .PartnerEventMediumImage')).toHaveLength(4);
  expect(dayContents.querySelectorAll(':scope > .Panel:first-child > .Event')).toHaveLength(1);
  expect(dayContents.querySelectorAll(':scope > .Panel:last-child > .Event')).toHaveLength(1);
  const footers = dayContents.querySelectorAll(':scope > .Panel > .Event > .RatingBar');
  expect(footers).toHaveLength(4);
  for (const footer of footers) {
    expect(footer.getAttribute('aria-hidden')).toBe('true');
    expect(footer.querySelector('.LikeIcon')).not.toBeNull();
    expect(footer.querySelector('button, [role="button"], [tabindex]')).toBeNull();
    expect(footer.textContent).toBe('');
  }
  expect(nativeEvents[0].parentElement?.parentElement?.parentElement).not.toBe(nativeEvents[1].parentElement?.parentElement?.parentElement);
  let opened: { href: string; target: string; rel: string } | undefined;
  const captureLink = (event: Event) => {
    const target = event.target;
    if (target instanceof dom.window.HTMLAnchorElement) {
      opened = { href: target.href, target: target.target, rel: target.rel };
      event.preventDefault();
    }
  };
  document.addEventListener('click', captureLink, true);
  nativeEvents[0].querySelector<HTMLElement>('[role="button"]')!.click();
  document.removeEventListener('click', captureLink, true);
  expect(opened).toEqual({ href: `${url}/0`, target: '_blank', rel: 'noopener noreferrer' });
  expect(nativeEvents[0].querySelector('.MediumImageContainer')).toBeNull();
  expect(nativeEvents[1].querySelector('.MediumImageContainer')).not.toBeNull();
  expect(root.querySelectorAll('img')).toHaveLength(1);
  root.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
  expect(root.querySelectorAll('img')).toHaveLength(0);
  expect(root.querySelectorAll('.MediumImageContainer')).toHaveLength(0);
  expect(root.textContent).toContain('<img onerror=alert(1)>');
  expect(root.querySelectorAll('h4')).toHaveLength(1);
  expect(root.querySelector('h4')?.className).toContain('Reset');
  expect(root.querySelector('h4')?.textContent).toContain('2020');
});

test('activity dates follow Steam locale, relative days and year rules without merging years', () => {
  setSystemTime(new Date(2026, 8, 27, 12));
  const items = [new Date(2026, 8, 27), new Date(2026, 8, 26), new Date(2026, 8, 28),
    new Date(2026, 3, 28), new Date(2025, 3, 28), null].map((date, i) => ({
      gid: String(i), title: 'Update', url: `${url}/${i}`, contents: 'Text', date: date && date.getTime() / 1000,
    }));
  try {
    Object.assign(window, { LocalizationManager: { GetPreferredLocales: () => ['en-US'] } });
    const root = renderNewsFeed(document, items);
    expect(root.querySelectorAll('.AppActivityDay')).toHaveLength(6);
    expect(Array.from(root.querySelectorAll('h4'), heading => heading.textContent)).toEqual([
      'Today', 'Yesterday', 'Tomorrow', 'April 28', 'Apr 28, 2025',
    ]);
    Object.assign(window, { LocalizationManager: {
      GetPreferredLocales: () => ['de-DE'],
      m_mapTokens: new Map([['Time_Today', 'Heute'], ['Time_Yesterday', 'Gestern'], ['Time_Tomorrow', 'Morgen']]),
    } });
    expect(Array.from(renderNewsFeed(document, items).querySelectorAll('h4'), heading => heading.textContent)).toEqual([
      'Heute', 'Gestern', 'Morgen', '28. April', new Date(2025, 3, 28).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric' }),
    ]);
    setSystemTime(new Date(2026, 0, 1, 12));
    const previousYear = [{ ...items[0], date: new Date(2025, 11, 31).getTime() / 1000 }];
    expect(renderNewsFeed(document, previousYear).querySelector('h4')?.textContent).toContain('2025');
  } finally {
    setSystemTime();
    Object.assign(window, { LocalizationManager: undefined });
  }
});

test('plugin strings follow the Steam client language and fall back to English', async () => {
  const original = globalThis.SteamClient;
  let language = 'german';
  try {
    Object.assign(globalThis, { SteamClient: { ...original, Settings: { GetCurrentLanguage: async () => language } } });
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Externe Datenquellen');
    expect(renderNewsFeed(document, []).textContent).toBe('Keine Nachrichten in diesem Feed.');

    language = 'french';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Sources de données externes');

    language = 'unsupported-language';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('External Data Sources');
    expect(renderNewsFeed(document, []).textContent).toBe('No news in this feed.');
  } finally {
    Object.assign(globalThis, { SteamClient: original });
    await initI18n();
  }
});

function nativeLayout(props: LayoutProps) {
  return h('main', { className: 'ColumnContainer' },
    h('aside', null, 'Notes', h('div', { 'data-nsp': true }, 'Playtime')),
    h('section', { className: 'LeftColumn' }, [
      h('div', { key: 'shortcut', role: 'region', className: 'AppDetailsSection', id: 'notice' },
        h('div', { className: '_5uvIN6jXDXzzck59F-nhv Body _1TGl52GwsFQg3CXUYvThP-' },
          'Some detailed information on Test is unavailable because it is a non-Steam game or mod. ' +
          'Steam will still manage launching the game for you and in most cases the in-game overlay will be available.')),
      props.setSections.has('offline') && h('div', { key: 'offline' }, 'Offline'),
      props.setSections.has('activityrollup') && h(NativeSeek, { key: 'rollup', name: 'activityrollup', parent: props.parentComponent }, h('div', { id: 'native-rollup' }, 'Native rollup')),
      props.setSections.has('activity') && h(NativeSeek, { key: 'activity', name: 'activity', parent: props.parentComponent }, h('div', { id: 'native-activity' }, 'Native activity')),
    ]));
}

const NativeSeek: SeekTarget = ({ name, parent, children }) => h('div', {
  className: 'SeekTarget', ref: (element: HTMLDivElement | null) => parent.RegisterSection(name, element),
}, children);
const propsFor = (appid = Number(id)): LayoutProps => ({
  overview: { appid }, setSections: new Set(['nonsteam']), parentComponent: { RegisterSection: () => {} },
});

test('React layout keeps the native notice hidden after activity targets and preserves Playtime', async () => {
  document.body.replaceChildren();
  const sources = new Sources();
  sources.values[id] = url;
  const sections = new Map<string, HTMLElement | null>();
  const props = propsFor();
  props.parentComponent.RegisterSection = (name, element) => { sections.set(name, element); };
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, sources);
  // Model a theme that inspects each newly committed column container only once.
  const seen = new WeakSet<Element>();
  const discoveries: number[] = [];
  function ThemeProbe() {
    useLayoutEffect(() => {
      const column = document.querySelector('.ColumnContainer')!;
      if (!seen.has(column)) {
        seen.add(column);
        discoveries.push(column.querySelectorAll('.LeftColumn > .SeekTarget').length);
      }
    });
    return h(Layout, props);
  }
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(ThemeProbe)); await tick(); });
    expect(discoveries).toEqual([2]);
    expect(sections.get('activityrollup')).toBe(document.querySelector('.LeftColumn > .SeekTarget:nth-of-type(1)'));
    expect(sections.get('activity')).toBe(document.querySelector('.LeftColumn > .SeekTarget:nth-of-type(2)'));
    expect(sections.get('activity')).toBe(document.querySelector('[data-external-news]')?.parentElement);
    expect(document.getElementById('native-rollup')).toBeNull();
    expect(document.getElementById('native-activity')).toBeNull();
    expect(document.querySelectorAll('[data-external-news]')).toHaveLength(1);
    expect(document.querySelector('[data-external-news]')?.textContent).toContain('Update');
    expect(document.querySelector('[data-external-news]')?.className).toContain(APP_SECTION_CLASSES_FALLBACK.AppDetailsSection);
    expect(document.querySelector('[data-external-news] .Body > .PostTextEntry')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-external-news] .PostTextEntry textarea')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-external-news] > h2')?.style.position).toBe('');
    expect(document.getElementById('notice')?.closest('[hidden]')).toBe(document.querySelector('.LeftColumn > :last-child'));
    expect(document.querySelector('html:has(._5uvIN6jXDXzzck59F-nhv):has(._1TGl52GwsFQg3CXUYvThP-)')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-nsp]')!.style.display).toBe('');
    const column = document.querySelector('.ColumnContainer');
    await act(async () => { await sources.save(id, 'https://example.com/changed'); });
    expect(document.querySelector('.ColumnContainer')).toBe(column);
    await act(async () => { await sources.clear(id); });
    expect(document.querySelector('.ColumnContainer')).not.toBe(column);
    expect(document.querySelector('[data-external-news]')).toBeNull();
    expect(document.getElementById('notice')?.textContent).toContain('Some detailed information');
    expect(document.getElementById('notice')?.closest('[hidden]')).toBeNull();
    expect(sections.get('activity')).toBeNull();
    expect(document.querySelector('[data-nsp]')?.textContent).toBe('Playtime');
    await act(async () => { await sources.save(id, url); });
    expect(document.querySelectorAll('.LeftColumn > .SeekTarget')).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
});

test('React news ignores stale results after navigation and retries failed requests', async () => {
  document.body.replaceChildren();
  const sources = new Sources();
  sources.values[id] = url;
  sources.values[otherId] = 'https://other.test/rss';
  let resolve!: (items: never[]) => void;
  let fail = true;
  sources.cache.get = (appId: string) => {
    if (appId === id) return new Promise(done => { resolve = done; });
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve([]);
  };
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, sources);
  const root = createRoot(document.body);
  try {
    await act(async () => root.render(h(Layout, propsFor())));
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading news...');
    await act(async () => root.render(h(Layout, propsFor(Number(otherId)))));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('offline');
    await act(async () => { resolve([]); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('offline');
    fail = false;
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(document.querySelector('[data-external-news]')?.textContent).toContain('No news in this feed.');
    await act(async () => root.render(h(Layout, propsFor(570))));
    expect(document.querySelector('[data-external-news]')).toBeNull();
    expect(document.querySelector('.SeekTarget')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
