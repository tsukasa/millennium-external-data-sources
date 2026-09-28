// App-properties registration ported from steam-non-steam-playtimes.
import { beforePatch } from 'millennium';
import type { ReactNode } from 'react';
import { ExternalNewsSource } from './components/external-news-source';
import { getPluginI18nString } from './i18n';
import { isNonSteamId } from './steam';
import type { Sources } from './sources';

export const PLUGIN_PROPERTIES_ROUTE = '/app/:appid/properties/external-data-sources';

interface Page {
  title: string;
  route: string;
  link: string;
  content: ReactNode;
}

function isPage(value: unknown): value is Page {
  return typeof value === 'object' &&
    value !== null &&
    'route' in value &&
    typeof value.route === 'string' &&
    value.route.startsWith('/app/:appid/properties/');
}

export function registerProperties(sources: Sources): () => void {
  const added = new Map<Page[], Page>();
  const patch = beforePatch(Array.prototype, 'map', function(this: Page[]) {
    if (!this.length || this.length > 20 ||
        !isPage(this[0]) || typeof this[0].link !== 'string' ||
        !this.every(isPage) ||
        this.some(page => page.route === PLUGIN_PROPERTIES_ROUTE))
      return;

    const appId = Number(this[0].link.split('/')[2]);

    if (!isNonSteamId(appId))
      return;

    const page: Page = {
      title: getPluginI18nString('externalDataSources'),
      route: PLUGIN_PROPERTIES_ROUTE,
      link: `/app/${appId}/properties/external-data-sources`,
      content: (
        <div className="DialogBody">
          <ExternalNewsSource key={appId} appId={String(appId)} sources={sources} />
        </div>
      ),
    };

    this.push(page);
    added.set(this, page);
  });

  return () => {
    patch.unpatch();
    added.forEach((page, pages) => {
      const index = pages.indexOf(page);

      if (index >= 0)
        pages.splice(index, 1);
    });
    added.clear();
  };
}
