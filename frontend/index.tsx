import { definePlugin, IconsModule } from 'millennium';
import { initI18n, getPluginI18nString } from './i18n';
import { registerProperties } from './properties';
import { registerLibrary } from './library';
import { activeAppId, steam } from './steam';
import { Sources } from './sources';
import { registerShortcutRemoval } from './shortcuts';

/**
 * Initializes localization and data sources, then registers the plugin's Steam
 * integrations once the required window managers are available.
 */
export default definePlugin(async () => {
  await initI18n();
  const sources = new Sources();
  let stopped = false;
  const cleanups: (() => void)[] = [];
  const timer = setInterval(() => {
    if (stopped || !steam().MainWindowBrowserManager || !steam().g_PopupManager) return;
    clearInterval(timer);
    try {
      sources
        .load()
        .then(() => {
          if (!stopped) {
            cleanups.push(registerShortcutRemoval(sources));
            void sources.prefetchConfigured(activeAppId());
          }
        })
        .catch(error => console.error('[External Data Sources] Could not load configuration', error));
      cleanups.push(registerProperties(sources));
      cleanups.push(registerLibrary(sources));
    } catch (error) {
      cleanups
        .splice(0)
        .reverse()
        .forEach(cleanup => cleanup());
      console.error('[External Data Sources] Initialization failed', error);
    }
  }, 250);

  return {
    title: getPluginI18nString('externalDataSources'),
    icon: <IconsModule.Settings />,
    content: (
      <div>
        {getPluginI18nString('configureFeedHint')}
      </div>
    ),
    /** Stops initialization and releases all registered integrations and sources. */
    onDismount() {
      stopped = true; clearInterval(timer); cleanups.reverse().forEach(cleanup => cleanup()); sources.dispose();
    },
  };
});
