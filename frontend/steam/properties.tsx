import { findModuleExport } from 'millennium';
import { useState, type ReactNode } from 'react';
import { ExternalNewsSource } from '../components/game-properties/external-news-source';
import { ExternalReleaseDate } from '../components/game-properties/external-release-date';
import { getPluginI18nString } from '../i18n';
import { isNonSteamId } from './client';
import type { FeedManager } from '../feed/manager';
import type { ReleaseDateManager } from '../release-date/manager';

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

/**
 * Returns the AppID for a Steam shortcut properties page.
 * Steam's route adapter passes these pages to the shared PagedSettings renderer.
 * @returns The AppID if it exists and is a non-Steam ID, otherwise undefined.
 */
function shortcutAppId(pages: PagedSettingsProps['pages']): number | undefined {
  const first = pages[0];

  if (!first || typeof first === 'string' || typeof first.identifier !== 'string')
    return undefined;

  const match = first.identifier.match(/^\/app\/(\d+)\/properties\/shortcut$/);
  const appId = match && Number(match[1]);

  return appId && isNonSteamId(appId) ? appId : undefined;
}

/**
 * Registers the properties pages for Steam's route adapter.
 * @param feedManager The manager responsible for handling external news feeds.
 * @param releaseDateManager The manager responsible for handling external release dates.
 * @returns A function to restore the original settings renderer.
 */
export function registerProperties(feedManager: FeedManager, releaseDateManager: ReleaseDateManager): () => void {
  let restore: (() => void) | undefined;

  const install = () => {
    const settings = findModuleExport(value => value && typeof value === 'object'
      && typeof value.render === 'function'
      && String(value.render).includes('PagedSettingDialog_ContentColumn')
      && String(value.render).includes('onPageRequested')) as PagedSettings | undefined;

    if (!settings)
      return false;

    const original = settings.render;
    let stopped = false;

    const render: PagedSettings['render'] = function(props, ref) {
      // This hook runs for every PagedSettings render so React's hook order stays stable.
      const [selectedPluginPage, selectPluginPage] = useState<string>();

      if (stopped)
        return original(props, ref);

      const appId = shortcutAppId(props.pages);
      if (!appId)
        return original(props, ref);

      const identifier = `/app/${appId}/properties/external-data-sources`;
      if (props.pages.some(page => typeof page !== 'string' && page.identifier === identifier))
        return original(props, ref);

      const page: Page = {
        title: getPluginI18nString('externalDataSources'),
        identifier,
        content: (
          <div className="DialogBody">
            <ExternalNewsSource key={appId} appId={String(appId)} manager={feedManager} />
            <ExternalReleaseDate key={`release-date-${appId}`} appId={String(appId)} manager={releaseDateManager} />
          </div>
        ),
      };

      return original({
        ...props,
        pages: [...props.pages, page],
        page: selectedPluginPage === identifier ? identifier : props.page,
        onPageRequested: requested => {
          selectPluginPage(requested === identifier ? identifier : undefined);
          props.onPageRequested?.(requested);
        },
      }, ref);
    };

    settings.render = render;

    restore = () => {
      stopped = true;
      if (settings.render === render)
        settings.render = original;
    };

    return true;
  };

  const installTimer = install() ? undefined : setInterval(() => {
    if (install())
      clearInterval(installTimer);
  }, 250);

  return () => {
    clearInterval(installTimer);
    restore?.();
  };
}
