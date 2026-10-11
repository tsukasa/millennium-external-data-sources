import { retryInstall } from './retry-install';
import { findModuleExport } from 'millennium';
import type { ReactNode } from 'react';
import { ExternalNewsSource } from '../components/game-properties/external-news-source';
import { ExternalGameDetails } from '../components/game-properties/external-game-details';
import { getPluginI18nString } from '../i18n';
import { isNonSteamId } from './client';
import { MethodHooks } from './method-hooks';
import type { FeedManager } from '../feed/manager';
import type { GameDetailsManager } from '../game-details/manager';

interface Page {
  title: string;
  identifier: string;
  content: ReactNode;
}

interface PagedSettingsProps {
  pages: (Page | string)[];
  page?: string;
  onPageRequested?: (identifier: string) => void;
}

interface PagedSettings {
  render(props: PagedSettingsProps, ref: unknown): ReactNode;
}

interface RoutingContext {
  _currentValue?: { location?: { pathname?: string } } | null;
}

/**
 * Returns the AppID for a Steam shortcut properties page.
 * Steam's route adapter passes these pages to the shared PagedSettings renderer.
 */
function shortcutAppId(pages: PagedSettingsProps['pages']): number | undefined {
  const first = pages[0];

  if (!first || typeof first === 'string' || typeof first.identifier !== 'string')
    return undefined;

  const match = first.identifier.match(/^\/app\/(\d+)\/properties\/shortcut$/);
  const appId = match && Number(match[1]);

  return appId && isNonSteamId(appId) ? appId : undefined;
}

/** Registers the properties pages for Steam's route adapter. */
export function registerProperties(feedManager: FeedManager, gameDetailsManager: GameDetailsManager): () => void {
  const hooks = new MethodHooks();

  const install = () => {
    const settings = findModuleExport(value => value && typeof value === 'object'
      && typeof value.render === 'function'
      && String(value.render).includes('PagedSettingDialog_ContentColumn')
      && String(value.render).includes('onPageRequested')) as PagedSettings | undefined;

    if (!settings)
      return false;

    // React Router names its context "Router"; it is unique among Steam's contexts.
    let routingContext = findModuleExport(value => value?.Provider && value.Consumer
      && value.displayName === 'Router') as RoutingContext | undefined;
    let searchedDuringRender = false;

    hooks.wrap(settings, 'render', (original, _instance, args) => {
      // Keep Steam's hooks on their original component. Adding hooks or moving the
      // renderer to a child would change the state/effect lifecycle of mounted settings.
      const [props] = args;
      const appId = shortcutAppId(props.pages);

      if (!appId)
        return original();

      const identifier = `/app/${appId}/properties/external-data-sources`;

      if (props.pages.some(page => typeof page !== 'string' && page.identifier === identifier))
        return original();

      const page: Page = {
        title: getPluginI18nString('externalDataSources'),
        identifier,
        content: (
          <div className="DialogBody extdatasrc-plugin-page">
            <ExternalNewsSource key={appId} appId={String(appId)} manager={feedManager} />
            <ExternalGameDetails key={`game-details-${appId}`} appId={String(appId)} manager={gameDetailsManager} />
          </div>
        ),
      };

      // Steam's route adapter knows only native tabs and supplies the first tab
      // for our route. Read the provider's current route during this render;
      // the adapter's own router subscription already causes navigation updates.
      // Fallback without the display name: its value is only set during renders. Scan once.
      if (!routingContext && !searchedDuringRender) {
        searchedDuringRender = true;
        routingContext = findModuleExport(value => value?.Provider
          && typeof value._currentValue?.location?.pathname === 'string') as RoutingContext | undefined;
      }

      args[0] = {
        ...props,
        pages: [...props.pages, page],
        page: routingContext?._currentValue?.location?.pathname === identifier ? identifier : props.page,
      };

      return original();
    });

    return true;
  };

  const stopInstalling = retryInstall(install, 250, { name: 'Properties installation' });

  return () => {
    stopInstalling();
    hooks.restore();
  };
}
