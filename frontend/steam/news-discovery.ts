import { applyHookStubs, findModuleExport, removeHookStubs } from 'millennium';
import type { ActivityComponent, NativeActivityProps, NativeEventModelConstructor, NativeActivityEventConstructor, QueryDataClient } from './news-types';
import type { ComponentClass } from 'react';
import { steam } from './client';

export interface NativeActivityComponentClass extends ComponentClass<NativeActivityProps> {
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

/**
 * Recursively search a React element tree for a node that matches the given predicate.
 * @param tree The root of the React element tree to search.
 * @param predicate A function that returns true for the desired node.
 * @returns The first node that matches the predicate, or undefined if none is found.
 */
export function findElement(tree: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, predicate);

      if (found)
        return found;
    }
  } else if (tree?.props) {
    if (predicate(tree))
      return tree;

    return findElement(tree.props.children, predicate);
  }

  return undefined;
}

/**
 * Require a React element that matches the given predicate.
 * Throws an error if no matching element is found.
 * @param tree The root of the React element tree to search.
 * @param predicate A function that returns true for the desired node.
 * @returns The first node that matches the predicate.
 */
function requireElement(tree: any, predicate: (node: any) => boolean) {
  const element = findElement(tree, predicate);

  if (!element)
    throw new Error('Steam activity component structure changed');

  return element;
}

/**
 * Render a React element to its output.
 * @param element The React element to render.
 * @returns The rendered output of the element.
 */
function render(element: any): any {
  const type = element.type.type || element.type;

  return type.prototype?.render
    ? new type(element.props).render()
    : type(element.props);
}

/**
 * Find Steam modules by behavior instead of build-specific names or IDs.
 * @returns An object containing the discovered native modules.
 */
function findNativeModules() {
  /* Activity module */
  const Activity = findModuleExport(value => typeof value === 'function' && String(value).includes('AppDetailsActivitySectionDays'));

  if (!Activity)
    throw new Error('Steam native news components are not available: Activity');

  /* ActivityEvent module */
  const ActivityEvent = findModuleExport(value => value?.prototype?.IsEventLoaded && value?.prototype?.ReloadEvent);

  if (!ActivityEvent)
    throw new Error('Steam native news components are not available: ActivityEvent');

  /* EventModel module */
  const EventModel = findModuleExport(value => value?.prototype?.GetSummaryWithFallback && value?.prototype?.GetNameWithFallback);

  if (!EventModel)
    throw new Error('Steam native news components are not available: EventModel');

  /* sharedClient module */
  const sharedClient = findModuleExport(value => value && typeof value.getQueryCache === 'function');

  if (!sharedClient)
    throw new Error('Steam native news components are not available: sharedClient');

  /* store */
  const store = steam().appActivityStore;

  if (!store)
    throw new Error('Steam native news components are not available: store');

  return { Activity, EventModel, ActivityEvent, sharedClient, store };
}

/**
 * Gives Steam's activity tree an already-loaded, synthetic event to render.
 * @param EventModel The constructor for the native event model.
 * @param ActivityEvent The constructor for the native activity event.
 * @returns An object containing the probe's GID, model, event, day, and activity.
 */
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
 * Temporarily supply the stores and hooks needed for an unmounted probe render.
 * @param store The app activity store to use during the probe render.
 * @param client The shared client to use during the probe render.
 * @param activity The synthetic activity to render.
 * @param inspect A function that returns the native bindings to inspect.
 * @returns The result of the inspection function.
 */
function withProbeEnvironment(store: any, client: any, activity: any, inspect: () => NativeBindings): NativeBindings {
  const originalDescriptor = Object.getOwnPropertyDescriptor(store, 'GetAppActivity');
  const original = store.GetAppActivity;

  // Router hooks and QueryClient hooks have undefined defaults outside a render.
  const context = new Proxy(client, {
    get(target, key) {
      if (key === 'location')
        return {
          state: {},
          pathname: '/library/home'
        };

      if (key === 'history')
        return {
          location: {
            state: {}
          }
        };

      return typeof target[key] === 'function'
        ? target[key].bind(target)
        : target[key];
    }
  });

  const refs: any[] = [];
  const observers: any[] = [];
  let dispatcher: any;
  let extraHooks: any;

  try {
    store.GetAppActivity = function (appid: number) {
      return appid === 0
        ? activity
        : original.call(this, appid);
    };

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

      useContext: (value: any) => value._currentValue?.getQueryCache
        ? client
        : value._currentValue ?? context,

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

    return inspect();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(store, 'GetAppActivity', originalDescriptor);
    } else {
      delete store.GetAppActivity;
    }

    if (dispatcher) {
      Object.assign(dispatcher, extraHooks);
      removeHookStubs();
    }

    refs.forEach(ref => ref.current?.reaction?.dispose());

    observers.forEach(observer => observer.destroy());

    client.clear();
  }
}

/**
 * Walk the activity panel down to the event card without mounting it.
 * @param Activity The constructor for the native activity component.
 * @param day The day to locate within the activity feed.
 * @param event The event to locate within the specified day.
 * @returns An object containing the section, post text entry, announcement, and loader elements.
 */
function inspectActivityTree(Activity: any, day: any, event: any) {
  const section = Activity({ appid: 0, showTextBox: true });

  const sectionTree = render(section);

  const postTextEntry = requireElement(sectionTree, node =>
    typeof node.props.OnPostClicked === 'function' && typeof node.props.placeholder === 'string');

  const feed = requireElement(sectionTree, node => typeof node.props.ShowMoreContent === 'function');

  const days = requireElement(render(feed), node => node.props.rgDays);

  const dayWrapper = requireElement(render(days), node => node.props.day === day);

  const dayElement = render(dayWrapper);

  const eventWrapper = requireElement(render(dayElement), node => node.props.event === event);

  const announcement = render(eventWrapper);

  const announcementTree = render(announcement);

  const loader = requireElement(announcementTree, node => node.props.event === event);

  return {
    section,
    postTextEntry,
    announcement,
    loader
  };
}

/**
 * Inspect the image query for a given loader without mounting it.
 * Render the card only to discover its image query; never mount its loader.
 * @param loader The loader element to inspect.
 * @param model The model to use for rendering the loader.
 */
function inspectImageQuery(loader: any, model: any) {
  const loaderInstance = new loader.type(loader.props);
  loaderInstance.m_ldrEvent = { state: 'fulfilled', value: model };
  render(loaderInstance.render());
}

/**
 * Find the image query key for a given probe GID.
 * @param client The client to query.
 * @param probeGid The probe GID to search for.
 * @returns An object containing the image query key and language.
 */
function findImageQueryKey(client: any, probeGid: string) {
  const imageQueryKey = client
    .getQueryCache()
    .getAll()
    .map((query: any) => query.queryKey as unknown[])
    .find((key: unknown[]) => key.includes(probeGid) && key.includes('capsule'));

  // Gives you two pairs of <image>:<language> in the query key.
  // We're interested in the "fallback" at the very end.
  const language = imageQueryKey?.[3];

  if (!imageQueryKey || typeof language !== 'number')
    throw new Error('Steam news image query changed');

  return { imageQueryKey, language };
}

/**
 * Discover native Steam news content without mounting components.
 * Synchronous, unmounted discovery. No effects or network fetches; temporary store hooks are restored.
 * @returns An object containing the discovered native news bindings.
 */
export function discoverNativeNews(): NativeBindings {
  const { Activity, EventModel, ActivityEvent, sharedClient, store } = findNativeModules();
  const client = new sharedClient.constructor({ defaultOptions: { queries: { retry: false } } });
  const { probeGid, model, event, day, activity } = createProbe(EventModel, ActivityEvent);

  return withProbeEnvironment(store, client, activity, () => {
    const { section, postTextEntry, announcement, loader } = inspectActivityTree(Activity, day, event);

    inspectImageQuery(loader, model);

    const { imageQueryKey, language } = findImageQueryKey(client, probeGid);

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
