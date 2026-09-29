import { beforeAll, expect, mock, test } from 'bun:test';
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
const { NewsSection } = await import('../frontend/components/news-section');
const { registerProperties, PLUGIN_PROPERTIES_ROUTE: NEWS_ROUTE } = await import('../frontend/properties');
const { initI18n, getPluginI18nString } = await import('../frontend/i18n');

const native = {
  Section: ({ appId, children, action }: { appId: string; children: import('react').ReactNode; action?: import('react').ReactNode }) =>
    h('div', { 'data-external-news': appId }, h('div', { 'data-native-action': true }, action), children),
  Feed: ({ items }: { appId: string; items: import('../frontend/feed').NewsItem[] }) => h('div', null, items.map(item => h('div', { key: item.gid }, item.title))),
};

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

test('plugin strings follow the Steam client language and fall back to English', async () => {
  const original = globalThis.SteamClient;
  let language = 'german';
  try {
    Object.assign(globalThis, { SteamClient: { ...original, Settings: { GetCurrentLanguage: async () => language } } });
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Externe Datenquellen');
    expect(getPluginI18nString('noNews')).toBe('Keine Nachrichten in diesem Feed.');

    language = 'french';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('Sources de données externes');

    language = 'unsupported-language';
    await initI18n();
    expect(getPluginI18nString('externalDataSources')).toBe('External Data Sources');
    expect(getPluginI18nString('noNews')).toBe('No news in this feed.');
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
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, sources, native);
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
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, sources, native);
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

test('Activity refresh bypasses the feed cache and keeps cards visible while loading', async () => {
  document.body.replaceChildren();
  const sources = new Sources();
  const fetches: string[] = [];
  let finishRefresh!: (value: string) => void;
  const refreshRequest = new Promise<string>(resolve => { finishRefresh = resolve; });
  const response = (title: string) => JSON.stringify({ url,
    xml: `<rss><channel><item><title>${title}</title><link>https://example.com/article</link></item></channel></rss>` });
  const api = (globalThis as any).backend;
  const original = api.fetchFeed;
  api.fetchFeed = (appId: string) => {
    fetches.push(appId);
    return fetches.length === 1 ? Promise.resolve(response('First article')) : refreshRequest;
  };
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(NewsSection, { appId: id, url, sources, revision: 0, native })); await tick(); });
    expect(document.querySelector('[data-external-news]')?.textContent).toContain('First article');
    expect(fetches).toEqual([id]);
    const action = document.querySelector<HTMLElement>('[data-native-action] [role="button"]');
    expect(action?.className).toBe('_1EC1xjjUGqI7fqX6PVzJA3 Panel');
    expect(action?.querySelector('span')?.textContent).toBe('View Latest News');
    const firstCard = document.querySelector('[data-external-news] > div:last-child > div');
    expect(firstCard).not.toBeNull();

    await act(async () => action!.click());
    expect(fetches).toEqual([id, id]);
    expect(document.querySelector('[data-external-news]')?.textContent).toContain('First article');
    expect(document.querySelector('[data-external-news] > div:last-child > div')).toBe(firstCard);
    expect(action?.getAttribute('aria-disabled')).toBe('true');
    expect(action?.tabIndex).toBe(-1);

    await act(async () => { finishRefresh(response('Updated article')); await tick(); });
    expect(document.querySelector('[data-external-news]')?.textContent).toContain('Updated article');
    expect(document.querySelector('[data-external-news]')?.textContent).not.toContain('First article');
    expect(action?.getAttribute('aria-disabled')).toBe('false');
    expect(action?.tabIndex).toBe(0);
  } finally {
    await act(async () => root.unmount());
    api.fetchFeed = original;
  }
});
