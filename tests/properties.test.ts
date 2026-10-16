import { beforeEach, expect, test } from 'bun:test';
import { act, createContext, createElement as h, forwardRef, useEffect, useState } from 'react';
import { createRoot } from './helpers/ui-runtime';
import {
  dom, installBackend, FeedManager, GameDetailsManager, ExternalNewsSource, PluginConfiguration, registerProperties,
  id, otherId, url, tick, runtime, selectOption
} from './helpers/ui-runtime';

beforeEach(installBackend);

test('properties can be enabled and disabled while native settings with hooks are mounted', async () => {
  const feedManager = new FeedManager();
  const gameDetails = new GameDetailsManager();
  const pages = [{ title: 'Shortcut', identifier: `/app/${id}/properties/shortcut`, content: null }];
  let activeEffects = 0;
  type SettingsProps = { pages: typeof pages; onPageRequested?: (page: string) => void };
  const Settings = forwardRef<unknown, SettingsProps>(function Settings(props, _ref) {
    const [label] = useState('native');
    const [count, setCount] = useState(0);
    useEffect(() => {
      activeEffects++;
      return () => { activeEffects--; };
    }, []);
    return h('div', { className: 'PagedSettingDialog_ContentColumn' },
      h('button', { 'data-native-counter': true, onClick: () => setCount(count + 1) }, `${label}:${count}`),
      ...props.pages.map(page =>
        h('button', { key: page.identifier, onClick: () => props.onPageRequested?.(page.identifier) }, page.title)));
  });
  runtime.nativeModuleCandidates = [Settings];
  const root = createRoot(document.body);
  let unregister: (() => void) | undefined;
  try {
    await act(async () => root.render(h(Settings, { pages })));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-native-counter]')!.click());
    expect(activeEffects).toBe(1);
    unregister = registerProperties(feedManager, gameDetails);
    await act(async () => root.render(h(Settings, { pages })));
    expect(document.body.textContent).toContain('External Data Sources');
    expect(document.querySelector('[data-native-counter]')?.textContent).toBe('native:1');
    expect(activeEffects).toBe(1);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-native-counter]')!.click());
    expect(document.querySelector('[data-native-counter]')?.textContent).toBe('native:2');
    unregister();
    unregister = undefined;
    await act(async () => root.render(h(Settings, { pages })));
    expect(document.body.textContent).not.toContain('External Data Sources');
    expect(activeEffects).toBe(1);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-native-counter]')!.click());
    expect(document.querySelector('[data-native-counter]')?.textContent).toBe('native:3');
  } finally {
    unregister?.();
    await act(async () => root.unmount());
    expect(activeEffects).toBe(0);
    runtime.nativeModuleCandidates = [];
    feedManager.dispose();
    gameDetails.dispose();
  }
});

test('properties controls save immediately without saving an unsaved feed URL', async () => {
  document.body.replaceChildren();
  runtime.saved = { [id]: url };
  runtime.shown = {};
  runtime.maxed = {};
  const feedManager = new FeedManager();
  const root = createRoot(document.body);
  const originalFetch = backend.fetchFeed;
  const originalSave = backend.saveFeedSource;
  const originalToggle = backend.setShowFeedInWhatsNew;
  const originalLimit = backend.setMaxItemsFromFeedInWhatsNew;
  let fetches = 0;
  let feedSaves = 0;
  backend.fetchFeed = async appId => { fetches++; return originalFetch(appId); };
  backend.saveFeedSource = async (...args) => { feedSaves++; return originalSave(...args); };
  try {
    await act(async () => { root.render(h(ExternalNewsSource, { appId: id, manager: feedManager })); await tick(); });
    const section = document.querySelector<HTMLElement>('.DialogControlsSection')!;
    expect(document.querySelectorAll('.DialogControlsSection')).toHaveLength(1);
    const dropdownSection = section.querySelector<HTMLElement>('[data-native-dropdown]')!;
    const dropdown = dropdownSection.querySelector<HTMLSelectElement>('select')!;
    const toggle = section.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    const row = toggle.closest('.Field')!;
    expect(section.style.width).toBe('');
    expect(dropdownSection.style.width).toBe('');
    expect(dropdownSection.querySelector('span')?.textContent).toBe("Max Items in What's New");
    expect(dropdownSection.querySelector('small')?.textContent)
      .toBe("Select how many items from this feed can appear in What's New");
    expect([...dropdown.options].map(option => option.textContent)).toEqual(['Unlimited', '1', '2', '3', '4', '5']);
    expect(dropdown.value).toBe('3');
    expect(row.textContent).toContain("Show Feed in What's New");
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => { toggle.click(); await tick(); });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(runtime.shown[id]).toBe(false);
    await selectOption(dropdown, '0');
    expect(runtime.maxed[id]).toBe(0);
    expect(dropdown.value).toBe('0');
    expect(runtime.saved[id]).toBe(url);
    expect(feedSaves).toBe(0);
    expect(fetches).toBe(0);
    const restart = new FeedManager();
    await restart.load();
    expect(restart.sources[id]?.showFeedInWhatsNew).toBe(false);
    expect(restart.sources[id]?.maxItemsFromFeedInWhatsNew).toBe(0);
    restart.dispose();

    await act(async () => {
      root.render(h(ExternalNewsSource, { key: otherId, appId: otherId, manager: feedManager }));
      await tick();
    });
    const emptyFeedToggle = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    const emptyFeedDropdown = document.querySelector<HTMLSelectElement>('select')!;
    expect(emptyFeedToggle.getAttribute('aria-checked')).toBe('true');
    expect(emptyFeedDropdown.value).toBe('3');
    await act(async () => { emptyFeedToggle.click(); await tick(); });
    await selectOption(emptyFeedDropdown, '5');
    expect(runtime.saved[otherId]).toBeUndefined();
    expect(runtime.shown[otherId]).toBe(false);
    expect(runtime.maxed[otherId]).toBe(5);
    const flagOnlyRestart = new FeedManager();
    await flagOnlyRestart.load();
    expect(flagOnlyRestart.sources[otherId]?.url).toBe('');
    expect(flagOnlyRestart.sources[otherId]?.showFeedInWhatsNew).toBe(false);
    expect(flagOnlyRestart.sources[otherId]?.maxItemsFromFeedInWhatsNew).toBe(5);
    flagOnlyRestart.dispose();

    backend.setShowFeedInWhatsNew = async () => { throw new Error('disk error'); };
    await act(async () => { emptyFeedToggle.click(); await tick(); });
    expect(emptyFeedToggle.getAttribute('aria-checked')).toBe('false');
    expect(runtime.shown[otherId]).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not save feed source.');
    backend.setMaxItemsFromFeedInWhatsNew = async () => { throw new Error('disk error'); };
    await selectOption(emptyFeedDropdown, '4');
    expect(runtime.maxed[otherId]).toBe(5);
    expect(emptyFeedDropdown.value).toBe('5');
  } finally {
    await act(async () => root.unmount());
    feedManager.dispose();
    backend.fetchFeed = originalFetch;
    backend.saveFeedSource = originalSave;
    backend.setShowFeedInWhatsNew = originalToggle;
    backend.setMaxItemsFromFeedInWhatsNew = originalLimit;
  }
});
test('feed URL saves valid input without buttons and clears through the clear action', async () => {
  document.body.replaceChildren();
  runtime.saved = { [id]: url };
  runtime.shown = {};
  runtime.maxed = {};
  const feedManager = new FeedManager();
  const root = createRoot(document.body);
  const input = () => document.querySelector<HTMLInputElement>('input[data-steam-text-field]')!;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
  });
  const blur = async () => act(async () => {
    input().dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    await tick();
  });
  try {
    await act(async () => { root.render(h(ExternalNewsSource, { appId: id, manager: feedManager })); await tick(); });
    expect(document.querySelectorAll('.DialogButton')).toHaveLength(0);
    expect(input().value).toBe(url);

    await type('not a url');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter an HTTP or HTTPS feed URL.');
    expect(input().closest('.Field')?.nextElementSibling?.contains(document.querySelector('[role="alert"]')))
      .toBe(true);
    await blur();
    expect(runtime.saved[id]).toBe(url);

    // Hosts without a TLD are valid feed URLs, unlike Steam's mustBeURL check.
    await type('http://localhost:8080/feed');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // Themes such as Adwaita stretch inputs over their row, so it holds nothing but label and input.
    expect(input().closest('.Field')?.textContent).toBe('Feed URL');
    await blur();
    expect(runtime.saved[id]).toBe('http://localhost:8080/feed');
    expect(input().disabled).toBe(false);

    await type('https://example.com/delayed');
    expect(runtime.saved[id]).toBe('http://localhost:8080/feed');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); await tick(); });
    expect(runtime.saved[id]).toBe('https://example.com/delayed');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Feed settings saved.');

    const toggle = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    const dropdown = document.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { toggle.click(); await tick(); });
    await selectOption(dropdown, '5');
    expect(runtime.shown[id]).toBe(false);

    await act(async () => { document.querySelector<HTMLElement>('.DialogInput_ClearAction')!.click(); await tick(); });
    expect(input().value).toBe('');
    expect(runtime.saved[id]).toBeUndefined();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.DialogInput_ClearAction')).toBeNull();
    // Clearing removes the saved options, so the controls must show the defaults the next save uses.
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(dropdown.value).toBe('3');

    // Closing the page saves a URL that is still waiting for the delay.
    await type(url);
    await act(async () => { root.unmount(); await tick(); });
    expect(runtime.saved[id]).toBe(url);
    expect(runtime.shown[id]).toBe(true);
    expect(feedManager.sources[id]?.maxItemsFromFeedInWhatsNew).toBe(3);
  } finally {
    feedManager.dispose();
  }
});

test('plugin configuration exposes global numeric controls', async () => {
  document.body.replaceChildren();
  const feedManager = new FeedManager();
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(PluginConfiguration, { feedManager: feedManager })); await tick(); });
    const fields = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect([...fields].map(field => field.value)).toEqual(['10', '2']);
    expect(fields[0].min).toBe('10');
    expect(fields[1].min).toBe('1');
    expect(document.body.textContent).toContain('Feed Refresh Interval');
    expect(document.body.textContent).toContain('Simultaneous Feed Fetches');
    expect(document.querySelectorAll('.Field.Background.Panel')).toHaveLength(2);
    expect(fields[0].closest('.Field')?.textContent).toContain('Feed Refresh Interval');
    expect(fields[0].getAttribute('aria-label')).toBe('Feed Refresh Interval');
    expect(fields[0].hasAttribute('data-steam-text-field')).toBe(true);
    expect(fields[0].closest('.Field')?.textContent).toContain('Minutes between updates');
    const section = document.querySelector<HTMLSelectElement>('[data-native-dropdown]')!;
    expect([...section.options].map(option => option.textContent)).toEqual(['General', 'Feed Settings']);
    await act(async () => {
      section.value = 'general';
      section.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('Right-click a non-Steam game');
    expect(window.getComputedStyle(fields[0].closest<HTMLElement>('.DialogBody')!).display).toBe('none');
  } finally {
    await act(async () => root.unmount());
    feedManager.dispose();
  }
});

test.each([
  ['React Router context found by name', 'Router'],
  ['unnamed routing context found during render', undefined],
])('properties tab joins the Steam settings renderer without patching Array.map (%s)', async (_case, displayName) => {
  const feedManager = new FeedManager();
  const gameDetails = new GameDetailsManager();
  const pages = [{ title: 'Shortcut', identifier: `/app/${id}/properties/shortcut`, content: null },
    { title: 'Playtime', identifier: `/app/${id}/properties/playtime`, content: null }];
  type SettingsProps = { pages: typeof pages; page: string; onPageRequested?: (page: string) => void };
  const Settings = forwardRef<unknown, SettingsProps>(function Settings(props, _ref) {
    return h('div', { 'data-steam-settings': 'PagedSettingDialog_ContentColumn' },
      ...props.pages.map(page =>
        h('button', { key: page.identifier, onClick: () => props.onPageRequested?.(page.identifier) }, page.title)),
      h('span', { 'data-active-page': true }, props.page));
  });
  const settingsType = Settings as typeof Settings & { render: unknown };
  const originalRender = settingsType.render;
  const RouterContext = createContext<{ location: { pathname: string } } | null>(null);
  RouterContext.displayName = displayName;
  runtime.nativeModuleCandidates = [Settings, RouterContext];
  const originalMap = Array.prototype.map;
  const root = createRoot(document.body);
  const unregister = registerProperties(feedManager, gameDetails);
  const requested: string[] = [];
  const renderRoute = (pathname: string) => {
    // The real adapter maps only native routes and falls back to its first page.
    const nativePage = pages.find(page => page.identifier === pathname) || pages[0];
    root.render(h(RouterContext.Provider, { value: { location: { pathname } } },
      h(Settings, { pages, page: nativePage.identifier, onPageRequested: requestPage })));
  };
  const requestPage = (page: string) => {
    requested.push(page);
    renderRoute(page);
  };
  try {
    await act(async () => renderRoute(pages[0].identifier));
    expect(Array.prototype.map).toBe(originalMap);
    expect(pages).toHaveLength(2);
    expect([...document.querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['Shortcut', 'Playtime', 'External Data Sources']);
    await act(async () => (document.querySelectorAll('button')[2] as HTMLButtonElement).click());
    expect(document.querySelector('[data-active-page]')?.textContent)
      .toBe(`/app/${id}/properties/external-data-sources`);
    expect(requested).toEqual([`/app/${id}/properties/external-data-sources`]);
    await act(async () => (document.querySelectorAll('button')[0] as HTMLButtonElement).click());
    expect(document.querySelector('[data-active-page]')?.textContent).toBe(pages[0].identifier);
    const steamApp = '/app/570/properties/shortcut';
    await act(async () => root.render(h(Settings, { pages: [{ ...pages[0], identifier: steamApp }], page: steamApp })));
    expect(document.querySelectorAll('button')).toHaveLength(1);
    const ownPage = {
      title: 'External Data Sources', identifier: `/app/${id}/properties/external-data-sources`, content: null,
    };
    await act(async () => root.render(h(Settings, { pages: [...pages, ownPage], page: pages[0].identifier })));
    expect(document.querySelectorAll('button')).toHaveLength(3);
  } finally {
    unregister();
    expect(settingsType.render).toBe(originalRender);
    await act(async () => root.unmount());
    runtime.nativeModuleCandidates = [];
    feedManager.dispose();
    gameDetails.dispose();
  }
});
