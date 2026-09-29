import { beforeEach, expect, test } from 'bun:test';
import { act, createElement as h, forwardRef } from 'react';
import { createRoot } from 'react-dom/client';
import { dom, installBackend, FeedManager, ReleaseDateManager, ExternalNewsSource, PluginConfiguration, registerProperties, id, otherId, url, tick, runtime } from './helpers/ui-runtime';

beforeEach(installBackend);

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
    const dropdownSection = document.querySelectorAll<HTMLElement>('.DialogControlsSection')[1];
    const dropdown = dropdownSection.querySelector<HTMLSelectElement>('select')!;
    const row = section.querySelector('[data-native-toggle]')!;
    const toggle = row.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    expect(section.style.width).toBe('100%');
    expect(dropdownSection.style.width).toBe('100%');
    expect(dropdownSection.querySelector('span')?.textContent).toBe("Max Items in What's New");
    expect(dropdownSection.querySelector('small')?.textContent).toBe("Select how many items from this feed can appear in What's New");
    expect([...dropdown.options].map(option => option.textContent)).toEqual(['Unlimited', '1', '2', '3', '4', '5']);
    expect(dropdown.value).toBe('3');
    expect(row.querySelector('span')?.textContent).toBe("Show Feed in What's New");
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => { toggle.click(); await tick(); });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(runtime.shown[id]).toBe(false);
    await act(async () => { dropdown.value = '0'; dropdown.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await tick(); });
    expect(runtime.maxed[id]).toBe(0);
    expect(dropdown.value).toBe('0');
    expect(runtime.saved[id]).toBe(url);
    expect(feedSaves).toBe(0);
    expect(fetches).toBe(0);
    const restart = new FeedManager();
    await restart.load();
    expect(restart.showFeedInWhatsNew[id]).toBe(false);
    expect(restart.maxItemsFromFeedInWhatsNew[id]).toBe(0);
    restart.dispose();

    await act(async () => { root.render(h(ExternalNewsSource, { key: otherId, appId: otherId, manager: feedManager })); await tick(); });
    const emptyFeedToggle = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    const emptyFeedDropdown = document.querySelector<HTMLSelectElement>('select')!;
    expect(emptyFeedToggle.getAttribute('aria-checked')).toBe('true');
    expect(emptyFeedDropdown.value).toBe('3');
    await act(async () => { emptyFeedToggle.click(); await tick(); });
    await act(async () => { emptyFeedDropdown.value = '5'; emptyFeedDropdown.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await tick(); });
    expect(runtime.saved[otherId]).toBeUndefined();
    expect(runtime.shown[otherId]).toBe(false);
    expect(runtime.maxed[otherId]).toBe(5);
    const flagOnlyRestart = new FeedManager();
    await flagOnlyRestart.load();
    expect(flagOnlyRestart.values[otherId]).toBeUndefined();
    expect(flagOnlyRestart.showFeedInWhatsNew[otherId]).toBe(false);
    expect(flagOnlyRestart.maxItemsFromFeedInWhatsNew[otherId]).toBe(5);
    flagOnlyRestart.dispose();

    backend.setShowFeedInWhatsNew = async () => { throw new Error('disk error'); };
    await act(async () => { emptyFeedToggle.click(); await tick(); });
    expect(emptyFeedToggle.getAttribute('aria-checked')).toBe('false');
    expect(runtime.shown[otherId]).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('disk error');
    backend.setMaxItemsFromFeedInWhatsNew = async () => { throw new Error('disk error'); };
    await act(async () => { emptyFeedDropdown.value = '4'; emptyFeedDropdown.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await tick(); });
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
    await act(async () => { section.value = 'general'; section.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    expect(document.body.textContent).toContain('Right-click a non-Steam game');
    expect(fields[0].closest<HTMLElement>('.DialogBody')?.style.display).toBe('none');
  } finally {
    await act(async () => root.unmount());
    feedManager.dispose();
  }
});


test('properties tab is added through Steam settings renderer without patching Array.map', async () => {
  const feedManager = new FeedManager();
  const releaseDates = new ReleaseDateManager();
  const pages = [{ title: 'Shortcut', identifier: `/app/${id}/properties/shortcut`, content: null },
    { title: 'Playtime', identifier: `/app/${id}/properties/playtime`, content: null }];
  const Settings = forwardRef<unknown, { pages: typeof pages; page: string; onPageRequested?: (page: string) => void }>(function Settings(props, _ref) {
    return h('div', { 'data-steam-settings': 'PagedSettingDialog_ContentColumn' },
      ...props.pages.map(page => h('button', { key: page.identifier, onClick: () => props.onPageRequested?.(page.identifier) }, page.title)),
      h('span', { 'data-active-page': true }, props.page));
  });
  const settingsType = Settings as typeof Settings & { render: unknown };
  const originalRender = settingsType.render;
  runtime.nativeModuleCandidates = [Settings];
  const originalMap = Array.prototype.map;
  const root = createRoot(document.body);
  const unregister = registerProperties(feedManager, releaseDates);
  const requested: string[] = [];
  try {
    await act(async () => root.render(h(Settings, { pages, page: pages[0].identifier, onPageRequested: page => requested.push(page) })));
    expect(Array.prototype.map).toBe(originalMap);
    expect(pages).toHaveLength(2);
    expect([...document.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Shortcut', 'Playtime', 'External Data Sources']);
    await act(async () => (document.querySelectorAll('button')[2] as HTMLButtonElement).click());
    expect(document.querySelector('[data-active-page]')?.textContent).toBe(`/app/${id}/properties/external-data-sources`);
    expect(requested).toEqual([`/app/${id}/properties/external-data-sources`]);
    await act(async () => (document.querySelectorAll('button')[0] as HTMLButtonElement).click());
    expect(document.querySelector('[data-active-page]')?.textContent).toBe(pages[0].identifier);
    await act(async () => root.render(h(Settings, { pages: [{ ...pages[0], identifier: '/app/570/properties/shortcut' }], page: '/app/570/properties/shortcut' })));
    expect(document.querySelectorAll('button')).toHaveLength(1);
    await act(async () => root.render(h(Settings, { pages: [...pages, { title: 'External Data Sources', identifier: `/app/${id}/properties/external-data-sources`, content: null }], page: pages[0].identifier })));
    expect(document.querySelectorAll('button')).toHaveLength(3);
  } finally {
    unregister();
    expect(settingsType.render).toBe(originalRender);
    await act(async () => root.unmount());
    runtime.nativeModuleCandidates = [];
    feedManager.dispose();
    releaseDates.dispose();
  }
});

