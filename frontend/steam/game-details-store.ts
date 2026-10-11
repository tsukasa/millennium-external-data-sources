import { retryInstall } from './retry-install';
import { findModule, findModuleExport } from 'millennium';
import {
  isNonSteamId, steam, type AppOverview, type AppData, type AssociationData, type LibraryFilter, type SteamCollection
} from './client';
import { MethodHooks } from './method-hooks';
import { localTagId, PLAYER_TAG_CATEGORIES } from './store-tags';
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
function calendarDateSeconds(date: CalendarDate): number {
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

    const createView = (appId: number, data: AppData) => {
      // Steam compares associations by reference; rebuild only when an input changes.
      let merged: { native: AssociationData | null; saved: GameDetails; value: AssociationData } | undefined;

      const view = new Proxy(data, {
        get(target, key, receiver) {
          const saved = manager.details[String(appId)];

          if (key !== 'associationData' || (!saved?.developer && !saved?.publisher))
            return Reflect.get(target, key, receiver);

          const native = target.associationData;

          if (merged?.native !== native || merged.saved !== saved) {
            merged = {
              native,
              saved,
              value: {
                ...native,
                rgFranchises: native?.rgFranchises || [],
                rgDevelopers: saved.developer?.map(strName => ({ strName, strURL: '' })) || native?.rgDevelopers || [],
                rgPublishers: saved.publisher?.map(strName => ({ strName, strURL: '' })) || native?.rgPublishers || [],
              },
            };
          }

          return merged.value;
        }
      });

      published.set(appId, { original: data, view });

      return view;
    };

    /** Returns the published view for an app, creating it when an override applies. */
    const viewFor = (appId: number, data: AppData | undefined) => {
      const details = manager.details[String(appId)];

      // Steam returns no data until it has loaded an app's details.
      if (!data || !isNonSteamId(appId) || (!details?.developer && !details?.publisher))
        return undefined;

      const entry = published.get(appId);

      if (data === entry?.view)
        return data;

      // The view reads overrides live, so it stays valid while the native data does.
      return data === entry?.original ? entry.view : createView(appId, data);
    };

    hooks.wrap(store, 'GetAppData', (original, _instance, [appId]) => {
      const data = original();
      const view = viewFor(appId, data);

      if (!view || view === data)
        return data;

      // Steam reads app data during renders. Publish to its observable cache
      // afterwards so the read path itself has no side effects.
      queueMicrotask(() => {
        if (cache.get(appId) === data && published.get(appId)?.view === view)
          cache.set(appId, view);
      });

      return view;
    });

    refresh = () => {
      for (const id of Object.keys(manager.details)) {
        const appId = Number(id);

        if (!isNonSteamId(appId))
          continue;

        // Asking Steam lets it load missing data; publish synchronously outside renders.
        store.GetAppData!(appId);
        const data = cache.get(appId);
        const view = viewFor(appId, data);

        if (view && view !== data)
          cache.set(appId, view);
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

  const stopInstalling = retryInstall(install, 500, { name: 'Game details installation' });

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

const LOCAL_TAG_COLLECTION_ERROR = 'Collections with custom tags cannot be saved to Steam Cloud. '
  + 'Use these tags in Library Filters locally.';

function installLocalTagActions(hooks: MethodHooks): void {
  const collections = steam().collectionStore;

  if (collections?.NewUnsavedCollection) {
    // This factory creates an unsaved in-memory instance; it performs no writes.
    const prototype = Object.getPrototypeOf(collections.NewUnsavedCollection('', undefined, [])) as SteamCollection;

    hooks.wrap(prototype, 'Save', (original, collection) => {
      // Native collection saves sync filter specs (and their tag IDs) to Steam Cloud.
      if (collection.internalAppFilter?.GetAllSelectedOptions().some(({ option }) => option < 0))
        return Promise.reject(new Error(LOCAL_TAG_COLLECTION_ERROR));

      return original();
    });
  }

  const Filter = findModuleExport(value => value?.prototype && 'GetTagsString' in value.prototype
    && 'GetAllSelectedOptions' in value.prototype) as { prototype: LibraryFilter } | undefined;

  if (Filter) {
    // Steam's "Search the Store" link must never include our local tag IDs.
    hooks.wrap(Filter.prototype, 'GetTagsString', (_original, filter) => {
      if (filter.searchText.length)
        return '';

      const steamTags = filter.GetAllSelectedOptions().map(({ option }) => option).filter(option => option >= 0);
      return `?tags=${steamTags.join(',')}`;
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
    get(copy, property, receiver) {
      // Steam's lazy binding getters install immutable methods on the receiver.
      // Subsequent reads must return that exact function to satisfy Proxy invariants.
      const bound = Object.getOwnPropertyDescriptor(copy, property);
      if (bound && !bound.configurable && 'value' in bound && !bound.writable)
        return bound.value;

      if (property === 'BHasStoreTag' && tags?.length)
        return hasStoreTag;

      if (property === 'm_setStoreCategories' && categories?.length)
        return new Set([...(original.m_setStoreCategories || []), ...categories]);

      if (property === 'm_setStoreTags' && tags?.length) {
        // Steam can replace its localization map after a server refresh.
        cacheTagNames();
        return new Set([...(original.m_setStoreTags || []), ...tags]);
      }

      if (property === 'rt_original_release_date' && details.releaseDate)
        return calendarDateSeconds(details.releaseDate);

      if (property === 'rt_purchased_time' && details.addedToLibraryDate)
        return calendarDateSeconds(details.addedToLibraryDate);

      if (property === '__cachedReleaseYearString' && details.releaseDate)
        return undefined;

      return Reflect.get(original, property, receiver);
    },

    set(_copy, property, value) {
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
    let publishing = false;

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
          id = localTagId(name);

          // Hash collisions are rare; probe to the next free ID.
          while (tagNames.has(id))
            id--;

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

      if (!changed.length)
        return;

      // Our own notification needs no resync through the hook below.
      publishing = true;
      try {
        steam().collectionStore?.OnAppOverviewChange(changed, []);
      } finally {
        publishing = false;
      }
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

    // Remote disconnects can update the store again after the native notification.
    // Resync after every processed library update, including that final replacement.
    const collections = steam().collectionStore;
    if (collections) {
      hooks.wrap(collections, 'OnAppOverviewChange', (original) => {
        const result = original();
        if (!publishing)
          onAppOverviewChange();
        return result;
      });
    }

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
          if (names[id] === name)
            delete names[id];
        }
      }

      tagMaps.clear();
      tagIds.clear();
      tagNames.clear();
    };

    return true;
  };

  const stopInstalling = retryInstall(install, 500, { name: 'Game details installation' });

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
