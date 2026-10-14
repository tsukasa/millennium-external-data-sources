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
import { log } from './logger';

/** Startup loads retried in the background, e.g. while Millennium's backend starts. */
const LOAD_ATTEMPTS = 5;
const LOAD_RETRY_DELAY_MS = 1_000;

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
      log.error(`${name} initialization failed`, error);
    }
  };

  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Loads startup data and retries failures in the background with backoff.
   * The returned promise settles after the first attempt, so later startup steps
   * are not held up; `onLoaded` runs once the data is available.
   */
  const loadWithRetry = (name: string, load: () => Promise<void>, onLoaded = () => {}): Promise<void> => {
    const attempt = (failures: number): Promise<void> => Promise
      .resolve()
      .then(load)
      .then(() => {
        if (!pluginStopped)
          onLoaded();
      }, error => {
        log.error(`Could not load ${name}`, error);

        if (pluginStopped || failures + 1 >= LOAD_ATTEMPTS)
          return;

        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          if (!pluginStopped)
            void attempt(failures + 1);
        }, LOAD_RETRY_DELAY_MS * 2 ** failures);

        retryTimers.add(timer);
      });

    return attempt(0);
  };

  // Removal clears settings through the backend even before they are loaded.
  register('Shortcut removal', () => registerShortcutRemoval(feedManager, gameDetails));

  // Metadata hooks do not depend on window managers or feed configuration.
  register('Game details', () => registerGameDetails(gameDetails));
  const gameDetailsLoading = loadWithRetry('game details', () => gameDetails.load());

  // Feed loading waits for metadata, but does not need Steam's windows.
  void gameDetailsLoading
    .then(() => pluginStopped
      ? undefined
      : loadWithRetry('configuration', () => feedManager.load(),
        () => feedManager.startBackgroundRefresh(activeAppId())))
    .catch(error => log.error('Could not start background refresh', error));

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

      for (const timer of retryTimers)
        clearTimeout(timer);
      retryTimers.clear();

      for (const currentCleanupFunc of cleanups.splice(0).reverse()) {
        try {
          currentCleanupFunc();
        } catch (error) {
          log.error('Cleanup failed', error);
        }
      }

      feedManager.dispose();
      gameDetails.dispose();
    },
  };
});
