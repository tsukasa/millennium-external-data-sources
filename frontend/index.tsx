import { definePlugin, IconsModule } from 'millennium';
import { initI18n, getPluginI18nString } from './i18n';
import { registerProperties } from './steam/properties';
import { registerLibrary } from './steam/library';
import { activeAppId, steam } from './steam/client';
import { FeedManager } from './feed/manager';
import { ReleaseDateManager } from './release-date/manager';
import { registerReleaseDates } from './steam/release-date-store';
import { registerShortcutRemoval } from './steam/shortcut-removal';
import { PluginConfiguration } from './components/plugin-configuration';

/**
 * Initializes localization and data managers, then registers the plugin's Steam
 * integrations once the required window managers are available.
 */
export default definePlugin(async () => {
  await initI18n();

  let pluginStopped = false;

  const feedManager = new FeedManager();
  const releaseDates = new ReleaseDateManager();

  const cleanups: (() => void)[] = [];

  const initializationTimer = setInterval(() => {
    if (pluginStopped || !steam().MainWindowBrowserManager || !steam().g_PopupManager)
      return;

    clearInterval(initializationTimer);

    let feedManagerLoading: Promise<void>;
    let releaseDateLoading: Promise<void>;

    try {
      feedManagerLoading = feedManager.load();
      releaseDateLoading = releaseDates.load();
    } catch (error) {
      console.error('[External Data Sources] Initialization of managers failed', error);
      return;
    }

    void Promise.allSettled([feedManagerLoading, releaseDateLoading]).then(() => {
      if (!pluginStopped)
        register('Shortcut removal', () => registerShortcutRemoval(feedManager, releaseDates));
    });

    void feedManagerLoading
      .then(() => {
        if (!pluginStopped)
          feedManager.startBackgroundRefresh(activeAppId());
      })
      .catch(error => console.error('[External Data Sources] Could not load configuration', error)
    );

    void releaseDateLoading
      .catch(error => console.error('[External Data Sources] Could not load release dates', error));

    register('Library', () => registerLibrary(feedManager));
    register('Release dates', () => registerReleaseDates(releaseDates));
    register('Properties', () => registerProperties(feedManager, releaseDates));
  }, 250);

  const register = (name: string, install: () => () => void) => {
    try {
      cleanups.push(install());
    } catch (error) {
      console.error(`[External Data Sources] ${name} initialization failed`, error);
    }
  };

  return {
    title: getPluginI18nString('externalDataSources'),
    icon: <IconsModule.Settings />,
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
      releaseDates.dispose();
    },
  };
});
