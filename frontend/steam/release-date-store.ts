import { isNonSteamId, steam, type AppOverview } from './client';
import type { ReleaseDateManager } from '../release-date/manager';
import type { CalendarDate } from '../release-date/calendar-date';

type AppOverviewChangeCallback = Parameters<typeof SteamClient.Apps.RegisterForAppOverviewChanges>[0];

type OverviewApps = typeof SteamClient.Apps;

const overviewListeners = new WeakMap<OverviewApps, { notify?: () => void }>();

/**
 * Subscribes to changes in the app overview for a given OverviewApps instance.
 * @param apps The OverviewApps instance to subscribe to.
 * @param notify The callback to invoke when the app overview changes.
 * @returns A function to unsubscribe from the changes.
 */
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
 * @param date The CalendarDate to convert.
 * @returns The Unix timestamp at noon local time for the given date.
 */
export function releaseDateSeconds(date: CalendarDate): number {
  return Math.floor(new Date(date.year, date.month - 1, date.day, 12).getTime() / 1000);
}

/**
 * Registers release dates with the Steam app overview system.
 * Keep configured dates on Steam's app overviews, which library sorting reads.
 * @param manager The ReleaseDateManager instance containing the release dates to register.
 * @returns A function to restore the original app overviews.
 */
export function registerReleaseDates(manager: ReleaseDateManager): () => void {
  let restore: (() => void) | undefined;

  const install = () => {
    if (restore)
      return true;

    const store = steam().appStore;

    if (!store?.m_mapApps || !store.GetAppOverviewByAppID
      || typeof SteamClient.Apps.RegisterForAppOverviewChanges !== 'function')
      return false;

    const originals = new Map<number, AppOverview>();
    const published = new Map<number, AppOverview>();

    const publish = (appId: number, original: AppOverview, timestamp: number) => {
      // Steam's library cards need a new store value to redraw their date.
      // Delegate every other field to the original overview so plugins that
      // finish asynchronous updates on it (such as playtime) remain visible.
      const view = new Proxy(original, {
        get(target, property, receiver) {
          if (property === 'rt_original_release_date')
            return timestamp;
          if (property === '__cachedReleaseYearString')
            return undefined;
          return Reflect.get(target, property, receiver);
        }
      });

      store.m_mapApps.set(appId, view);
      published.set(appId, view);
    };

    const restoreOriginal = (appId: number, overview: AppOverview) => {
      const original = originals.get(appId);

      if (original && overview === published.get(appId)) {
        original.__cachedReleaseYearString = undefined;
        store.m_mapApps.set(appId, original);
      }
    };

    const sync = () => {
      const ids = new Set([
        ...originals.keys(),
        ...Object.keys(manager.dates).map(Number)
      ]);

      for (const appId of ids) {
        if (!isNonSteamId(appId))
          continue;

        const overview = store.GetAppOverviewByAppID(appId);
        if (!overview)
          continue;

        const date = manager.dates[String(appId)];
        if (date) {
          const timestamp = releaseDateSeconds(date);

          // Native updates can replace the overview. Use that new instance as
          // the source for subsequent plugin updates.
          if (overview !== published.get(appId))
            originals.set(appId, overview);

          if (overview.rt_original_release_date !== timestamp)
            publish(appId, originals.get(appId)!, timestamp);
        } else if (originals.has(appId)) {
          restoreOriginal(appId, overview);
          originals.delete(appId);
          published.delete(appId);
        }
      }
    };

    const safeSync = () => {
      try {
        sync();
      } catch (error) {
        console.error('[External Data Sources] Could not apply release date:', error);
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
      unsubscribeOverview();
      unsubscribe();

      for (const [appId] of originals) {
        const overview = store.GetAppOverviewByAppID(appId);
        if (overview)
          restoreOriginal(appId, overview);
      }

      originals.clear();
      published.clear();
    };

    return true;
  };

  const installTimer = install() ? undefined : setInterval(() => {
    if (install())
      clearInterval(installTimer);
  }, 500);

  return () => {
    clearInterval(installTimer);
    restore?.();
  };
}
