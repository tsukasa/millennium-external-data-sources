import type { NativeEventModel } from './news-types';
import { EXTERNAL_NEWS_PREFIX, POPUP_ACTIVITY, POPUP_DESKTOP_CLIENT_ACTIVITY } from '../constants';
import { createWhatsNewEvents, type WhatsNewEvents } from './whats-new-events';
import { MethodHooks } from './method-hooks';
import { isNonSteamId, openArticle, steam, type SteamSubscription } from './client';
import type { NativeBindings } from './news-discovery';
import type { FeedManager } from '../feed/manager';
import { whatsNewImageCss } from '../styles';

interface HomeNavigationOptions {
  partnerEvent?: PartnerEventReference;
}

interface PartnerEventReference {
  gid?: string;
}

interface AppNavigationOptions {
  gidPartnerEvent?: string;
}

export interface WhatsNewResult {
  eventsToShow: NativeEventModel[];
  [key: string]: unknown;
}

export interface WhatsNewStore {
  GetWhatsNewEvents(): WhatsNewResult;
  m_vecHomeBestEventsForUser?: NativeEventModel[];
  TrackEventShownToUser(event: NativeEventModel, ...args: unknown[]): unknown;
  TrackEventClickedByUser(event: NativeEventModel, ...args: unknown[]): unknown;
  TrackEventShownToUserByGID?(gid: string, ...args: unknown[]): unknown;
  RemoveEvent(gid: string): unknown;
  GetUserAppPrioritySetting(appId: number): number | undefined;
  RaiseAppPriorityForApp(appId: number): Promise<unknown>;
  LowerAppPriorityForApp(appId: number): Promise<unknown>;
  ResetUserAppPriorityForApp?(appId: number): Promise<unknown>;
}

export interface Navigator {
  Home(options?: HomeNavigationOptions, ...args: unknown[]): unknown;
  App?(appId: number, options?: AppNavigationOptions, ...args: unknown[]): unknown;
}

export interface NavigationStore {
  GetNavigator(): Navigator | undefined;
  SetNavigator(navigator: Navigator): void;
}

function eventTime(event: NativeEventModel): number {
  const value = event.GetStartTimeAndDateUnixSeconds?.() ?? event.startTime ?? event.postTime;

  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : 0;
}

function installNavigationHooks(hooks: MethodHooks, navStore: NavigationStore,
  openExternalArticle: (gid: unknown) => boolean): void {
  const patchedNavigators = new WeakSet<Navigator>();
  const patchNavigator = (navigator?: Navigator) => {
    if (!navigator || patchedNavigators.has(navigator))
      return;

    hooks.wrap(navigator, 'Home', (original, _instance, args) =>
      openExternalArticle(args[0]?.partnerEvent?.gid) ? undefined : original());

    if (navigator.App) {
      hooks.wrap(navigator, 'App', (original, _instance, args) =>
        openExternalArticle(args[1]?.gidPartnerEvent) ? undefined : original());
    }

    patchedNavigators.add(navigator);
  };

  hooks.wrap(navStore, 'SetNavigator', (original, _instance, [navigator]) => {
    patchNavigator(navigator);
    return original();
  });

  // Patch the navigator to include custom behavior for external events.
  patchNavigator(navStore.GetNavigator());
}

function installEventActionHooks(hooks: MethodHooks, store: WhatsNewStore, externalEvents: WhatsNewEvents,
  feedManager: FeedManager, refresh: () => void): void {
  for (const name of ['TrackEventShownToUser', 'TrackEventClickedByUser'] as const) {
    hooks.wrap(store, name, (original, _instance, [event]) =>
      event?.GID?.startsWith(EXTERNAL_NEWS_PREFIX)
        ? undefined
        : original()
    );
  }

  if (store.TrackEventShownToUserByGID) {
    hooks.wrap(store, 'TrackEventShownToUserByGID', (original, _instance, [gid]) =>
      gid.startsWith(EXTERNAL_NEWS_PREFIX) ? undefined : original());
  }

  hooks.wrap(store, 'RemoveEvent', (original, _instance, [gid]) => {
    if (!gid.startsWith(EXTERNAL_NEWS_PREFIX))
      return original();

    const url = externalEvents.articleUrl(gid);

    if (url)
      void feedManager.addUrlToRemovedFeedItems(url);
    else {
      externalEvents.hide(gid);
      refresh();
    }

    return undefined;
  });

  // Undefined hides Steam's priority menu actions for non-Steam games.
  hooks.wrap(store, 'GetUserAppPrioritySetting', (original, _instance, [appId]) =>
    isNonSteamId(appId) ? undefined : original());

  for (const name of ['RaiseAppPriorityForApp', 'LowerAppPriorityForApp', 'ResetUserAppPriorityForApp'] as const) {
    if (!store[name])
      continue;

    hooks.wrap(store, name, (original, _instance, [appId]) =>
      isNonSteamId(appId) ? Promise.resolve(false) : original());
  }
}

/** Adds feed models to Steam's native What's New carousel without Steam service requests. */
export function registerWhatsNew(feedManager: FeedManager, native: NativeBindings): () => void {
  const client = steam();

  const store = client.libraryEventStore;
  const navStore = client.tempNavStore;

  if (!store?.GetWhatsNewEvents
    || !store.GetUserAppPrioritySetting
    || !store.RaiseAppPriorityForApp
    || !store.LowerAppPriorityForApp
    || !navStore?.SetNavigator
    || !client.settingsStore?.clientSettings)
    throw new Error('Steam What\'s New store is not available');

  const hooks = new MethodHooks();
  const externalEvents = createWhatsNewEvents(feedManager, native);

  let disposed = false;
  let popupSubscription: SteamSubscription | undefined;
  let unsubscribeFeedManager: (() => void) | undefined;
  let unsubscribeCache: (() => void) | undefined;

  const imageStyles = new Map<Document, HTMLStyleElement>();

  const addImageStyle = (doc?: Document) => {
    if (!doc?.head || imageStyles.has(doc))
      return;

    const style = doc.createElement('style');

    style.textContent = whatsNewImageCss;

    doc.head.append(style);
    imageStyles.set(doc, style);
  };

  const getArticleUrlByGid = (gid: string) => {
    const knownUrl = externalEvents.articleUrl(gid);

    if (knownUrl)
      return knownUrl;

    for (const [appId, { url: feedUrl }] of Object.entries(feedManager.sources)) {
      if (!feedUrl)
        continue;

      const item = feedManager.cache
        .peekLast(feedUrl)
        ?.find(item => `${EXTERNAL_NEWS_PREFIX}${appId}:${item.gid}` === gid);

      if (item)
        return item.url;
    }

    return undefined;
  };

  // Publishing a new MobX array refreshes the carousel without a partner-event request.
  const refresh = () => {
    if (store.m_vecHomeBestEventsForUser)
      store.m_vecHomeBestEventsForUser = [...store.m_vecHomeBestEventsForUser];
  };

  const openExternalArticle = (gid: unknown): boolean => {
    const url = typeof gid === 'string' ? getArticleUrlByGid(gid) : undefined;

    if (!url)
      return false;

    const doc = client.g_PopupManager?.GetExistingPopup(POPUP_DESKTOP_CLIENT_ACTIVITY)?.window?.document || document;

    openArticle(doc, url);

    return true;
  };

  const cleanup = () => {
    if (disposed)
      return;

    disposed = true;

    hooks.restore();

    popupSubscription?.Unregister();
    unsubscribeFeedManager?.();
    unsubscribeCache?.();

    for (const style of imageStyles.values())
      style.remove();

    imageStyles.clear();
    externalEvents.clear();
  };

  try {
    addImageStyle(document);

    for (const name of POPUP_ACTIVITY)
      addImageStyle(client.g_PopupManager?.GetExistingPopup(name)?.window?.document);

    popupSubscription = client.g_PopupManager?.AddPopupCreatedCallback(popup => {
      if (popup.m_strName && POPUP_ACTIVITY.includes(popup.m_strName))
        addImageStyle(popup.window?.document);
    });

    hooks.wrap(store, 'GetWhatsNewEvents', original => {
      const result = original();

      if (client.settingsStore?.clientSettings?.library_whats_new_show_only_product_updates)
        return result;

      const added = externalEvents.list();

      return added.length
        ? { ...result, eventsToShow: [...result.eventsToShow, ...added].sort((a, b) => eventTime(b) - eventTime(a)) }
        : result;
    });

    installEventActionHooks(hooks, store, externalEvents, feedManager, refresh);

    installNavigationHooks(hooks, navStore, openExternalArticle);

    unsubscribeFeedManager = feedManager.subscribe(() => {
      externalEvents.clear();
      refresh();
    });

    unsubscribeCache = feedManager.cache.subscribe(refresh);

    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
