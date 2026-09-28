import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appSectionClasses, feedClasses, sectionHeaderClasses } from '../classes';
import type { NewsItem } from '../feed';
import { getPluginI18nString } from '../i18n';
import { observeNewsSummaries, renderNewsFeed } from '../news';
import { loc } from '../steam';
import type { Sources } from '../sources';

type FeedState = { items: NewsItem[]; error?: never } | { error: string; items?: never } | undefined;

export function NewsSection({ appId, url, sources, revision }: {
  appId: string; url: string; sources: Sources; revision: number;
}) {
  const [state, setState] = useState<FeedState>();
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const section = appSectionClasses(), feed = feedClasses(), header = sectionHeaderClasses();
  const headingId = `external-news-section-${appId}-heading`;

  useEffect(() => {
    let current = true;
    setState(undefined);
    sources.cache.get(appId, url).then(items => {
      if (current) setState({ items });
    }).catch(error => {
      if (current) setState({ error: error instanceof Error ? error.message : String(error) });
    });
    return () => { current = false; };
  }, [appId, url, sources, revision, attempt]);

  // React owns the section; the existing card renderer owns only this panel.
  useLayoutEffect(() => {
    const target = panel.current;
    if (!target || !state?.items) return;
    target.replaceChildren(...Array.from(renderNewsFeed(target.ownerDocument, state.items).childNodes));
    const stop = observeNewsSummaries(target);
    return () => { stop(); target.replaceChildren(); };
  }, [state]);

  return (
    <div data-external-news={appId}
      className={`${section.AppDetailsSection} AppDetailsSection ${feed.ActivityFeedContainer} ActivityFeedContainer Panel`}
      style={{ maxWidth: '65%' }}
      role="region"
      aria-labelledby={headingId}>

      <h2 id={headingId} className={`${header.Reset} Reset ${header.PadLeft} PadLeft ${header.SectionHeader} SectionHeader`}>
        <div className={`${header.Label} Label`}>
          <div className={`${header.LabelText} LabelText`}>
            {loc('AppDetails_SectionTitle_Activity', getPluginI18nString('activity'))}
          </div>
        </div>
        <div />
      </h2>

      <div className={`${section.AppDetailsSectionContainer} AppDetailsSectionContainer ${section.AppDetailsSectionHasLabel} AppDetailsSectionHasLabel Panel`}>
        <div className={`${section.Body} Body ${section.InnerContainer} InnerContainer`}>
          {/* Keep the native Activity box and its spacing without a post input. */}
          <div className={`${feed.PostTextEntryBox} PostTextEntry ${feed.AddToFeed} AddToFeed ${feed.PostTextEntry} PostTextEntry Panel`}
            aria-hidden="true" inert />
          {!state && (
            <div className="Panel"><div role="status">{getPluginI18nString('loadingNews')}</div></div>
          )}
          {state?.error !== undefined && (
            <div className="Panel" role="alert">
              {getPluginI18nString('couldNotLoadNews')} {state.error}
              <button className="DialogButton" onClick={() => setAttempt(value => value + 1)}>{getPluginI18nString('retry')}</button>
            </div>
          )}
          {state?.items && (
            <div className="Panel" ref={panel} />
          )}
        </div>
      </div>
    </div>
  );
}
