import { afterPatch } from 'millennium';
import { isNonSteamId } from './client';
import type { FeedManager } from '../feed/manager';
import type { GameDetailsManager } from '../game-details/manager';

/**
 * Clears configured feed and game detail settings after Steam removes a shortcut.
 * The removal callback does not wait for the configuration write; failures are logged.
 */
function onShortcutRemoved(feedManager: FeedManager, gameDetails: GameDetailsManager, [appId]: [number]): void {
  const appIdString = String(appId);

  if (!isNonSteamId(appId))
    return;

  if (Object.prototype.hasOwnProperty.call(feedManager.sources, appIdString)) {
    void feedManager.clear(appIdString).catch(error =>
      console.error(`[External Data Sources] Could not remove feed for ${appIdString}`, error));
  }

  if (Object.prototype.hasOwnProperty.call(gameDetails.details, appIdString)) {
    void gameDetails.clear(appIdString).catch(error =>
      console.error(`[External Data Sources] Could not remove game details for ${appIdString}`, error));
  }
}

/** Watches Steam shortcut removals and clears settings for matching AppIds. */
export function registerShortcutRemoval(feedManager: FeedManager, gameDetails: GameDetailsManager): () => void {
  const patch = afterPatch(SteamClient.Apps, 'RemoveShortcut', onShortcutRemoved.bind(null, feedManager, gameDetails));

  return () => patch.unpatch();
}
