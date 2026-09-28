import { afterPatch } from 'millennium';
import { isNonSteamId } from './steam';
import type { Sources } from './sources';


/*****************************************************************************/
/* Helper Functions                                                          */
/*****************************************************************************/

/**
 * Clears a configured feed after Steam removes its non-Steam shortcut.
 * The removal callback does not wait for the configuration write; failures are logged.
 */
function onShortcutRemoved(sources: Sources, [appId]: [number]): void {
  const id = String(appId);
  if (isNonSteamId(appId) && Object.prototype.hasOwnProperty.call(sources.values, id)) {
    void sources.clear(id).catch(error =>
      console.error(`[External Data Sources] Could not remove feed for ${id}`, error));
  }
}


/*****************************************************************************/
/* Functions                                                                 */
/*****************************************************************************/

/**
 * Watches Steam shortcut removals and clears feeds for matching AppIds.
 * @param sources Loaded feed settings used to find and clear matching entries.
 * @returns A cleanup function that removes the Steam hook.
 */
export function registerShortcutRemoval(sources: Sources): () => void {
  const patch = afterPatch(SteamClient.Apps, 'RemoveShortcut', onShortcutRemoved.bind(null, sources));
  return () => patch.unpatch();
}
