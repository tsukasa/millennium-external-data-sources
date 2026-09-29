import { Component, useEffect, useState, type ReactNode } from 'react';
import type { NewsItem } from '../feed';
import { getPluginI18nString } from '../i18n';
import type { NativeNews } from '../native/news';
import type { Sources } from '../sources';

type FeedState = { items: NewsItem[]; error?: never } | { error: string; items?: never } | undefined;

class NewsBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <div role="alert">{getPluginI18nString('couldNotLoadNews')} {this.state.error}</div> : this.props.children;
  }
}

export function NewsSection({ appId, url, sources, revision, native }: {
  appId: string; url: string; sources: Sources; revision: number; native: NativeNews;
}) {
  const [state, setState] = useState<FeedState>();
  const [attempt, setAttempt] = useState(0);
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

  return <NewsBoundary key={`${appId}:${url}:${revision}:${attempt}`}>
    <native.Section appId={appId}>
      {!state && <div role="status">{getPluginI18nString('loadingNews')}</div>}
      {state?.error !== undefined && <div role="alert">
        {getPluginI18nString('couldNotLoadNews')} {state.error}
        <button className="DialogButton" onClick={() => setAttempt(value => value + 1)}>{getPluginI18nString('retry')}</button>
      </div>}
      {state?.items && (state.items.length ? <native.Feed appId={appId} items={state.items} />
        : <div role="status">{getPluginI18nString('noNews')}</div>)}
    </native.Section>
  </NewsBoundary>;
}
