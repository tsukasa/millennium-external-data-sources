import { afterPatch } from 'millennium';
import { isNonSteamId } from './client';
import type { FeedManager } from '../feed/manager';
import type { ReleaseDateManager } from '../release-date/manager';

/**
 * Clears configured feed and release-date settings after Steam removes a shortcut.
 * The removal callback does not wait for the configuration write; failures are logged.
 * @param feedManager The FeedManager instance containing the feed settings to clear.
 * @param releaseDates The ReleaseDateManager instance containing the release dates to clear.
 */
function onShortcutRemoved(feedManager: FeedManager, releaseDates: ReleaseDateManager, [appId]: [number]): void {
  const appIdString = String(appId);

  if (!isNonSteamId(appId))
    return;

  if (Object.prototype.hasOwnProperty.call(feedManager.values, appIdString)) {
    void feedManager.clear(appIdString).catch(error =>
      console.error(`[External Data Sources] Could not remove feed for ${appIdString}`, error));
  }

  if (Object.prototype.hasOwnProperty.call(releaseDates.dates, appIdString)) {
    void releaseDates.clear(appIdString).catch(error =>
      console.error(`[External Data Sources] Could not remove release date for ${appIdString}`, error));
  }
}

/**
 * Watches Steam shortcut removals and clears settings for matching AppIds.
 * @param feedManager Loaded feed settings used to find and clear matching entries.
 * @param releaseDates Loaded release dates used to find and clear matching entries.
 * @returns A cleanup function that removes the Steam hook.
 */
export function registerShortcutRemoval(feedManager: FeedManager, releaseDates: ReleaseDateManager): () => void {
  const patch = afterPatch(SteamClient.Apps, 'RemoveShortcut', onShortcutRemoved.bind(null, feedManager, releaseDates));
  return () => patch.unpatch();
}
