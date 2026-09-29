import { applyHookStubs, findModuleExport, removeHookStubs } from 'millennium';
import type { ComponentClass } from 'react';

// Steam's private component/model boundary. Discover by capabilities and returned
// elements: webpack IDs and minified function names change between client builds.
export interface NativeBindings {
  Section: ComponentClass<any>;
  PostTextEntry: ComponentClass<any>;
  postTextEntryClassName: string;
  Day: ComponentClass<any>;
  Days: any;
  Announcement: ComponentClass<any>;
  Loader: any;
  Card: any;
  Summary: ComponentClass<any>;
  Rating: ComponentClass<any>;
  Visibility: ComponentClass<any>;
  eventClassName: string;
  EventModel: any;
  ActivityEvent: any;
  QueryClient: any;
  QueryProvider: any;
  imageQueryKey: unknown[];
  probeGid: string;
  language: number;
}

export function findElement(tree: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  } else if (tree?.props) {
    if (predicate(tree)) return tree;
    return findElement(tree.props.children, predicate);
  }
  return undefined;
}

function requireElement(tree: any, predicate: (node: any) => boolean) {
  const element = findElement(tree, predicate);
  if (!element) throw new Error('Steam activity component structure changed');
  return element;
}

function render(element: any): any {
  const type = element.type.type || element.type;
  return type.prototype?.render ? new type(element.props).render() : type(element.props);
}

/** Synchronous, unmounted discovery. No effects, network fetches or live store writes. */
export function discoverNativeNews(): NativeBindings {
  const Activity = findModuleExport(value => typeof value === 'function'
    && String(value).includes('AppDetailsActivitySectionDays'));
  const EventModel = findModuleExport(value => value?.prototype?.GetSummaryWithFallback
    && value?.prototype?.GetNameWithFallback);
  const ActivityEvent = findModuleExport(value => value?.prototype?.IsEventLoaded
    && value?.prototype?.ReloadEvent);
  const sharedClient = findModuleExport(value => value && typeof value.getQueryCache === 'function');
  const QueryProvider = findModuleExport(value => typeof value === 'function'
    && String(value).includes('.mount()') && String(value).includes('.unmount()')
    && String(value).includes('.Provider'));
  const store = (window as any).appActivityStore;
  if (!Activity || !EventModel || typeof EventModel.GenerateSummaryFromText !== 'function'
    || !ActivityEvent || !sharedClient || !QueryProvider || !store)
    throw new Error('Steam native news components are not available');

  const client = new sharedClient.constructor({ defaultOptions: { queries: { retry: false } } });
  const probeGid = 'external-news-discovery';
  const model = new EventModel();
  model.GID = probeGid;
  const event = new ActivityEvent(1, model.clanSteamID, probeGid, 1, '0');
  event.IsEventLoaded = () => true;
  const day = { events: [event], isValid: true, GetLatestEventTime: () => 1 };
  const activity = { appActivityByDay: [day], lastAddedPartnerEvent: null, m_bNoMoreHistoryAvailable: true };
  const originalDescriptor = Object.getOwnPropertyDescriptor(store, 'GetAppActivity');
  const original = store.GetAppActivity;
  // Router hooks and QueryClient hooks have undefined defaults outside a render.
  const context = new Proxy(client, { get(target, key) {
    if (key === 'location') return { state: {}, pathname: '/library/home' };
    if (key === 'history') return { location: { state: {} } };
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } });
  const refs: any[] = [];
  const observers: any[] = [];
  let dispatcher: any;
  let extraHooks: any;
  try {
    store.GetAppActivity = function (appid: number) {
      return appid === 0 ? activity : original.call(this, appid);
    };
    dispatcher = applyHookStubs();
    // Millennium restores only its built-in hook list; restore extra hooks ourselves.
    extraHooks = { useId: dispatcher.useId, useSyncExternalStore: dispatcher.useSyncExternalStore };
    Object.assign(dispatcher, {
      useRef: (value: any) => { const ref = { current: value }; refs.push(ref); return ref; },
      useContext: (value: any) => value._currentValue?.getQueryCache ? client : value._currentValue ?? context,
      useMemo: (fn: () => any) => fn(),
      useState: (value: any) => {
        const state = typeof value === 'function' ? value() : value;
        if (state?.getOptimisticResult && state?.destroy) observers.push(state);
        return [state, () => {}];
      },
      useSyncExternalStore: (_subscribe: any, snapshot: () => any) => snapshot(),
      useId: () => ':external-news-discovery:',
    });
    const section = Activity({ appid: 0, showTextBox: true });
    const sectionTree = render(section);
    const postTextEntry = requireElement(sectionTree, node =>
      typeof node.props.OnPostClicked === 'function' && typeof node.props.placeholder === 'string');
    const postTextEntryTree = render(postTextEntry);
    if (typeof postTextEntryTree.props.className !== 'string')
      throw new Error('Steam activity text box structure changed');
    const feed = requireElement(sectionTree, node => typeof node.props.ShowMoreContent === 'function');
    const days = requireElement(render(feed), node => node.props.rgDays);
    const dayWrapper = requireElement(render(days), node => node.props.day === day);
    const dayElement = render(dayWrapper);
    const eventWrapper = requireElement(render(dayElement), node => node.props.event === event);
    const announcement = render(eventWrapper);
    const announcementTree = render(announcement);
    const loader = requireElement(announcementTree, node => node.props.event === event);
    const rating = requireElement(announcementTree, node => 'bIsVisible' in node.props && 'upvoters' in node.props);
    const loaderInstance = new loader.type(loader.props);
    // Bypass the async event loader; never ask Steam to load the synthetic GID.
    loaderInstance.m_ldrEvent = { state: 'fulfilled', value: model };
    const card = loaderInstance.render();
    const cardTree = render(card);
    requireElement(cardTree, node => typeof node.props.onActivate === 'function');
    const summary = requireElement(cardTree, node =>
      typeof node.type?.prototype?.UpdateLineCount === 'function');
    if (cardTree.props.event !== model || !cardTree.props.children)
      throw new Error('Steam news visibility wrapper changed');
    const imageQueryKey = client.getQueryCache().getAll()
      .map((query: any) => query.queryKey as unknown[])
      .find((key: unknown[]) => key.includes(probeGid) && key.includes('capsule'));
    if (!imageQueryKey || typeof imageQueryKey[3] !== 'number')
      throw new Error('Steam news image query changed');
    return {
      Section: section.type, PostTextEntry: postTextEntry.type,
      postTextEntryClassName: `${postTextEntryTree.props.className} Panel`,
      Day: dayElement.type, Days: days.type, Announcement: announcement.type,
      Loader: loader.type, Card: card.type, Summary: summary.type, Rating: rating.type,
      Visibility: cardTree.type, eventClassName: announcement.props.className,
      EventModel, ActivityEvent, QueryClient: sharedClient.constructor, QueryProvider,
      imageQueryKey, probeGid, language: imageQueryKey[3],
    };
  } finally {
    if (originalDescriptor) Object.defineProperty(store, 'GetAppActivity', originalDescriptor);
    else delete store.GetAppActivity;
    if (dispatcher) {
      Object.assign(dispatcher, extraHooks);
      removeHookStubs();
    }
    refs.forEach(ref => ref.current?.reaction?.dispose());
    observers.forEach(observer => observer.destroy());
    client.clear();
  }
}
