import { afterPatch } from 'millennium';
import { isNonSteamId } from './client';
import type { FeedManager } from '../feed/manager';
import type { GameDetailsManager } from '../game-details/manager';
import { log } from '../logger';

/**
 * Clears feed and game detail settings after Steam removes a shortcut.
 * Both backend calls are idempotent and run even when the managers have not
 * loaded the settings, so a failed startup load cannot leave settings behind.
 * The removal callback does not wait for the configuration write; failures are logged.
 */
function onShortcutRemoved(feedManager: FeedManager, gameDetails: GameDetailsManager, [appId]: [number]): void {
  const appIdString = String(appId);

  if (!isNonSteamId(appId))
    return;

  void feedManager.clear(appIdString).catch(error =>
    log.error(`Could not remove feed for ${appIdString}`, error));

  void gameDetails.clear(appIdString).catch(error =>
    log.error(`Could not remove game details for ${appIdString}`, error));
}

/** Watches Steam shortcut removals and clears settings for matching AppIds. */
export function registerShortcutRemoval(feedManager: FeedManager, gameDetails: GameDetailsManager): () => void {
  const patch = afterPatch(SteamClient.Apps, 'RemoveShortcut', onShortcutRemoved.bind(null, feedManager, gameDetails));

  return () => patch.unpatch();
}
