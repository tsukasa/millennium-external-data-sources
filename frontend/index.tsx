import { definePlugin } from 'millennium';
import { initI18n, getPluginI18nString } from './i18n';
import { registerProperties } from './steam/properties';
import { registerLibrary } from './steam/library';
import { activeAppId, steam } from './steam/client';
import { FeedManager } from './feed/manager';
import { GameDetailsManager } from './game-details/manager';
import { registerGameDetails } from './steam/game-details-store';
import { registerShortcutRemoval } from './steam/shortcut-removal';
import { PluginConfiguration } from './components/plugin-configuration';
import PluginIcon from './plugin-icon';

/** Loads game details before feeds and registers UI integrations when Steam's windows are ready. */
export default definePlugin(async () => {
  await initI18n();

  let pluginStopped = false;

  const cleanups: (() => void)[] = [];

  const feedManager = new FeedManager();
  const gameDetails = new GameDetailsManager();

  const register = (name: string, install: () => () => void) => {
    try {
      cleanups.push(install());
    } catch (error) {
      console.error(`[External Data Sources] ${name} initialization failed`, error);
    }
  };

  // Metadata hooks do not depend on window managers or feed configuration.
  register('Game details', () => registerGameDetails(gameDetails));
  const gameDetailsLoading = Promise
    .resolve()
    .then(() => gameDetails.load())
    .catch(error => console.error('[External Data Sources] Could not load game details', error));

  // Feed loading waits for metadata, but does not need Steam's windows.
  void gameDetailsLoading
    .then(async () => {
      if (pluginStopped)
        return;

      try {
        await feedManager.load();
      } catch (error) {
        console.error('[External Data Sources] Could not load configuration', error);
        return;
      } finally {
        // Removal must still clear saved metadata if feed configuration failed to load.
        if (!pluginStopped)
          register('Shortcut removal', () => registerShortcutRemoval(feedManager, gameDetails));
      }

      if (!pluginStopped)
        feedManager.startBackgroundRefresh(activeAppId());
    })
    .catch(error => console.error('[External Data Sources] Could not start background refresh', error));

  // UI hooks subscribe to the managers and can be installed while data is loading.
  const initializationTimer = setInterval(() => {
    if (pluginStopped || !steam().MainWindowBrowserManager || !steam().g_PopupManager)
      return;

    clearInterval(initializationTimer);
    register('Library', () => registerLibrary(feedManager));
    register('Properties', () => registerProperties(feedManager, gameDetails));
  }, 250);

  return {
    title: getPluginI18nString('externalDataSources'),
    icon: <PluginIcon />,
    content: <PluginConfiguration feedManager={feedManager} />,
    onDismount: () => {
      if (pluginStopped)
        return;

      pluginStopped = true;
      clearInterval(initializationTimer);

      for (const currentCleanupFunc of cleanups.splice(0).reverse()) {
        try {
          currentCleanupFunc();
        } catch (error) {
          console.error('[External Data Sources] Cleanup failed', error);
        }
      }

      feedManager.dispose();
      gameDetails.dispose();
    },
  };
});
