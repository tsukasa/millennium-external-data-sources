import { retryInstall } from './retry-install';
import { findModule, findModuleExport } from 'millennium';
import { isNonSteamId, steam, type AppOverview, type AppData, type LibraryFilter } from './client';
import { MethodHooks } from './method-hooks';
import { PLAYER_TAG_CATEGORIES } from './store-tags';
import type { GameDetailsManager, GameDetails } from '../game-details/manager';
import type { CalendarDate } from '../game-details/calendar-date';

type AppOverviewChangeCallback = Parameters<typeof SteamClient.Apps.RegisterForAppOverviewChanges>[0];

type OverviewApps = typeof SteamClient.Apps;

const overviewListeners = new WeakMap<OverviewApps, { notify?: () => void }>();

/** Subscribes to changes in the app overview for a given OverviewApps instance. */
function subscribeToOverviewChanges(apps: OverviewApps, notify: () => void): () => void {
  let slot = overviewListeners.get(apps);

  if (!slot) {
    slot = {};
    overviewListeners.set(apps, slot);
    const registeredSlot = slot;
    const callback: AppOverviewChangeCallback = () => registeredSlot.notify?.();

    try {
      apps.RegisterForAppOverviewChanges(callback);
    } catch (error) {
      overviewListeners.delete(apps);
      throw error;
    }
  }

  slot.notify = notify;

  return () => {
    if (slot.notify === notify)
      slot.notify = undefined;
  };
}

/**
 * Converts a CalendarDate to a Unix timestamp at noon local time.
 * Noon avoids midnight transitions while preserving the selected local day.
 */
export function calendarDateSeconds(date: CalendarDate): number {
  const [year, month, day] = date.split('-').map(Number);

  return Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000);
}

/** Publish company overrides while delegating other fields to live native app data. */
function registerCompanyAssociations(manager: GameDetailsManager): () => void {
  const hooks = new MethodHooks();
  const published = new Map<number, { original: AppData; view: AppData }>();

  let refresh = () => {};
  let restoreCache = () => {};

  const unsubscribe = manager.subscribe(() => refresh());
  const install = () => {
    const store = steam().appDetailsStore;

    if (!store?.GetAppData || !store.m_mapAppData)
      return false;

    const cache = store.m_mapAppData;

    hooks.wrap(store, 'GetAppData', (original, _instance, [appId]) => {
      const data = original()!;
      const details = manager.details[String(appId)];

      if (!isNonSteamId(appId) || (!details?.developer && !details?.publisher))
        return data;

      if (data === published.get(appId)?.view)
        return data;

      const view = new Proxy(data, {
        get(target, key, receiver) {
          const saved = manager.details[String(appId)];

          if (key !== 'associationData' || (!saved?.developer && !saved?.publisher))
            return Reflect.get(target, key, receiver);

          const native = target.associationData;
          const associations = { ...native, rgFranchises: native?.rgFranchises || [] };

          return {
            ...associations,
            rgDevelopers: saved.developer?.map(strName => ({ strName, strURL: '' })) || native?.rgDevelopers || [],
            rgPublishers: saved.publisher?.map(strName => ({ strName, strURL: '' })) || native?.rgPublishers || [],
          };
        }
      });

      published.set(appId, { original: data, view });

      cache.set(appId, view);

      return view;
    });

    refresh = () => {
      for (const id of Object.keys(manager.details)) {
        if (isNonSteamId(Number(id))) {
          store.GetAppData!(Number(id));
        }
      }
    };

    restoreCache = () => {
      for (const [id, { original, view }] of published) {
        if (cache.get(id) === view)
          cache.set(id, original);
      }
    };

    refresh();

    return true;
  };

  const stopInstalling = retryInstall(install, 500);

  return () => {
    stopInstalling();
    unsubscribe();

    hooks.restore();

    restoreCache();

    published.clear();
  };
}

function installBigPictureFilters(hooks: MethodHooks): void {
  const jsxRuntime = findModule(value => typeof value?.jsx === 'function'
    && typeof value.jsxs === 'function' && value.Fragment
    && value.jsx('span', {}).$$typeof === Symbol.for('react.transitional.element')) as {
      jsx(type: unknown, props: { collection?: { id: string }; ignoreFiltering?: boolean }, key?: unknown): unknown;
      jsxs(type: unknown, props: { collection?: { id: string }; ignoreFiltering?: boolean }, key?: unknown): unknown;
    } | undefined;

  if (jsxRuntime) {
    // Big Picture explicitly bypasses filters for its Non-Steam grid.
    // Keep Steam's grid and navigation, but let it apply the active native filter.
    for (const name of ['jsx', 'jsxs'] as const) {
      hooks.wrap(jsxRuntime, name, (original, _instance, args) => {
        const props = args[1];

        if (props.ignoreFiltering === true && props.collection?.id === 'deck-desktop-apps')
          args[1] = { ...props, ignoreFiltering: false };

        return original();
      });
    }
  }
}

function installLocalTagActions(hooks: MethodHooks): void {
  const collections = steam().collectionStore;

  if (collections?.NewUnsavedCollection) {
    // This factory creates an unsaved in-memory instance; it performs no writes.
    const prototype = Object.getPrototypeOf(collections.NewUnsavedCollection('', undefined, [])) as import('./client').SteamCollection;

    hooks.wrap(prototype, 'Save', (original, collection) => {
      // Native collection saves sync filter specs (and their tag IDs) to Steam Cloud.
      if (collection.internalAppFilter?.GetAllSelectedOptions().some(({ option }) => option < 0))
        return Promise.reject(new Error('Collections with custom tags cannot be saved to Steam Cloud. Use these tags in Library Filters locally.'));

      return original();
    });
  }

  const Filter = findModuleExport(value => value?.prototype && 'GetTagsString' in value.prototype
    && 'GetAllSelectedOptions' in value.prototype) as { prototype: LibraryFilter } | undefined;

  if (Filter) {
    // Steam's "Search the Store" link must never include our local tag IDs.
    hooks.wrap(Filter.prototype, 'GetTagsString', (_original, filter) => {
      const options = filter.GetAllSelectedOptions();

      return filter.searchText.length ? '' : `?tags=${options.filter(({ option }) => option >= 0).map(({ option }) => option).join(',')}`;
    });
  }
}

function createOverviewView(original: AppOverview, details: GameDetails, tags: number[] | undefined,
  cacheTagNames: () => void): AppOverview {
  const categories = tags?.map(id => PLAYER_TAG_CATEGORIES[id]).filter(Boolean);

  // Steam passes this bound method to its filters without the proxy receiver.
  const hasStoreTag = (id: number) => tags?.includes(id)
    || original.BHasStoreTag?.(id) || original.m_setStoreTags?.has(id) || false;

  // A writable copy avoids Proxy invariants for Steam's immutable bound methods.
  // Delegate reads and writes to the original so asynchronous updates stay live.
  return new Proxy(Object.setPrototypeOf({ ...original }, Object.getPrototypeOf(original)), {
    get(_target, property, receiver) {
      // Steam's lazy binding getters install immutable methods on the receiver.
      // Subsequent reads must return that exact function to satisfy Proxy invariants.
      const bound = Object.getOwnPropertyDescriptor(_target, property);
      if (bound && !bound.configurable && 'value' in bound && !bound.writable)
        return bound.value;

      const target = original;
      if (property === 'BHasStoreTag' && tags?.length)
        return hasStoreTag;

      if (property === 'm_setStoreCategories' && categories?.length)
        return new Set([...(target.m_setStoreCategories || []), ...categories]);

      if (property === 'm_setStoreTags' && tags?.length) {
        // Steam can replace its localization map after a server refresh.
        cacheTagNames();
        return new Set([
          ...(target.m_setStoreTags || []),
          ...tags
        ]);
      }

      if (property === 'rt_original_release_date' && details.releaseDate)
        return calendarDateSeconds(details.releaseDate);

      if (property === 'rt_purchased_time' && details.addedToLibraryDate)
        return calendarDateSeconds(details.addedToLibraryDate);

      if (property === '__cachedReleaseYearString' && details.releaseDate)
        return undefined;

      return Reflect.get(target, property, receiver);
    },

    set(_target, property, value) {
      return Reflect.set(original, property, value);
    },
  });
}

function registerOverviewDetails(manager: GameDetailsManager): () => void {
  let restore: (() => void) | undefined;

  const install = () => {
    const store = steam().appStore;

    if (!store?.m_mapApps || !store.GetAppOverviewByAppID
      || typeof SteamClient.Apps.RegisterForAppOverviewChanges !== 'function')
      return false;

    const originals = new Map<number, AppOverview>();
    const published = new Map<number, { view: AppOverview; details: GameDetails }>();
    const tagIds = new Map<string, number>();
    const tagNames = new Map<number, string>();
    const tagMaps = new Set<Record<number, string>>();
    const hooks = new MethodHooks();
    installBigPictureFilters(hooks);

    installLocalTagActions(hooks);

    const cacheTagNames = () => {
      const names = store.m_mapStoreTagLocalization;

      if (!names)
        return;

      tagMaps.add(names);

      for (const [id, name] of tagNames)
        names[id] = name;
    };

    const publish = (appId: number, original: AppOverview, details: GameDetails) => {
      // Steam's library cards need a new store value to redraw their date.
      // Delegate every other field to the original overview so plugins that
      // finish asynchronous updates on it (such as playtime) remain visible.
      original.__cachedReleaseYearString = undefined;
      const tags = details.tags?.map(name => {
        if (typeof name === 'number')
          return name;

        let id = tagIds.get(name);

        if (id === undefined) {
          // Steam tag IDs are positive; negative IDs are local to this plugin.
          id = -(tagIds.size + 1);
          tagIds.set(name, id);
          tagNames.set(id, name);
        }

        return id;
      });

      cacheTagNames();

      const view = createOverviewView(original, details, tags, cacheTagNames);

      store.m_mapApps.set(appId, view);
      published.set(appId, { view, details });
      return view;
    };

    const restoreOriginal = (appId: number, overview: AppOverview) => {
      const original = originals.get(appId);

      if (original && overview === published.get(appId)?.view) {
        original.__cachedReleaseYearString = undefined;
        store.m_mapApps.set(appId, original);
        return original;
      }

      return undefined;
    };

    const sync = () => {
      const changed: AppOverview[] = [];
      const ids = new Set([
        ...originals.keys(),
        ...Object.keys(manager.details).map(Number)
      ]);

      for (const appId of ids) {
        if (!isNonSteamId(appId))
          continue;

        const overview = store.GetAppOverviewByAppID(appId);
        if (!overview)
          continue;

        const details = manager.details[String(appId)];
        if (details) {
          // Native updates can replace the overview. Use that new instance as
          // the source for subsequent plugin updates.
          if (overview !== published.get(appId)?.view)
            originals.set(appId, overview);

          if (overview !== published.get(appId)?.view || details !== published.get(appId)?.details)
            changed.push(publish(appId, originals.get(appId)!, details));
        } else if (originals.has(appId)) {
          const restored = restoreOriginal(appId, overview);

          if (restored)
            changed.push(restored);

          originals.delete(appId);
          published.delete(appId);
        }
      }

      if (changed.length)
        steam().collectionStore?.OnAppOverviewChange(changed, []);
    };

    const safeSync = () => {
      try {
        sync();
      } catch (error) {
        console.error('[External Data Sources] Could not apply game details:', error);
      }
    };

    let stopped = false;

    // Steam's UpdateAppOverview is a non-configurable MobX action. Subscribe
    // to the same native notification and run after Steam has handled it.
    const onAppOverviewChange = () => {
      queueMicrotask(() => {
        if (!stopped)
          safeSync();
      });
    };

    const unsubscribeOverview = subscribeToOverviewChanges(SteamClient.Apps, onAppOverviewChange);
    const unsubscribe = manager.subscribe(safeSync);
    safeSync();

    restore = () => {
      stopped = true;
      hooks.restore();
      unsubscribeOverview();
      unsubscribe();

      const changed: AppOverview[] = [];
      for (const [appId] of originals) {
        const overview = store.GetAppOverviewByAppID(appId);

        if (overview) {
          const restored = restoreOriginal(appId, overview);
          if (restored)
            changed.push(restored);
        }
      }

      if (changed.length)
        steam().collectionStore?.OnAppOverviewChange(changed, []);

      originals.clear();
      published.clear();

      for (const names of tagMaps) {
        for (const [id, name] of tagNames) {
          if (names[id] === name) {
            delete names[id];
          }
        }
      }

      tagMaps.clear();
      tagIds.clear();
      tagNames.clear();
    };

    return true;
  };

  const stopInstalling = retryInstall(install, 500);

  return () => {
    stopInstalling();
    restore?.();
  };
}

export function registerGameDetails(manager: GameDetailsManager): () => void {
  const restoreAssociations = registerCompanyAssociations(manager);
  const restoreOverviews = registerOverviewDetails(manager);

  return () => {
    restoreAssociations();
    restoreOverviews();
  };
}
