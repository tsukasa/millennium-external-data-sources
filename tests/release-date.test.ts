import { beforeEach, expect, test } from 'bun:test';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { installBackend, ReleaseDateManager, daysInMonth, isCalendarDate, registerReleaseDates, ExternalReleaseDate, id, tick, runtime } from './helpers/ui-runtime';

beforeEach(installBackend);

test('release date dropdowns save valid changes and clear on an empty selection', async () => {
  document.body.replaceChildren();
  runtime.savedDates = { [id]: { year: 2024, month: 2, day: 29 } };
  const manager = new ReleaseDateManager();
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(ExternalReleaseDate, { appId: id, manager })); await tick(); });
    const dropdowns = () => [...document.querySelectorAll<HTMLSelectElement>('select[data-native-dropdown]')];
    expect(dropdowns()).toHaveLength(3);
    expect(document.querySelector('.Field.Background.Panel > div')?.textContent).toBe('Release Date');
    expect(dropdowns().map(dropdown => dropdown.getAttribute('aria-label'))).toEqual(['Year', 'Month', 'Day']);
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
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();

    await act(async () => {
      dropdowns()[0].value = '2025';
      dropdowns()[0].dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    expect(dropdowns()[2].options).toHaveLength(29);
    expect(dropdowns()[2].value).toBe('28');
    expect(runtime.savedDates[id]).toEqual({ year: 2025, month: 2, day: 28 });
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();

    await act(async () => {
      dropdowns()[1].value = '4';
      dropdowns()[1].dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    expect(dropdowns()[2].options).toHaveLength(31);
    expect(runtime.savedDates[id]).toEqual({ year: 2025, month: 4, day: 28 });
    expect(manager.dates[id]).toEqual(runtime.savedDates[id]);
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();
    await act(async () => {
      dropdowns()[2].value = '0';
      dropdowns()[2].dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    expect(runtime.savedDates[id]).toBeUndefined();
    expect(dropdowns().map(dropdown => dropdown.value)).toEqual(['0', '0', '0']);
    expect(document.querySelector('[role="status"],[role="alert"]')).toBeNull();
    expect(dropdowns().map(dropdown => dropdown.selectedOptions[0].textContent)).toEqual(['----', '--------', '--']);
    expect(isCalendarDate({ year: 2024, month: 2, day: 29 })).toBe(true);
    expect(isCalendarDate({ year: 2025, month: 2, day: 29 })).toBe(false);
    expect(isCalendarDate({ year: 1959, month: 12, day: 31 })).toBe(false);
    expect(isCalendarDate({ year: 1960, month: 1, day: 1 })).toBe(true);
    expect(isCalendarDate({ year: maxYear + 1, month: 1, day: 1 })).toBe(false);
    expect(daysInMonth(2025, 4)).toBe(30);
  } finally {
    await act(async () => root.unmount());
    manager.dispose();
  }
});


test('failed automatic release-date writes keep the saved selection visible', async () => {
  document.body.replaceChildren();
  runtime.savedDates = { [id]: { year: 2024, month: 2, day: 29 } };
  const manager = new ReleaseDateManager();
  const root = createRoot(document.body);
  const originalSet = backend.setReleaseDate;
  const originalClear = backend.clearReleaseDate;
  try {
    await act(async () => { root.render(h(ExternalReleaseDate, { appId: id, manager })); await tick(); });
    const dropdowns = () => [...document.querySelectorAll<HTMLSelectElement>('select[data-native-dropdown]')];
    backend.setReleaseDate = async () => false;
    await act(async () => {
      dropdowns()[0].value = '2025';
      dropdowns()[0].dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    expect(dropdowns().map(dropdown => dropdown.value)).toEqual(['2024', '2', '29']);
    expect(runtime.savedDates[id]).toEqual({ year: 2024, month: 2, day: 29 });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not');

    backend.clearReleaseDate = async () => false;
    await act(async () => {
      dropdowns()[1].value = '0';
      dropdowns()[1].dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    expect(dropdowns().map(dropdown => dropdown.value)).toEqual(['2024', '2', '29']);
    expect(runtime.savedDates[id]).toEqual({ year: 2024, month: 2, day: 29 });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not');
  } finally {
    backend.setReleaseDate = originalSet;
    backend.clearReleaseDate = originalClear;
    await act(async () => root.unmount());
    manager.dispose();
  }
});


test('configured release dates survive Steam overview updates and restore native dates', async () => {
  runtime.savedDates = { [id]: { year: 2026, month: 10, day: 1 } };
  const manager = new ReleaseDateManager(); await manager.load();
  class Overview {
    __cachedReleaseYearString?: string;
    minutes_playtime_forever = 0;
    constructor(public appid = Number(id), public rt_original_release_date = 0) {}
    GetCanonicalReleaseDate() { return this.rt_original_release_date; }
  }
  const original = new Overview();
  const map = new Map([[Number(id), original], [570, new Overview(570, 1373389200)]]);
  const store = {
    m_mapApps: map,
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
  const cleanup = registerReleaseDates(manager);
  let updated = original;
  try {
    const expected = Math.floor(new Date(2026, 9, 1, 12).getTime() / 1000);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(expected);
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(original);
    expect(store.GetAppOverviewByAppID(570)?.GetCanonicalReleaseDate()).toBe(1373389200);
    expect(store.UpdateAppOverview(Number(id), 0)).toBe(true);
    updated = store.GetAppOverviewByAppID(Number(id))!;
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(expected);
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(updated);
    // Another plugin can finish an asynchronous playtime update on this reference.
    Object.assign(updated, { minutes_playtime_forever: 123 });
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
    const previousView = store.GetAppOverviewByAppID(Number(id));
    await manager.set(id, new Date(2025, 3, 28, 12));
    expect(store.GetAppOverviewByAppID(Number(id))).not.toBe(previousView);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate())
      .toBe(Math.floor(new Date(2025, 3, 28, 12).getTime() / 1000));
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
    await manager.clear(id);
    expect(store.GetAppOverviewByAppID(Number(id))).toBe(updated);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    await manager.set(id, new Date(2025, 3, 28, 12));
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate())
      .toBe(Math.floor(new Date(2025, 3, 28, 12).getTime() / 1000));
    expect(store.GetAppOverviewByAppID(Number(id))?.minutes_playtime_forever).toBe(123);
  } finally {
    cleanup();
    expect(store.GetAppOverviewByAppID(Number(id))).toBe(updated);
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    expect(store.UpdateAppOverview).toBe(update);
    store.UpdateAppOverview(Number(id), 0);
    await tick();
    expect(store.GetAppOverviewByAppID(Number(id))?.GetCanonicalReleaseDate()).toBe(0);
    const again = registerReleaseDates(manager);
    expect(registrations).toBe(1);
    again();
    Object.assign(window, { appStore: previous });
    Object.assign(globalThis, { SteamClient: previousClient });
    manager.dispose();
  }
});

