import { beforeEach, expect, test } from 'bun:test';
import { act, Component, createElement as h, createRef } from 'react';
import { createRoot } from './helpers/ui-runtime';
import { localTagId } from '../frontend/steam/store-tags';
import {
  installBackend, GameDetailsManager, daysInMonth, isCalendarDate, registerGameDetails, ExternalGameDetails, id, tick,
  runtime, typeText, selectOption
} from './helpers/ui-runtime';

beforeEach(installBackend);

const CUSTOM_TAG = localTagId('Custom');
const BINDINGS = ['eager', 'lazy'];

/** Saved details of the configured shortcut, as a fresh object for each test. */
const savedShortcutDetails = () => ({
  releaseDate: '2024-02-29', addedToLibraryDate: '2023-01-15', developer: ['Studio'], publisher: ['Publisher'],
});

/** Clicks the button with the given accessible label and lets React settle. */
const clickLabeled = (label: string) => act(async () => {
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  await tick();
});

/** Dispatches a keydown event for the given key. */
const pressKey = (target: EventTarget, key: string) => act(async () => {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
});

test('name normalization tolerates legacy stored strings but rejects invalid writes before persistence', async () => {
  const originalGet = backend.getGameDetails;
  const originalSet = backend.setGameDetail;
  let writes = 0;
  backend.getGameDetails = async () => ({
    [id]: { developer: ' Studio ', publisher: [19], tags: [19, ' Custom ', '', 'Custom', 19] },
  }) as unknown as string;
  backend.setGameDetail = async (...args) => { writes++; return originalSet(...args); };
  const manager = new GameDetailsManager();
  try {
    await manager.load();
    expect(manager.details[id]).toEqual({ developer: ['Studio'], tags: [19, 'Custom'] });
    await expect(manager.set(id, 'developer', [19] as unknown as string[])).rejects.toThrow();
    await expect(manager.set(id, 'tags', [-1])).rejects.toThrow();
    expect(writes).toBe(0);
    await manager.set(id, 'developer', [' Studio ', '', 'Studio']);
    expect(manager.details[id].developer).toEqual(['Studio']);
    await manager.set(id, 'developer', []);
    expect(manager.details[id]).toEqual({ tags: [19, 'Custom'] });
  } finally {
    backend.getGameDetails = originalGet;
    backend.setGameDetail = originalSet;
    manager.dispose();
  }
});

test('release date dropdowns save valid changes and clear on an empty selection', async () => {
  document.body.replaceChildren();
  runtime.savedDetails = { [id]: savedShortcutDetails() };
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    const dropdowns = () => [...document.querySelectorAll<HTMLSelectElement>('select[data-native-dropdown]')];
    expect(dropdowns()).toHaveLength(6);
    expect(document.querySelector('.Field.Background.Panel > div')?.textContent).toBe('Release Date');
    expect(dropdowns().slice(0, 3).map(dropdown => dropdown.getAttribute('aria-label')))
      .toEqual(['Release Date: Year', 'Release Date: Month', 'Release Date: Day']);
    expect(document.body.textContent).toContain('External Game Details');
    expect(document.body.textContent).toContain('Added to Library');
    expect(dropdowns().slice(3).map(dropdown => dropdown.value)).toEqual(['2023', '1', '15']);
    const maxYear = new Date().getFullYear() + 1;
    expect(dropdowns()[0].options).toHaveLength(maxYear - 1960 + 2);
    expect(dropdowns()[0].options[1].value).toBe(String(maxYear));
    expect(dropdowns()[0].options[dropdowns()[0].options.length - 1].value).toBe('1960');
    expect(dropdowns()[1].options).toHaveLength(13);
    expect(dropdowns()[2].options).toHaveLength(30);
    expect(dropdowns()[2].value).toBe('29');
    expect(dropdowns()[2].options[1].textContent).toBe('01');
    expect(dropdowns()[2].options[9].textContent).toBe('09');
    expect(dropdowns()[2].options[10].textContent).toBe('10');
    expect(document.querySelectorAll('.DialogButton')).toHaveLength(0);
    // Five settings rows plus a row of saved values for each of the two filled lists.
    expect(document.querySelectorAll('.Field.Background.Panel')).toHaveLength(7);
    expect(document.querySelector('.DialogControlsSectionHeader')?.textContent).toBe('External Game Details');
    expect(document.querySelector('.DialogSubHeader')).toBeNull();
    const developerInput = document.querySelector('input[aria-label="Developer"]')!;
    // Themes such as Adwaita stretch inputs over their row, so a row holds nothing but label and input.
    const developerRow = developerInput.closest('.Field')!;
    expect(developerRow.querySelectorAll('button, ul, .FieldDescription')).toHaveLength(0);
    expect(developerInput.closest('label')).toBeNull();
    expect(document.querySelector('.DialogInput_CopyAction')).toBeNull();
    expect(developerRow.nextElementSibling?.querySelector('ul[aria-label="Developer"]')).not.toBeNull();
    expect(developerInput.getAttribute('style')).toBeNull();
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();

    await selectOption(dropdowns()[0], '2025');
    expect(dropdowns()[2].options).toHaveLength(29);
    expect(dropdowns()[2].value).toBe('28');
    expect(runtime.savedDetails[id].releaseDate).toBe('2025-02-28');
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();

    await selectOption(dropdowns()[1], '4');
    expect(dropdowns()[2].options).toHaveLength(31);
    expect(runtime.savedDetails[id].releaseDate).toBe('2025-04-28');
    expect(manager.details[id]).toEqual(runtime.savedDetails[id]);
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();
    await selectOption(dropdowns()[2], '0');
    expect(runtime.savedDetails[id].releaseDate).toBeUndefined();
    expect(dropdowns().slice(0, 3).map(dropdown => dropdown.value)).toEqual(['0', '0', '0']);
    expect(dropdowns().slice(3).map(dropdown => dropdown.value)).toEqual(['2023', '1', '15']);
    expect(runtime.savedDetails[id].developer).toEqual(['Studio']);
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();
    expect(dropdowns().slice(0, 3).map(dropdown => dropdown.selectedOptions[0].textContent))
      .toEqual(['----', '--------', '--']);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2025-02-29')).toBe(false);
    expect(isCalendarDate('1959-12-31')).toBe(false);
    expect(isCalendarDate('1960-01-01')).toBe(true);
    expect(isCalendarDate(`${maxYear + 1}-01-01`)).toBe(false);
    expect(daysInMonth(2025, 4)).toBe(30);
  } finally {
    await act(async () => root.unmount());
    manager.dispose();
  }
});

test('failed automatic release-date writes keep the saved selection visible', async () => {
  document.body.replaceChildren();
  runtime.savedDetails = { [id]: savedShortcutDetails() };
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  const originalSet = backend.setGameDetail;
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    const dropdowns = () => [...document.querySelectorAll<HTMLSelectElement>('select[data-native-dropdown]')];
    backend.setGameDetail = async () => false;
    await selectOption(dropdowns()[0], '2025');
    expect(dropdowns().slice(0, 3).map(dropdown => dropdown.value)).toEqual(['2024', '2', '29']);
    expect(runtime.savedDetails[id].releaseDate).toBe('2024-02-29');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not');

    await selectOption(dropdowns()[1], '0');
    expect(dropdowns().slice(0, 3).map(dropdown => dropdown.value)).toEqual(['2024', '2', '29']);
    expect(runtime.savedDetails[id].releaseDate).toBe('2024-02-29');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not');
  } finally {
    backend.setGameDetail = originalSet;
    await act(async () => root.unmount());
    manager.dispose();
  }
});

test('configured release dates survive Steam overview updates and restore native dates', async () => {
  runtime.savedDetails = { [id]: { releaseDate: '2026-10-01', addedToLibraryDate: '2024-02-13' } };
  const manager = new GameDetailsManager(); await manager.load();
  class Overview {
    __cachedReleaseYearString?: string;
    minutes_playtime_forever = 0;
    rt_purchased_time = 100;
    m_setStoreTags = new Set([5]);
    m_setStoreCategories = new Set([99]);
    GetStoreTags() { return this.m_setStoreTags; }
    BHasStoreCategory(category: number) { return this.m_setStoreCategories.has(category); }
    constructor(public appid = Number(id), public rt_original_release_date = 0) {}
    GetCanonicalReleaseDate() { return this.rt_original_release_date; }
    GetReleaseYearString() {
      return this.__cachedReleaseYearString ||= String(new Date(this.rt_original_release_date * 1000).getFullYear());
    }
  }
  const original = new Overview();
  const map = new Map([[Number(id), original], [570, new Overview(570, 1373389200)]]);
  const store = {
    m_mapApps: map,
    m_mapStoreTagLocalization: { 5: 'Native Tag' } as Record<number, string>,
    GetLocalizationForStoreTag(tagId: number): string | undefined { return this.m_mapStoreTagLocalization[tagId]; },
    GetAppOverviewByAppID(appId: number) { return map.get(appId) || null; },
    UpdateAppOverview(appId: number, nativeDate: number) {
      map.set(appId, new Overview(appId, nativeDate));
      listeners.forEach(listener => listener());
      return true;
    },
  };
  const previous = (window as any).appStore;
  const previousClient = globalThis.SteamClient;
  const listeners = new Set<() => void>();
  let registrations = 0;
  Object.assign(globalThis, { SteamClient: { ...previousClient, Apps: {
    ...previousClient?.Apps,
    RegisterForAppOverviewChanges(listener: () => void) {
      registrations++;
      listeners.add(listener);
    },
  } } });
  Object.assign(window, { appStore: store });
  const update = store.UpdateAppOverview;
  const localization = store.GetLocalizationForStoreTag;
  const cleanup = registerGameDetails(manager);
  let updated = original;
  try {
    const expected = Math.floor(new Date(2026, 9, 1, 12).getTime() / 1000);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(expected);
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(original);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetReleaseYearString()).toBe('2026');
    expect(store.GetAppOverviewByAppID(Number(id))?.rt_purchased_time)
      .toBe(Math.floor(new Date(2024, 1, 13, 12).getTime() / 1000));
    expect(store.GetAppOverviewByAppID(570)?.GetCanonicalReleaseDate()).toBe(1373389200);
    await manager.set(id, 'tags', [' RPG ', 'Co-op', 'RPG']);
    const tags = () => [...store.GetAppOverviewByAppID(Number(id))!.GetStoreTags()]
      .map(tag => store.GetLocalizationForStoreTag(tag));
    expect(tags()).toEqual(['Native Tag', 'RPG', 'Co-op']);
    store.m_mapStoreTagLocalization = { 5: 'Native Tag' };
    expect(tags()).toEqual(['Native Tag', 'RPG', 'Co-op']);
    expect([...store.GetAppOverviewByAppID(570)!.GetStoreTags()]).toEqual([5]);
    await manager.set(id, 'tags', [19, 4182, 1685, 'Custom']);
    expect([...store.GetAppOverviewByAppID(Number(id))!.GetStoreTags()]).toEqual([5, 19, 4182, 1685, CUSTOM_TAG]);
    expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreCategory(2)).toBe(true);
    expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreCategory(9)).toBe(true);
    expect(store.GetAppOverviewByAppID(570)!.BHasStoreCategory(2)).toBe(false);
    await manager.set(id, 'tags', ['RPG', 'Co-op']);
    expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreCategory(2)).toBe(false);
    expect(store.UpdateAppOverview(Number(id), 0)).toBe(true);
    updated = store.GetAppOverviewByAppID(Number(id))!;
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(expected);
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(updated);
    expect(store.GetAppOverviewByAppID(Number(id))?.rt_purchased_time)
      .toBe(Math.floor(new Date(2024, 1, 13, 12).getTime() / 1000));
    expect(tags()).toEqual(['Native Tag', 'RPG', 'Co-op']);
    await manager.set(id, 'tags', ['Co-op']);
    expect(tags()).toEqual(['Native Tag', 'Co-op']);
    await manager.set(id, 'tags', []);
    expect(tags()).toEqual(['Native Tag']);
    // Another plugin can finish an asynchronous playtime update on this reference.
    Object.assign(updated, { minutes_playtime_forever: 123 });
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
    const previousView = store.GetAppOverviewByAppID(Number(id));
    await manager.set(id, 'releaseDate', '2025-04-28');
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(previousView);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate())
      .toBe(Math.floor(new Date(2025, 3, 28, 12).getTime() / 1000));
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
    await manager.set(id, 'releaseDate', '');
    expect(store.GetAppOverviewByAppID(Number(id))?.GetReleaseYearString()).toBe(String(new Date(0).getFullYear()));
    await manager.set(id, 'releaseDate', '2025-04-28');
    await manager.set(id, 'addedToLibraryDate', '');
    expect(store.GetAppOverviewByAppID(Number(id))?.rt_purchased_time).toBe(100);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate())
      .toBe(Math.floor(new Date(2025, 3, 28, 12).getTime() / 1000));
    await manager.clear(id);
    expect(store.GetAppOverviewByAppID(Number(id))).toBe(updated);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    await manager.set(id, 'releaseDate', '2025-04-28');
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate())
      .toBe(Math.floor(new Date(2025, 3, 28, 12).getTime() / 1000));
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
  } finally {
    cleanup();
    expect(store.GetAppOverviewByAppID(Number(id))).toBe(updated);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    expect(store.UpdateAppOverview).toBe(update);
    expect(store.GetLocalizationForStoreTag).toBe(localization);
    expect(store.m_mapStoreTagLocalization).toEqual({ 5: 'Native Tag' });
    store.UpdateAppOverview(Number(id), 0);
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    const again = registerGameDetails(manager);
    expect(registrations).toBe(1);
    again();
    Object.assign(window, { appStore: previous });
    Object.assign(globalThis, { SteamClient: previousClient });
    manager.dispose();
  }
});

async function setupShortcutFilters(binding: string) {
  class Overview {
    m_setStoreTags = new Set([5]);
    rt_original_release_date = 0;
    constructor(public appid: number) {
      if (binding === 'eager')
        Object.defineProperty(this, 'BHasStoreTag', { value: this.BHasStoreTag.bind(this) });
    }
    BHasStoreTag(tag: number) { return this.m_setStoreTags.has(tag); }
    GetStoreTags() { return this.m_setStoreTags; }
  }
  // Steam decorates prototype methods with getters that bind and freeze on first access.
  const getStoreTags = Overview.prototype.GetStoreTags;
  Object.defineProperty(Overview.prototype, 'GetStoreTags', {
    configurable: true,
    get() {
      const bound = getStoreTags.bind(this);
      Object.defineProperty(this, 'GetStoreTags', { value: bound });
      return bound;
    },
  });
  if (binding === 'lazy') {
    const hasStoreTag = Overview.prototype.BHasStoreTag;
    Object.defineProperty(Overview.prototype, 'BHasStoreTag', {
      configurable: true,
      get() {
        const bound = hasStoreTag.bind(this);
        Object.defineProperty(this, 'BHasStoreTag', { value: bound });
        return bound;
      },
    });
  }
  const native = new Overview(Number(id));
  const apps = new Map([[Number(id), native], [570, new Overview(570)]]);
  const store = { m_mapApps: apps, GetAppOverviewByAppID: (appId: number) => apps.get(appId) || null };
  const matches = new Set<number>();
  const counters = { cloudWrites: 0 };
  class Filter {
    searchText = '';
    options = [{ option: 19 }, { option: -1 }];
    GetAllSelectedOptions() { return this.options; }
    GetTagsString() { return `?tags=${this.options.map(({ option }) => option).join(',')}`; }
  }
  class Collection {
    constructor(public internalAppFilter?: Filter) {}
    async Save() { counters.cloudWrites++; return true; }
  }
  const collections = {
    NewUnsavedCollection(_name: string, filter?: Filter) { return new Collection(filter); },
    OnAppOverviewChange(updated: Overview[], _removed: number[]) {
      for (const app of updated) {
        const hasTag = app.BHasStoreTag; // Steam passes this callback without a receiver.
        if (hasTag(19)) matches.add(app.appid);
        else matches.delete(app.appid);
      }
    },
  };
  const previousStore = (window as any).appStore;
  const previousCollections = (window as any).collectionStore;
  const previousClient = globalThis.SteamClient;
  const previousModules = runtime.nativeModuleCandidates;
  const previousJsxRuntime = window.SP_JSX_FACTORY;
  const jsxRuntime = {
    Fragment: Symbol.for('react.fragment'),
    jsx(_type: unknown, props: { collection?: { id: string }; ignoreFiltering?: boolean }) {
      return { $$typeof: Symbol.for('react.transitional.element'), props };
    },
    jsxs(_type: unknown, props: { collection?: { id: string }; ignoreFiltering?: boolean }) {
      return { $$typeof: Symbol.for('react.transitional.element'), props };
    },
  };
  window.SP_JSX_FACTORY = jsxRuntime;
  runtime.nativeModuleCandidates = [...previousModules, Filter];
  const notifications = new Set<() => void>();
  Object.assign(globalThis, { SteamClient: { ...previousClient, Apps: {
    RegisterForAppOverviewChanges: (callback: () => void) => notifications.add(callback),
  } } });
  Object.assign(window, { appStore: store, collectionStore: collections });
  runtime.savedDetails = { [id]: { tags: [19, 'Custom'] } };
  const manager = new GameDetailsManager();
  await manager.load();
  const cleanup = registerGameDetails(manager);
  return {
    Overview, apps, store, matches, Filter, collections, jsxRuntime, notifications, manager, counters,
    dispose() {
      cleanup();
      expect(new Filter().GetTagsString()).toBe('?tags=19,-1');
      runtime.nativeModuleCandidates = previousModules;
      window.SP_JSX_FACTORY = previousJsxRuntime;
      const grid = jsxRuntime.jsx(null, { collection: { id: 'deck-desktop-apps' }, ignoreFiltering: true });
      expect(grid.props.ignoreFiltering).toBe(true);
      expect(matches.size).toBe(0);
      expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreTag(19)).toBe(false);
      Object.assign(window, { appStore: previousStore, collectionStore: previousCollections });
      Object.assign(globalThis, { SteamClient: previousClient });
      manager.dispose();
    },
  };
}

test('remote library disconnect reapplies metadata after the final native overview update', async () => {
  const context = await setupShortcutFilters('lazy');
  const { store, Overview, matches, manager, apps, notifications, collections } = context;
  const hookedOnChange = collections.OnAppOverviewChange;
  try {
    await manager.set(id, 'releaseDate', '2024-02-29');
    await manager.set(id, 'addedToLibraryDate', '2023-01-15');
    apps.set(Number(id), new Overview(Number(id)));
    notifications.forEach(notify => notify());
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreTag(19)).toBe(true);

    // Steam's final disconnect update arrives after the native subscription fires.
    const local = new Overview(Number(id));
    apps.set(Number(id), local);
    collections.OnAppOverviewChange([local], []);
    await tick();
    const view = store.GetAppOverviewByAppID(Number(id))!;
    expect(view.rt_original_release_date).toBe(Math.floor(new Date(2024, 1, 29, 12).getTime() / 1000));
    expect((view as typeof view & { rt_purchased_time: number }).rt_purchased_time)
      .toBe(Math.floor(new Date(2023, 0, 15, 12).getTime() / 1000));
    expect(view.GetStoreTags()).toEqual(new Set([5, 19, CUSTOM_TAG]));
    expect(matches).toEqual(new Set([Number(id)]));
    expect(store.GetAppOverviewByAppID(570)!.rt_original_release_date).toBe(0);

    // Unload before a queued sync must leave the latest native value intact.
    collections.OnAppOverviewChange([view], []);
  } finally {
    context.dispose();
    expect(collections.OnAppOverviewChange).not.toBe(hookedOnChange);
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))!.rt_original_release_date).toBe(0);
  }
});

test('publishing overviews does not resync through the own library notification', async () => {
  const context = await setupShortcutFilters('lazy');
  const { store, manager } = context;
  const lookup = store.GetAppOverviewByAppID;
  let lookups = 0;
  store.GetAppOverviewByAppID = (appId: number) => {
    lookups++;
    return lookup(appId);
  };
  try {
    await manager.set(id, 'releaseDate', '2024-02-29');
    await tick();
    expect(lookups).toBe(1);
  } finally {
    store.GetAppOverviewByAppID = lookup;
    context.dispose();
  }
});

test.each(BINDINGS)('%s bound filters apply the active filter to the Big Picture non-Steam grid', async binding => {
  const context = await setupShortcutFilters(binding);
  const { jsxRuntime } = context;
  try {
    const nonSteamGrid = { collection: { id: 'deck-desktop-apps' }, ignoreFiltering: true };
    for (const render of [jsxRuntime.jsx, jsxRuntime.jsxs]) {
      expect(render(null, nonSteamGrid).props.ignoreFiltering).toBe(false);
      expect(nonSteamGrid.ignoreFiltering).toBe(true);
      const other = { collection: { id: 'all-games' }, ignoreFiltering: true };
      expect(render(null, other).props).toBe(other);
    }
  } finally {
    context.dispose();
  }
});

test.each(BINDINGS)('%s bound filters keep custom tags out of Store links and cloud collections', async binding => {
  const context = await setupShortcutFilters(binding);
  const { Filter, collections, counters } = context;
  try {
    const filter = new Filter();
    expect(filter.GetTagsString()).toBe('?tags=19');
    expect(filter.GetAllSelectedOptions()).toEqual([{ option: 19 }, { option: -1 }]);
    const collection = collections.NewUnsavedCollection('Local', filter);
    await expect(collection.Save()).rejects.toThrow('custom tags');
    expect(counters.cloudWrites).toBe(0);
    filter.searchText = 'local search';
    expect(filter.GetTagsString()).toBe('');
    filter.options = [{ option: 19 }];
    filter.searchText = '';
    expect(filter.GetTagsString()).toBe('?tags=19');
    expect(await collection.Save()).toBe(true);
    expect(counters.cloudWrites).toBe(1);
    filter.options.push({ option: -1 });
    expect(filter.GetTagsString()).toBe('?tags=19');
    await expect(collection.Save()).rejects.toThrow('custom tags');
    expect(counters.cloudWrites).toBe(1);
  } finally {
    context.dispose();
  }
});

test.each(BINDINGS)('%s bound filters see shortcut tags after edits and native cache replacements', async binding => {
  const context = await setupShortcutFilters(binding);
  const { store, Overview, matches, manager, apps, notifications } = context;
  try {
    const hasTag = store.GetAppOverviewByAppID(Number(id))!.BHasStoreTag;
    expect(store.GetAppOverviewByAppID(Number(id))).toBeInstanceOf(Overview);
    expect(hasTag(19)).toBe(true);
    expect(hasTag(CUSTOM_TAG)).toBe(true);
    expect(hasTag(5)).toBe(true);
    const view = store.GetAppOverviewByAppID(Number(id))!;
    const getTags = view.GetStoreTags;
    expect(getTags()).toEqual(new Set([5, 19, CUSTOM_TAG]));
    expect(view.GetStoreTags).toBe(getTags);
    expect(view.GetStoreTags()).toEqual(new Set([5, 19, CUSTOM_TAG]));
    expect(store.GetAppOverviewByAppID(570)!.BHasStoreTag(19)).toBe(false);
    expect(matches).toEqual(new Set([Number(id)]));
    await manager.set(id, 'tags', ['Custom']);
    expect(matches.size).toBe(0);
    await manager.set(id, 'tags', []);
    const empty = store.GetAppOverviewByAppID(Number(id))!;
    const nativeHasTag = empty.BHasStoreTag;
    expect(nativeHasTag(5)).toBe(true);
    expect(empty.BHasStoreTag).toBe(nativeHasTag);
    expect(empty.BHasStoreTag(19)).toBe(false);
    await manager.set(id, 'tags', [19]);
    apps.set(Number(id), new Overview(Number(id)));
    notifications.forEach(notify => notify());
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))!.BHasStoreTag(19)).toBe(true);
    expect(matches).toEqual(new Set([Number(id)]));
    await manager.clear(id);
    expect(matches.size).toBe(0);
    await manager.set(id, 'tags', [19]);
    expect(matches.size).toBe(1);
  } finally {
    context.dispose();
  }
});

test('Steam tag search saves IDs, keeps legacy names and displays localized names after reload', async () => {
  document.body.replaceChildren();
  runtime.savedDetails = { [id]: { tags: ['Action', 'Custom'] } };
  const previous = (window as any).appStore;
  const originalSet = backend.setGameDetail;
  const store = {
    m_mapStoreTagLocalization: { 19: 'Action', 4231: 'Action RPG', 4182: 'Singleplayer' } as Record<number, string>,
    GetLocalizationForStoreTag(tag: number) { return this.m_mapStoreTagLocalization[tag]; },
    GetTopStoreTags(query: string) {
      return Object.entries(this.m_mapStoreTagLocalization)
        .filter(([, name]) => name.toLowerCase().includes(query))
        .map(([id]) => ({ nTagId: Number(id), nCount: 1 }));
    },
  };
  Object.assign(window, { appStore: store });
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    expect(manager.details[id].tags).toEqual(['Action', 'Custom']);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Tags"]')!;
    input.getBoundingClientRect = () => ({
      left: 12, top: 720, bottom: 746, right: 312, width: 300, height: 26, x: 12, y: 720, toJSON() {},
    });
    await typeText(input, 'AC');
    const checkboxes = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const popup = document.querySelector<HTMLDivElement>('.extdatasrc-plugin-tag-suggestions')!;
    expect(window.getComputedStyle(popup).position).toBe('fixed');
    // Opens above the input when there is no room below, with a 4px gap.
    expect(popup.style.bottom).toBe(`${window.innerHeight - 720 + 4}px`);
    expect(popup.closest('.Field')).toBeNull();
    expect(popup.contains(checkboxes()[0])).toBe(true);
    expect(checkboxes().map(box => box.parentElement!.textContent)).toEqual(['Action', 'Action RPG']);
    expect(checkboxes().every(box => !box.checked)).toBe(true);
    await act(async () => { checkboxes()[0].click(); await tick(); });
    expect(document.activeElement).toBe(input);
    await act(async () => { checkboxes()[1].click(); await tick(); });
    expect(input.value).toBe('AC');
    expect(runtime.savedDetails[id].tags).toEqual(['Action', 'Custom', 19, 4231]);
    const steamChip = document.querySelector<HTMLButtonElement>('button[aria-label="Clear: Action RPG"]')!
      .closest('li')!;
    expect(steamChip.classList.contains('extdatasrc-plugin-token-store')).toBe(true);
    expect(window.getComputedStyle(steamChip).backgroundColor).toBe('rgb(26, 159, 255)');
    const customChip = document.querySelector<HTMLButtonElement>('button[aria-label="Clear: Custom"]')!.closest('li')!;
    expect(customChip.classList.contains('extdatasrc-plugin-token-store')).toBe(false);
    expect(window.getComputedStyle(customChip).backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
    expect(checkboxes().every(box => box.checked)).toBe(true);
    backend.setGameDetail = async () => false;
    await act(async () => { checkboxes()[1].click(); await tick(); });
    expect(checkboxes()[1].checked).toBe(true);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    backend.setGameDetail = originalSet;
    await act(async () => { checkboxes()[1].click(); await tick(); });
    expect(runtime.savedDetails[id].tags).toEqual(['Action', 'Custom', 19]);
    const reloaded = new GameDetailsManager();
    await reloaded.load();
    expect(reloaded.details[id].tags).toEqual(['Action', 'Custom', 19]);
    store.m_mapStoreTagLocalization[19] = 'Aktion';
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager: reloaded })); await tick(); });
    expect(document.querySelector('ul[aria-label="Tags"]')!.textContent).toContain('Aktion');
    expect(document.querySelector('ul[aria-label="Tags"]')!.textContent).toContain('Action');
    await clickLabeled('Clear: Aktion');
    expect(runtime.savedDetails[id].tags).toEqual(['Action', 'Custom']);
    await expect(reloaded.set(id, 'tags', [-1])).rejects.toThrow();
    await expect(reloaded.set(id, 'tags', [1.5])).rejects.toThrow();
    await expect(reloaded.set(id, 'tags', [0])).rejects.toThrow();
    const nextInput = document.querySelector<HTMLInputElement>('input[aria-label="Tags"]')!;
    await typeText(nextInput, 'Ak');
    expect(document.querySelector('.extdatasrc-plugin-tag-suggestions')).not.toBeNull();
    await pressKey(nextInput, 'Escape');
    expect(document.querySelector('.extdatasrc-plugin-tag-suggestions')).toBeNull();
    await act(async () => { nextInput.blur(); nextInput.focus(); });
    expect(document.querySelector('.extdatasrc-plugin-tag-suggestions')).not.toBeNull();
    await act(async () => { document.querySelector<HTMLInputElement>('input[aria-label="Developer"]')!.focus(); });
    expect(document.querySelector('.extdatasrc-plugin-tag-suggestions')).toBeNull();
    reloaded.dispose();
  } finally {
    backend.setGameDetail = originalSet;
    await act(async () => root.unmount());
    Object.assign(window, { appStore: previous });
    manager.dispose();
  }
});

test('added date and company fields save independently, clear, and survive reload', async () => {
  document.body.replaceChildren();
  runtime.savedDetails = { [id]: savedShortcutDetails() };
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  const originalSet = backend.setGameDetail;
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    const dropdowns = () => [...document.querySelectorAll<HTMLSelectElement>('select')];
    await selectOption(dropdowns()[3], '2025');
    expect(runtime.savedDetails[id].addedToLibraryDate).toBe('2025-01-15');
    expect(runtime.savedDetails[id].releaseDate).toBe('2024-02-29');
    const developer = document.querySelector<HTMLInputElement>('input[aria-label="Developer"]')!;
    const publisher = document.querySelector<HTMLInputElement>('input[aria-label="Publisher"]')!;
    expect([developer.value, publisher.value]).toEqual(['', '']);
    expect(document.querySelector('ul[aria-label="Developer"]')?.textContent).toContain('Studio');
    const edit = async (input: HTMLInputElement, value: string) => {
      await typeText(input, value);
      await act(async () => {
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await tick();
      });
    };
    await edit(developer, '  New Studio  ');
    await edit(publisher, 'New Publisher');
    expect(runtime.savedDetails[id]).toEqual({
      releaseDate: '2024-02-29', addedToLibraryDate: '2025-01-15',
      developer: ['Studio', 'New Studio'], publisher: ['Publisher', 'New Publisher'],
    });
    expect(developer.value).toBe('');
    await edit(developer, 'New Studio');
    expect(runtime.savedDetails[id].developer).toEqual(['Studio', 'New Studio']);
    const restarted = new GameDetailsManager();
    await restarted.load();
    expect(restarted.details).toEqual(manager.details);
    restarted.dispose();
    backend.setGameDetail = async () => false;
    await edit(developer, 'Failed Studio');
    expect(manager.details[id].developer).toEqual(['Studio', 'New Studio']);
    expect(runtime.savedDetails[id].developer).toEqual(['Studio', 'New Studio']);
    expect(developer.value).toBe('Failed Studio');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not');
    backend.setGameDetail = originalSet;
    const remove = async (name: string) => act(async () => {
      document.querySelector<HTMLButtonElement>(`button[aria-label="Clear: ${name}"]`)!.click();
      await tick();
    });
    await remove('Studio');
    expect(runtime.savedDetails[id].developer).toEqual(['New Studio']);
    await remove('New Studio');
    expect(runtime.savedDetails[id].developer).toBeUndefined();
    await selectOption(dropdowns()[4], '0');
    expect(runtime.savedDetails[id]).toEqual({ releaseDate: '2024-02-29', publisher: ['Publisher', 'New Publisher'] });
    expect(dropdowns().slice(3).map(dropdown => dropdown.value)).toEqual(['0', '0', '0']);
  } finally {
    backend.setGameDetail = originalSet;
    await act(async () => root.unmount());
    manager.dispose();
  }
});

const TOKEN_FIELDS = ['Developer', 'Publisher', 'Tags'];

test.each(TOKEN_FIELDS)('Enter restores %s focus after the disabled save interval', async label => {
  document.body.replaceChildren();
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  const originalSet = backend.setGameDetail;
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    backend.setGameDetail = async (...args) => { await pending; return originalSet(...args); };
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await typeText(input, 'New entry, Inc.');
    await pressKey(input, 'Enter');
    expect(input.disabled).toBe(true);
    // Chromium blurs disabled inputs; move focus explicitly in JSDOM.
    const other = document.createElement('button');
    document.body.append(other);
    await act(async () => { other.focus(); });
    expect(document.activeElement === input).toBe(false);
    other.remove();
    await act(async () => { complete(); await tick(); });
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('');
    expect(document.activeElement === input).toBe(true);
    const field = label === 'Tags' ? 'tags' : label === 'Developer' ? 'developer' : 'publisher';
    expect(manager.details[id][field]).toEqual(label === 'Tags' ? ['New entry', 'Inc.'] : ['New entry, Inc.']);
  } finally {
    complete();
    backend.setGameDetail = originalSet;
    await act(async () => root.unmount());
    manager.dispose();
  }
});

test('tags save as removable chips, survive reload and keep failed drafts', async () => {
  document.body.replaceChildren();
  const manager = new GameDetailsManager();
  const root = createRoot(document.body);
  const originalSet = backend.setGameDetail;
  try {
    await act(async () => { root.render(h(ExternalGameDetails, { appId: id, manager })); await tick(); });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Tags"]')!;
    const add = async (name: string) => {
      await typeText(input, name);
      await act(async () => {
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await tick();
      });
    };
    await add(' RPG, , Co-op, ');
    await add('RPG, Co-op');
    expect(runtime.savedDetails[id].tags).toEqual(['RPG', 'Co-op']);
    const list = document.querySelector<HTMLUListElement>('ul[aria-label="Tags"]')!;
    expect(window.getComputedStyle(list).flexWrap).toBe('wrap');
    expect(list.children).toHaveLength(2);
    const reloaded = new GameDetailsManager();
    await reloaded.load();
    expect(reloaded.details[id].tags).toEqual(['RPG', 'Co-op']);
    reloaded.dispose();
    backend.setGameDetail = async () => false;
    await add('Adventure');
    expect(input.value).toBe('Adventure');
    expect(manager.details[id].tags).toEqual(['RPG', 'Co-op']);
    backend.setGameDetail = originalSet;
    for (const tag of ['RPG', 'Co-op'])
      await clickLabeled(`Clear: ${tag}`);
    expect(runtime.savedDetails[id]).toBeUndefined();
    expect(document.querySelector('ul[aria-label="Tags"]')).toBeNull();
  } finally {
    backend.setGameDetail = originalSet;
    await act(async () => root.unmount());
    manager.dispose();
  }
});

test('old date objects are ignored and replaced by ISO strings on the next save', async () => {
  const original = backend.getGameDetails;
  backend.getGameDetails = async () => ({
    [id]: {
      releaseDate: { year: 2024, month: 2, day: 29 }, addedToLibrary: '2024-02-29', addedToLibraryDate: '2024-02-30',
      developer: ['Studio'],
    },
  }) as unknown as string;
  const manager = new GameDetailsManager();
  try {
    await manager.load();
    expect(manager.details[id]).toEqual({ developer: ['Studio'] });
    await expect(manager.set(id, 'releaseDate', '2024-2-29')).rejects.toThrow();
    await manager.set(id, 'releaseDate', '2026-02-13');
    expect(manager.details[id]).toEqual({ developer: ['Studio'], releaseDate: '2026-02-13' });
  } finally {
    backend.getGameDetails = original;
    manager.dispose();
  }
});

test('company arrays remain in Steam associations through edits and native cache replacements', async () => {
  const previous = (window as any).appDetailsStore;
  const native = {
    associationData: {
      rgDevelopers: [{ strName: 'Native Studio', strURL: 'native' }],
      rgPublishers: [] as { strName: string; strURL: string }[],
      rgFranchises: [],
    },
  };
  const cache = new Map([[Number(id), native], [570, native]]);
  const store = {
    m_mapAppData: cache,
    GetAppData(appId: number) {
      if (!cache.has(appId))
        cache.set(appId, { associationData: { rgDevelopers: [], rgPublishers: [], rgFranchises: [] } });
      return cache.get(appId)!;
    },
  };
  const companies = (field: 'rgDevelopers' | 'rgPublishers') =>
    store.GetAppData(Number(id)).associationData[field].map(value => value.strName);
  Object.assign(window, { appDetailsStore: store });
  const manager = new GameDetailsManager();
  await manager.load();
  await manager.set(id, 'developer', ['Studio', 'Other Studio']);
  await manager.set(id, 'publisher', ['Publisher', 'Other Publisher']);
  const originalGet = store.GetAppData;
  const cleanup = registerGameDetails(manager);
  let updated = native;
  try {
    const cached = cache.get(Number(id))!;
    expect(cached.associationData.rgDevelopers.map(value => value.strName)).toEqual(['Studio', 'Other Studio']);
    expect(companies('rgPublishers')).toEqual(['Publisher', 'Other Publisher']);
    expect(store.GetAppData(570)).toBe(native);
    await manager.set(id, 'developer', ['Other Studio']);
    expect(cached.associationData.rgDevelopers.map(value => value.strName)).toEqual(['Other Studio']);
    updated = {
      associationData: { ...native.associationData, rgDevelopers: [{ strName: 'Updated native', strURL: '' }] },
    };
    cache.set(Number(id), updated);
    expect(companies('rgDevelopers')).toEqual(['Other Studio']);
    await manager.set(id, 'developer', []);
    expect(companies('rgDevelopers')).toEqual(['Updated native']);
    expect(companies('rgPublishers')).toEqual(['Publisher', 'Other Publisher']);
    await manager.clear(id);
    expect(store.GetAppData(Number(id)).associationData).toBe(updated.associationData);
  } finally {
    cleanup();
    expect(store.GetAppData).toBe(originalGet);
    expect(cache.get(Number(id))).toBe(updated);
    Object.assign(window, { appDetailsStore: previous });
    manager.dispose();
  }
});

test('company overrides wait for Steam to load app data and publish outside the read path', async () => {
  const previous = (window as any).appDetailsStore;
  type Association = { strName: string; strURL: string };
  type AppData = { associationData: { rgDevelopers: Association[]; rgPublishers: never[]; rgFranchises: never[] } };
  const cache = new Map<number, AppData>();
  const store = { m_mapAppData: cache, GetAppData: (appId: number) => cache.get(appId) };
  Object.assign(window, { appDetailsStore: store });
  const manager = new GameDetailsManager();
  await manager.load();
  await manager.set(id, 'developer', ['Studio']);
  const cleanup = registerGameDetails(manager);
  try {
    expect(store.GetAppData(Number(id))).toBeUndefined();
    await manager.set(id, 'publisher', ['Publisher']);

    const native = {
      associationData: { rgDevelopers: [{ strName: 'Native', strURL: '' }], rgPublishers: [], rgFranchises: [] },
    };
    cache.set(Number(id), native);
    const view = store.GetAppData(Number(id))!;
    expect(view.associationData.rgDevelopers.map(value => value.strName)).toEqual(['Studio']);
    expect(cache.get(Number(id))).toBe(native);
    expect(store.GetAppData(Number(id))).toBe(view);
    await Promise.resolve();
    expect(cache.get(Number(id))).toBe(view);
  } finally {
    cleanup();
    Object.assign(window, { appDetailsStore: previous });
    manager.dispose();
  }
});

test('shortcut Game Info keeps native content without adding saved metadata', async () => {
  document.body.replaceChildren();
  class About extends Component<{ overview: { appid: number } }> {
    render() {
      return h('div', null,
        h('span', null, '#AppDetails_Shortcut_Explanation #AppDetails_Developer'),
        h('div', null, 'Native controls'));
    }
  }
  class AboutContainer extends Component<{ overview: { appid: number } }> {
    m_contentRef = createRef<HTMLDivElement>();
    componentDidMount() {}
    render() {
      const classes = { AppGameInfoContainer: 'AboutContainer', GameInfoShadow: 'Shadow' };
      return h('div', { ref: this.m_contentRef, className: classes.AppGameInfoContainer },
        h(About, this.props), h('div', { className: classes.GameInfoShadow }));
    }
  }
  const originalMount = AboutContainer.prototype.componentDidMount;
  const previousCandidates = runtime.nativeModuleCandidates;
  const previousClasses = runtime.nativeClassCandidates;
  runtime.nativeModuleCandidates = [AboutContainer];
  runtime.nativeClassCandidates = [{
    AssociationList: 'AssociationList', Stats: 'Stats', SectionContainer: 'SectionContainer', Label: 'Label',
    Association: 'Association', Release: 'Release', Date: 'Date',
  }];
  const manager = new GameDetailsManager();
  await manager.load();
  await manager.set(id, 'developer', ['Studio']);
  await manager.set(id, 'publisher', ['Publisher']);
  const unregister = registerGameDetails(manager);
  const root = createRoot(document.body);
  try {
    await act(async () => root.render(h(AboutContainer, { overview: { appid: Number(id) } })));
    const nativeContent = document.body.innerHTML;
    expect(document.body.textContent).toContain('Native controls');
    expect(document.querySelector('.Stats')).toBeNull();
    expect(AboutContainer.prototype.componentDidMount).toBe(originalMount);
    await manager.set(id, 'developer', ['Changed Studio']);
    await manager.set(id, 'tags', ['Custom Tag']);
    await act(async () => root.render(h(AboutContainer, { overview: { appid: Number(id) } })));
    expect(document.body.innerHTML).toBe(nativeContent);
    await manager.clear(id);
    expect(document.body.innerHTML).toBe(nativeContent);
    unregister();
    expect(document.body.innerHTML).toBe(nativeContent);
  } finally {
    unregister();
    await act(async () => root.unmount());
    AboutContainer.prototype.componentDidMount = originalMount;
    runtime.nativeModuleCandidates = previousCandidates;
    runtime.nativeClassCandidates = previousClasses;
    manager.dispose();
  }
});

test('a failing game details subscriber does not reject a saved override', async () => {
  const manager = new GameDetailsManager();
  const originalError = console.error;
  let notified = false;
  console.error = () => {};
  manager.subscribe(() => { throw new Error('Steam store changed'); });
  manager.subscribe(() => { notified = true; });
  try {
    await manager.load();
    await expect(manager.set(id, 'developer', ['Studio'])).resolves.toBeUndefined();
    expect(manager.details[id]).toEqual({ developer: ['Studio'] });
    expect(notified).toBe(true);
  } finally {
    console.error = originalError;
    manager.dispose();
  }
});

test('custom tag IDs are negative, derived from the name and stable across sessions', () => {
  expect(localTagId('Custom')).toBe(localTagId('Custom'));
  expect(localTagId('Custom')).not.toBe(localTagId('custom'));
  for (const name of ['', 'Custom', 'Roguelike Deckbuilder', '日本語'])
    expect(Number.isSafeInteger(localTagId(name)) && localTagId(name) < 0).toBe(true);
});
