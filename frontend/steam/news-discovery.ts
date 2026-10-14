import { applyHookStubs, findInReactTree, findModuleExport, removeHookStubs } from 'millennium';
import type {
  ActivityComponent, NativeActivityProps, NativeEventModelConstructor, NativeActivityEventConstructor, QueryDataClient
} from './news-types';
import type { ComponentClass } from 'react';
import { steam } from './client';
import { MethodHooks } from './method-hooks';

interface NativeActivityComponentClass extends ComponentClass<NativeActivityProps> {
  prototype: ActivityComponent;
}

// Steam's private component/model boundary. Discover by capabilities and returned
// elements: webpack IDs and minified function names change between client builds.
export interface NativeBindings {
  Section: NativeActivityComponentClass;
  PostTextEntry: NativeActivityComponentClass;
  Announcement: NativeActivityComponentClass;
  EventModel: NativeEventModelConstructor;
  ActivityEvent: NativeActivityEventConstructor;
  sharedClient: QueryDataClient;
  imageQueryKey: unknown[];
  probeGid: string;
  language: number;
}

/** Steam has not loaded the modules yet; discovery can be retried cheaply. */
export class NativeNewsUnavailableError extends Error {}

/** Upper bound for components rendered while searching a card for its image query. */
const MAX_CARD_RENDERS = 400;

/** Upper bound for wrappers (observers, memo) around the announcement class. */
const MAX_ANNOUNCEMENT_WRAPPERS = 5;

/**
 * Require a React element in the tree that matches the given predicate.
 * Throws an error naming the missing element, so logs show which step changed.
 */
function requireElement(tree: any, description: string, predicate: (props: any) => boolean) {
  // Millennium's search also visits props objects and arrays; only elements qualify.
  const element = findInReactTree(tree, node => !!node?.type && !!node.props && predicate(node.props));

  if (!element)
    throw new Error(`Steam activity component structure changed: ${description} not found`);

  return element;
}

/** The component behind memo and forwardRef wrappers. */
function componentType(element: any): any {
  const type = element.type;
  return typeof type === 'object' && type !== null && type.type ? type.type : type;
}

/** Render a React element to its output. */
function render(element: any, prepare?: (instance: any) => void): any {
  const type = componentType(element);

  if (type.prototype?.render) {
    const instance = new type(element.props);
    prepare?.(instance);
    return instance.render();
  }

  // forwardRef components keep their render function on the wrapper object.
  return typeof type === 'function'
    ? type(element.props)
    : type.render(element.props, null);
}

/** Whether an element is a component that can be rendered without mounting. */
function isComponent(element: any): boolean {
  const type = element && typeof element === 'object' && element.props ? componentType(element) : undefined;
  return typeof type === 'function' || typeof type?.render === 'function';
}

/** Find Steam modules by behavior instead of build-specific names or IDs. */
function findNativeModules() {
  /* Activity module */
  const Activity = findModuleExport(value => typeof value === 'function'
    && String(value).includes('AppDetailsActivitySectionDays'));

  if (!Activity)
    throw new NativeNewsUnavailableError('Steam native news components are not available: Activity');

  /* ActivityEvent module */
  const ActivityEvent = findModuleExport(value => value?.prototype?.IsEventLoaded && value?.prototype?.ReloadEvent);

  if (!ActivityEvent)
    throw new NativeNewsUnavailableError('Steam native news components are not available: ActivityEvent');

  /* EventModel module */
  const EventModel = findModuleExport(value => value?.prototype?.GetSummaryWithFallback
    && value?.prototype?.GetNameWithFallback);

  if (!EventModel)
    throw new NativeNewsUnavailableError('Steam native news components are not available: EventModel');

  /* sharedClient module */
  const sharedClient = findModuleExport(value => value && typeof value.getQueryCache === 'function');

  if (!sharedClient)
    throw new NativeNewsUnavailableError('Steam native news components are not available: sharedClient');

  /* store */
  const store = steam().appActivityStore;

  if (!store)
    throw new NativeNewsUnavailableError('Steam native news components are not available: store');

  return { Activity, EventModel, ActivityEvent, sharedClient, store };
}

/** Gives Steam's activity tree an already-loaded, synthetic event to render. */
function createProbe(EventModel: NativeEventModelConstructor, ActivityEvent: NativeActivityEventConstructor) {
  const probeGid = 'external-news-discovery';
  const model = new EventModel();

  model.GID = probeGid;

  const event = new ActivityEvent(1, model.clanSteamID, probeGid, 1, '0');
  event.IsEventLoaded = () => true;

  const day = {
    events: [event],
    isValid: true,
    GetLatestEventTime: () => 1
  };

  const activity = {
    appActivityByDay: [day],
    lastAddedPartnerEvent: null,
    m_bNoMoreHistoryAvailable: true
  };

  return {
    probeGid,
    model,
    event,
    day,
    activity
  };
}

/**
 * Lazy-render boundaries (`{ enabled }`) only show their children once scrolled into view.
 * An unmounted probe is never visible, so it renders them eagerly.
 */
const isLazyRenderContext = (value: any) => !!value && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype && typeof value.enabled === 'boolean';

/** Stand-in for contexts whose default is undefined because no provider is mounted. */
function createProviderStandIn(client: any) {
  return new Proxy(client, {
    get(target, key) {
      // Router hooks.
      if (key === 'location')
        return { state: {}, pathname: '/library/home' };

      if (key === 'history')
        return { location: { state: {} } };

      if (key in target) {
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      // Service providers expose hooks such as `useActiveSteamInterface`; without
      // a mounted provider there is no service, and the probe must not reach one.
      if (typeof key === 'string' && /^use[A-Z]/.test(key))
        return () => undefined;

      return undefined;
    }
  });
}

function installProbeHookStubs(client: any): () => void {
  const standIn = createProviderStandIn(client);
  const refs: any[] = [];
  const observers: any[] = [];
  let dispatcher: any;
  let extraHooks: any;
  const restore = () => {
    if (dispatcher) {
      Object.assign(dispatcher, extraHooks);
      removeHookStubs();
    }
    refs.forEach(ref => ref.current?.reaction?.dispose());
    observers.forEach(observer => observer.destroy());
  };

  try {
    dispatcher = applyHookStubs();

    // Millennium restores only its built-in hook list; restore extra hooks ourselves.
    extraHooks = {
      useId: dispatcher.useId,
      useSyncExternalStore: dispatcher.useSyncExternalStore
    };

    Object.assign(dispatcher, {
      useRef: (value: any) => {
        const ref = { current: value };
        refs.push(ref);
        return ref;
      },

      useContext: (value: any) => {
        const current = value._currentValue;

        if (current?.getQueryCache)
          return client;

        // Only undefined defaults lack a provider; null is a valid default
        // (e.g. gamepad navigation outside a focus tree).
        if (current === undefined)
          return standIn;

        return isLazyRenderContext(current)
          ? { ...current, enabled: false }
          : current;
      },

      useMemo: (fn: () => any) => fn(),

      useState: (value: any) => {
        const state = typeof value === 'function'
          ? value()
          : value;

        if (state?.getOptimisticResult && state?.destroy)
          observers.push(state);

        return [state, () => {}];
      },

      useSyncExternalStore: (_subscribe: any, snapshot: () => any) => snapshot(),

      useId: () => ':external-news-discovery:',
    });
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

/** Temporarily supply the stores and hooks needed for an unmounted probe render. */
function withProbeEnvironment(store: any, client: any, activity: any, inspect: () => NativeBindings): NativeBindings {
  const hooks = new MethodHooks();

  let restoreStubs: (() => void) | undefined;
  try {
    hooks.wrap(store, 'GetAppActivity', (original, _instance, [appId]) => appId === 0 ? activity : original());
    restoreStubs = installProbeHookStubs(client);
    return inspect();
  } finally {
    hooks.restore();
    restoreStubs?.();
    client.clear();
  }
}

/** Walk the activity panel down to the event card without mounting it. */
function inspectActivityTree(Activity: any, day: any, event: any) {
  const section = Activity({ appid: 0, showTextBox: true });

  const sectionTree = render(section);

  const postTextEntry = requireElement(sectionTree, 'post text entry', props =>
    typeof props.OnPostClicked === 'function' && typeof props.placeholder === 'string');

  const feed = requireElement(sectionTree, 'activity feed', props => typeof props.ShowMoreContent === 'function');

  const days = requireElement(render(feed), 'day list', props => props.rgDays);

  const dayWrapper = requireElement(render(days), 'probe day', props => props.day === day);

  const dayElement = render(dayWrapper);

  const eventWrapper = requireElement(render(dayElement), 'probe event', props => props.event === event);

  // Steam wraps the announcement class in observers that supply its votes;
  // its actions and lifecycle live on the class.
  let announcement = render(eventWrapper);
  for (let wrappers = 0; !componentType(announcement)?.prototype?.render; wrappers++) {
    if (wrappers >= MAX_ANNOUNCEMENT_WRAPPERS)
      throw new Error('Steam activity component structure changed: announcement class not found');
    announcement = requireElement(render(announcement), 'announcement', props => props.event === event);
  }

  const card = requireElement(render(announcement), 'event card', props => props.event === event);

  return {
    section,
    postTextEntry,
    announcement,
    card
  };
}

/** Find the image query key for a given probe GID. */
function findImageQueryKey(client: any, probeGid: string): unknown[] | undefined {
  return client
    .getQueryCache()
    .getAll()
    .map((query: any) => query.queryKey as unknown[])
    .find((key: unknown[]) => key.includes(probeGid) && key.includes('capsule'));
}

/**
 * Render the card until its image query appears; never mount it.
 * Steam wraps the event loader in focus and lazy-render boundaries whose depth
 * changes between builds, so the card is searched instead of rendered at a fixed level.
 * Every loader (`m_ldrEvent`) on the way resolves to the probe model without fetching.
 */
function inspectImageQuery(card: any, model: any, client: any, probeGid: string): unknown[] {
  // Each pending node records whether it renders inside a resolved event loader.
  const pending: [node: any, inLoader: boolean][] = [[card, false]];
  let branchError: unknown;
  let loaderError: unknown;
  let renders = 0;

  while (pending.length && renders < MAX_CARD_RENDERS) {
    const [node, inLoader] = pending.pop()!;

    if (Array.isArray(node)) {
      for (const child of [...node].reverse())
        pending.push([child, inLoader]);
      continue;
    }

    if (!node || typeof node !== 'object' || !node.props)
      continue;

    if (!isComponent(node)) {
      pending.push([node.props.children, inLoader]);
      continue;
    }

    let isLoader = false;
    renders++;
    try {
      const output = render(node, instance => {
        isLoader = 'm_ldrEvent' in instance;
        if (isLoader)
          instance.m_ldrEvent = { state: 'fulfilled', value: model };
      });
      pending.push([output, inLoader || isLoader]);
    } catch (error) {
      // Unrelated branches (ratings, menus) may need providers the probe lacks;
      // a failure below the event loader is the one that explains a missing query.
      if (inLoader || isLoader)
        loaderError ??= error;
      else
        branchError ??= error;
      continue;
    }

    const imageQueryKey = findImageQueryKey(client, probeGid);
    if (imageQueryKey)
      return imageQueryKey;
  }

  if (loaderError ?? branchError)
    throw loaderError ?? branchError;

  throw new Error(`Steam news image query changed: no capsule query after ${renders} renders`);
}

/**
 * Discover native Steam news content without mounting components.
 * Synchronous, unmounted discovery. No effects or network fetches; temporary store hooks are restored.
 */
export function discoverNativeNews(): NativeBindings {
  const { Activity, EventModel, ActivityEvent, sharedClient, store } = findNativeModules();
  const client = new sharedClient.constructor({ defaultOptions: { queries: { retry: false } } });
  const { probeGid, model, event, day, activity } = createProbe(EventModel, ActivityEvent);

  return withProbeEnvironment(store, client, activity, () => {
    const { section, postTextEntry, announcement, card } = inspectActivityTree(Activity, day, event);

    const imageQueryKey = inspectImageQuery(card, model, client, probeGid);

    // The key holds <image>:<language> pairs; the fallback's language comes first.
    const language = imageQueryKey[3];

    if (typeof language !== 'number')
      throw new Error(`Steam news image query changed: ${JSON.stringify(imageQueryKey)}`);

    return {
      Section: section.type,
      PostTextEntry: postTextEntry.type,
      Announcement: announcement.type,
      EventModel, ActivityEvent,
      sharedClient,
      imageQueryKey,
      probeGid,
      language,
    };
  });
}
