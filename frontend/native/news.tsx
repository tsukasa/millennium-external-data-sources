import { Component, cloneElement, createElement, isValidElement, useEffect, useId, useMemo, type ComponentClass, type ComponentType, type ReactNode } from 'react';
import type { NewsItem } from '../feed';
import { openArticle, steam } from '../steam';
import type { NativeBindings } from './discovery';

export interface NativeNews {
  Section: ComponentType<{ appId: string; children: ReactNode; action?: ReactNode }>;
  Feed: ComponentType<{ appId: string; items: NewsItem[] }>;
}

export function mapElements(tree: any, replace: (node: any) => any): any {
  if (Array.isArray(tree)) return tree.map(node => mapElements(node, replace));
  if (!isValidElement<{ children?: ReactNode }>(tree)) return tree;
  const children = mapElements(tree.props.children, replace);
  const node = tree.props.children === undefined ? tree : cloneElement(tree, undefined,
    ...(Array.isArray(children) ? children : [children]));
  return replace(node);
}

/** MobX installs a non-writable render on the native instance on its first call.
 * Compose with that instance so subsequent renders still pass through our adapter.
 * Its fetch/post lifecycle is deliberately not mounted; release its observer on exit.
 */
function adaptClass(Native: ComponentClass<any>, transform: (tree: any, props: any) => any): ComponentClass<any> {
  class Adapted extends Component<any> {
    private native = new Native(this.props);
    componentWillUnmount() { this.native.componentWillUnmount?.(); }
    render() {
      Object.assign(this.native, { props: this.props, context: this.context });
      return transform(this.native.render(), this.props);
    }
  }
  if (Native.contextType) Adapted.contextType = Native.contextType;
  return Adapted;
}

/** Models are private to this feed; never register synthetic IDs in Steam's stores. */
export function createActivityDays(native: NativeBindings, appId: string, items: NewsItem[], client: any) {
  const groups = new Map<string, any>();
  items.forEach((item, index) => {
    const model = new native.EventModel();
    // Steam normally generates a short card summary. Supplying the full RSS
    // article here makes its UpdateLineCount repeatedly lay out thousands of
    // characters per card and can stall the library for many seconds.
    const summary = native.EventModel.GenerateSummaryFromText(item.contents);
    model.GID = `external-news:${appId}:${item.gid}`;
    model.appid = Number(appId);
    model.type = 28; // Steam's News event category (not an update or patch).
    model.name = new Map([[native.language, item.title], [0, item.title]]);
    model.description = new Map([[native.language, item.contents], [0, item.contents]]);
    model.jsondata = {
      ...model.jsondata,
      localized_summary: Object.assign([], { [native.language]: summary, 0: summary }),
      localized_capsule_image: Object.assign([], { [native.language]: item.image, 0: item.image }),
    };
    model.postTime = item.date ?? 0;
    model.rtime32_moderator_reviewed = model.postTime;
    // A fresh, private query result prevents the original image hook's store/clan
    // fallback requests, including for articles without an image.
    client.setQueryData(native.imageQueryKey.map(value => value === native.probeGid ? model.GID : value),
      item.image ? [item.image] : []);
    const event = new native.ActivityEvent(model.postTime, model.clanSteamID, model.GID, model.postTime, appId);
    Object.defineProperty(event, 'eventModel', { value: model });
    event.GetEvent = async () => model;
    event.ReloadEvent = async () => model;
    event.externalNewsItem = item;
    event.unUniqueID = `external-news:${appId}:${index}:${item.gid}`;
    const date = item.date === null ? null : new Date(item.date * 1000);
    const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'undated';
    let day = groups.get(key);
    if (!day) {
      day = { key, undated: !date, events: [], isValid: true, GetLatestEventTime: () => item.date ?? 0 };
      groups.set(key, day);
    }
    day.events.push(event);
  });
  return [...groups.values()];
}

/** Reuse Steam's render methods; replace only data loading and Steam-only actions. */
export function createNativeNews(native: NativeBindings): NativeNews {
  let nextFeed = 0;
  const Section = adaptClass(native.Section, (tree, props) => {
    const content = mapElements(tree, node => node.type === native.PostTextEntry
      // Keep Steam's native activity panel styling, but never mount its input,
      // event handlers, or post controls for an external shortcut.
      ? <div className={native.postTextEntryClassName} style={{ position: 'relative', height: 64, padding: 0 }}>
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
            {props.action}
          </div>
        </div>
      : typeof node.props.ShowMoreContent === 'function' ? props.children : node);
    return cloneElement(content, { className: `${content.props.className} external-news-section` });
  });

  const Rating = adaptClass(native.Rating, tree =>
    cloneElement(tree, { inert: true, 'aria-hidden': true, style: { ...tree.props.style, visibility: 'hidden' } }));

  class Visibility extends native.Visibility {
    OnVisible() {} // Keep the native Panel wrapper without recording Steam impressions.
  }

  class Summary extends native.Summary {
    // Steam's stylesheet already clamps this summary to three lines. Its mount
    // measurement rewrites innerHTML up to ten times and forces layout for every
    // card, blocking the library thread for seconds on larger external feeds.
    UpdateLineCount() {}
  }

  function Card({ event }: { event: any }) {
    // Calling this stable function in a React component preserves its native hooks.
    const tree = native.Card({ event: event.eventModel, featuredSpot: false });
    const item: NewsItem = event.externalNewsItem;
    const children = mapElements(tree.props.children, node => node.type === native.Summary
      ? createElement(Summary, { ...node.props, key: node.key ?? undefined })
      : typeof node.props.onActivate === 'function'
      ? cloneElement(node, { onActivate: (activation: any) => {
        const doc = activation?.currentTarget?.ownerDocument
          || steam().g_PopupManager?.GetExistingPopup('SP Desktop_uid0')?.window?.document || document;
        openArticle(doc, item.url);
      } }) : node);
    return createElement(Visibility, { ...tree.props, children });
  }

  const Announcement = adaptClass(native.Announcement, (tree, props) =>
      mapElements(tree, node => {
        if (node.type === native.Loader) return <Card key={node.key ?? undefined} event={props.event} />;
        if (node.type === native.Rating) return createElement(Rating, {
          ...node.props, key: node.key ?? undefined, bIsVisible: false, upvotes: 0, comment_count: 0,
          fnOnRateDownClicked: undefined, fnOnRateUpClicked: undefined, fnMaximizeParent: undefined,
        });
        if (node.props.onMenuButton) return cloneElement(node, {
          onMenuButton: undefined, onMenuActionDescription: undefined,
        });
        if ('placeholderHeight' in node.props) return cloneElement(node, {
          onMouseEnter: undefined, onMouseLeave: undefined, onFocus: undefined, onBlur: undefined,
        });
        return node;
      }));

  const Day = adaptClass(native.Day, (original, props) => {
      const tree = mapElements(original, node => node.props.event?.externalNewsItem
        ? createElement(Announcement, { ...node.props, key: node.key ?? undefined, featuredSpot: false, className: native.eventClassName }) : node);
      if (!tree || !props.day.undated) return tree;
      // Feeds can omit dates. Preserve the native day contents without inventing one.
      return cloneElement(tree, { 'aria-labelledby': undefined }, tree.props.children.slice(1));
  });

  function NewsDay({ day }: { day: any }) {
    return createElement(Day, { day, labelId: useId(), rollup: false });
  }

  return {
    Section: ({ appId, children, action }) => createElement(Section, {
      appid: Number(appId), showTextBox: true, nDaysToDisplay: 1, setDaysToDisplay: () => {}, children, action,
    }),
    Feed: function Feed({ appId, items }) {
      const state = useMemo(() => {
        const client = new native.QueryClient({ defaultOptions: { queries: {
          staleTime: Infinity, gcTime: Infinity, retry: false,
          refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
        } } });
        return { key: ++nextFeed, client, days: createActivityDays(native, appId, items, client) };
      }, [appId, items]);
      useEffect(() => () => state.client.clear(), [state]);
      const days = native.Days({ rgDays: state.days, rollup: false, nMaxItemsToDisplayInLastDay: 0 });
      // Query observers retain the client from their first mount. Remount them
      // when replacing the private cache, before the previous cache is cleared.
      return createElement(native.QueryProvider, { key: state.key, client: state.client },
        mapElements(days, node => node.props.day
          ? <NewsDay key={node.props.day.key} day={node.props.day} /> : node));
    },
  };
}
