import { Component, useEffect, useState, type ReactNode } from 'react';
import { feedClasses } from '../classes';
import type { NewsItem } from '../feed';
import { getPluginI18nString } from '../i18n';
import type { NativeNews } from '../native/news';
import type { Sources } from '../sources';
import { loc } from '../steam';

const newsImageStyle = `.external-news-section img.PartnerEventMediumImage_Image {
  aspect-ratio: 16 / 9;
  height: auto;
  object-fit: cover;
}`;

type FeedState = { items?: NewsItem[]; error?: string } | undefined;

class NewsBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? (
      <div role="alert">
        {getPluginI18nString('couldNotLoadNews')}
        {this.state.error}
      </div>
    ) : this.props.children;
  }
}

function ViewLatestNewsAction({ disabled, onRefresh }: { disabled: boolean; onRefresh: () => void }) {
  return (
    <div className={`${feedClasses().ViewLastNews} Panel`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={onRefresh}
      onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onRefresh();
      }
    }}>
      <span>
        {loc('AppActivity_ViewLatestNews', 'View Latest News')}
      </span>
    </div>
  );
}

export function NewsSection({ appId, url, sources, revision, native }: {
  appId: string; url: string; sources: Sources; revision: number; native: NativeNews;
}) {
  const [state, setState] = useState<FeedState>();
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let current = true;
    setState(previous => previous?.items ? { items: previous.items } : undefined);
    sources.cache.get(appId, url).then(items => {
      if (current) { setState({ items }); setRefreshing(false); }
    }).catch(error => {
      if (current) {
        setState(previous => ({ items: previous?.items, error: error instanceof Error ? error.message : String(error) }));
        setRefreshing(false);
      }
    });
    return () => { current = false; };
  }, [appId, url, sources, revision, attempt]);

  const refresh = () => {
    if (refreshing || !state) return;
    sources.cache.invalidate(url);
    setRefreshing(true);
    setAttempt(value => value + 1);
  };

  return (
    <NewsBoundary key={`${appId}:${url}:${revision}`}>
      <native.Section appId={appId} action={<ViewLatestNewsAction disabled={refreshing || !state} onRefresh={refresh} />}>
        <style>{newsImageStyle}</style>
        {!state && <div role="status">{getPluginI18nString('loadingNews')}</div>}
        {state?.error !== undefined && <div role="alert">
          {getPluginI18nString('couldNotLoadNews')} {state.error}
          <button type="button" className="DialogButton" onClick={refresh}>{getPluginI18nString('retry')}</button>
        </div>}
        {state?.items && (state.items.length ? <native.Feed appId={appId} items={state.items} />
          : <div role="status">{getPluginI18nString('noNews')}</div>)}
      </native.Section>
    </NewsBoundary>
  );
}
