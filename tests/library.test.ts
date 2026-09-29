import { beforeEach, expect, test } from 'bun:test';
import { act, Component, useLayoutEffect, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import type { LayoutProps, SeekTarget } from '../frontend/steam/library-layout';
import { installBackend, FeedManager, createLibraryLayout, discoverNativeNews, registerLibrary, id, otherId, url, tick, runtime, discoveryDispatcher } from './helpers/ui-runtime';

beforeEach(installBackend);

function nativeLayout(props: LayoutProps) {
  return h('main', { className: 'ColumnContainer' },
    h('aside', null, 'Notes', h('div', { 'data-nsp': true }, 'Playtime')),
    h('section', { className: 'LeftColumn' }, [
      h('div', { key: 'shortcut', role: 'region', className: 'AppDetailsSection', id: 'notice' },
        h('div', { className: '_5uvIN6jXDXzzck59F-nhv Body _1TGl52GwsFQg3CXUYvThP-' },
          'Some detailed information on Test is unavailable because it is a non-Steam game or mod. ' +
          'Steam will still manage launching the game for you and in most cases the in-game overlay will be available.')),
      props.setSections.has('offline') && h('div', { key: 'offline' }, 'Offline'),
      props.setSections.has('activityrollup') && h(NativeSeek, { key: 'rollup', name: 'activityrollup', parent: props.parentComponent }, h('div', { id: 'native-rollup' }, 'Native rollup')),
      props.setSections.has('activity') && h(NativeSeek, { key: 'activity', name: 'activity', parent: props.parentComponent }, h('div', { id: 'native-activity' }, 'Native activity')),
    ]));
}

const NativeSeek: SeekTarget = ({ name, parent, children }) => h('div', {
  className: 'SeekTarget', ref: (element: HTMLDivElement | null) => parent.RegisterSection(name, element),
}, children);
const propsFor = (appid = Number(id)): LayoutProps => ({
  overview: { appid }, setSections: new Set(['nonsteam']), parentComponent: { RegisterSection: () => {} },
});


test('React layout keeps the native notice hidden after activity targets and preserves Playtime', async () => {
  document.body.replaceChildren();
  const feedManager = new FeedManager();
  feedManager.values[id] = url;
  feedManager.showFeedInWhatsNew[id] = false;
  const sections = new Map<string, HTMLElement | null>();
  const props = propsFor();
  props.parentComponent.RegisterSection = (name, element) => { sections.set(name, element); };
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, feedManager);
  // Model a theme that inspects each newly committed column container only once.
  const seen = new WeakSet<Element>();
  const discoveries: number[] = [];
  function ThemeProbe() {
    useLayoutEffect(() => {
      const column = document.querySelector('.ColumnContainer')!;
      if (!seen.has(column)) {
        seen.add(column);
        discoveries.push(column.querySelectorAll('.LeftColumn > .SeekTarget').length);
      }
    });
    return h(Layout, props);
  }
  const root = createRoot(document.body);
  try {
    await act(async () => { root.render(h(ThemeProbe)); await tick(); });
    expect(discoveries).toEqual([2]);
    expect(sections.get('activityrollup')).toBe(document.querySelector('.LeftColumn > .SeekTarget:nth-of-type(1)'));
    expect(sections.get('activity')).toBe(document.querySelector('.LeftColumn > .SeekTarget:nth-of-type(2)'));
    expect(sections.get('activity')).toBe(document.getElementById('native-activity')?.parentElement);
    expect(document.getElementById('native-rollup')).toBeNull();
    expect(document.getElementById('native-activity')).not.toBeNull();
    expect(document.querySelectorAll('[data-external-news]')).toHaveLength(0);
    expect(document.getElementById('notice')?.closest('[hidden]')).toBe(document.querySelector('.LeftColumn > :last-child'));
    expect(document.querySelector('html:has(._5uvIN6jXDXzzck59F-nhv):has(._1TGl52GwsFQg3CXUYvThP-)')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-nsp]')!.style.display).toBe('');
    const column = document.querySelector('.ColumnContainer');
    await act(async () => { await feedManager.save(id, 'https://example.com/changed'); });
    expect(document.querySelector('.ColumnContainer')).toBe(column);
    await act(async () => { await feedManager.clear(id); });
    expect(document.querySelector('.ColumnContainer')).not.toBe(column);
    expect(document.querySelector('[data-external-news]')).toBeNull();
    expect(document.getElementById('notice')?.textContent).toContain('Some detailed information');
    expect(document.getElementById('notice')?.closest('[hidden]')).toBeNull();
    expect(sections.get('activity')).toBeNull();
    expect(document.querySelector('[data-nsp]')?.textContent).toBe('Playtime');
    await act(async () => { await feedManager.save(id, url); });
    expect(document.querySelectorAll('.LeftColumn > .SeekTarget')).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
});

test('React layout leaves Steam activity intact across shortcut navigation', async () => {
  document.body.replaceChildren();
  const feedManager = new FeedManager();
  feedManager.values[id] = url;
  feedManager.values[otherId] = 'https://other.test/rss';
  const Layout = createLibraryLayout(nativeLayout, NativeSeek, { LeftColumn: 'LeftColumn', ColumnContainer: 'ColumnContainer' }, feedManager);
  const root = createRoot(document.body);
  try {
    await act(async () => root.render(h(Layout, propsFor())));
    expect(document.getElementById('native-activity')).not.toBeNull();
    await act(async () => root.render(h(Layout, propsFor(Number(otherId)))));
    expect(document.getElementById('native-activity')).not.toBeNull();
    await act(async () => root.render(h(Layout, propsFor(570))));
    expect(document.getElementById('native-activity')).toBeNull();
    expect(document.querySelector('.SeekTarget')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});



test('discovery needs only live bindings, restores its environment and installs the Big Picture section gate', () => {
  const previousActivity = (window as any).appActivityStore;
  const previousEvents = (window as any).libraryEventStore;
  const previousNav = (window as any).tempNavStore;
  const previousSettings = (window as any).settingsStore;
  const clients: QueryClient[] = [];
  let broken = false;
  let disposedResources = 0;
  class QueryClient {
    queries: { queryKey: unknown[] }[] = [];
    cleared = false;
    constructor(..._args: unknown[]) { clients.push(this); }
    getQueryCache() { return { getAll: () => this.queries }; }
    setQueryData(queryKey: unknown[], _value: unknown) { this.queries.push({ queryKey }); }
    clear() { this.cleared = true; }
  }
  const shared = new QueryClient();
  class EventModel {
    GID = '';
    clanSteamID = {};
    GetSummaryWithFallback() {}
    GetNameWithFallback() {}
  }
  class ActivityEvent {
    IsEventLoaded() { return false; }
    ReloadEvent() { throw new Error('Discovery must not fetch'); }
  }
  function Card({ event }: any) {
    const client = discoveryDispatcher.useContext({ _currentValue: shared });
    discoveryDispatcher.useRef({ reaction: { dispose() { disposedResources++; } } });
    discoveryDispatcher.useState({ getOptimisticResult() {}, destroy() { disposedResources++; } });
    if (broken) throw new Error('Card structure changed');
    client.setQueryData(['image', event.GID, 'capsule', 7], []);
    // No Rating, Summary, Visibility or QueryProvider is required.
    return h('div');
  }
  class Loader extends Component<any> {
    m_ldrEvent?: { state: string; value: EventModel };
    render() {
      if (this.m_ldrEvent?.state !== 'fulfilled') throw new Error('Discovery must bypass loading');
      return h(Card, { event: this.m_ldrEvent.value });
    }
  }
  class Announcement extends Component<any> {
    render() { return h(Loader, { event: this.props.event }); }
  }
  const EventWrapper = ({ event }: any) => h(Announcement, { event });
  const Day = ({ day }: any) => h('div', null, h(EventWrapper, { event: day.events[0] }));
  const DayWrapper = ({ day }: any) => h(Day, { day });
  const Days = ({ rgDays }: any) => h('div', null, h(DayWrapper, { day: rgDays[0] }));
  class Post extends Component<any> {
    render(): never { throw new Error('Discovery must not render the unused text entry'); }
  }
  const map = new Map<number, unknown>();
  const activityStore = {
    m_mapAppActivity: map,
    GetAppActivity(appId: number): any { return map.get(appId); },
    RequestRestoreActivity() {}, async RestoreActivity() {}, FetchLatestActivity() {},
    async FetchLatestActivityFromServer() {}, async FetchActivityHistory() {},
  };
  const Feed = () => h(Days, { rgDays: activityStore.GetAppActivity(0).appActivityByDay });
  class Section extends Component<any> {
    render() { return h('section', null,
      h(Post, { OnPostClicked() {}, placeholder: 'Native input' }),
      h(Feed, { ShowMoreContent() {} })); }
  }
  function AppDetailsActivitySectionDays(props: any) { return h(Section, props); }
  runtime.nativeModuleCandidates = [AppDetailsActivitySectionDays, EventModel, ActivityEvent, shared];
  Object.assign(window, {
    appActivityStore: activityStore,
    libraryEventStore: {
      GetWhatsNewEvents() { return { eventsToShow: [] }; },
      TrackEventShownToUser() {}, TrackEventClickedByUser() {}, RemoveEvent() {},
      GetUserAppPrioritySetting() { return 0; }, async RaiseAppPriorityForApp() {}, async LowerAppPriorityForApp() {},
    },
    tempNavStore: { SetNavigator() {}, GetNavigator() {} }, settingsStore: { clientSettings: {} },
  });
  const originalRead = activityStore.GetAppActivity;
  const nativeSections = new Set(['nonsteam']);
  class LayoutController {
    GetSections(_overview: { appid: number }) { return nativeSections; }
    RegisterSection() {}
    SeekToSection() {}
  }
  class Seek extends Component<any> {
    render() { this.props.parent.RegisterSection(this.props.name, null); return h('div'); }
  }
  const context = { Provider: {}, _currentValue: nativeLayout, _currentValue2: nativeLayout };
  runtime.libraryModule = { LayoutController, Seek, context };
  runtime.nativeClassCandidates = [{ LeftColumn: 'LeftColumn', RightColumn: 'RightColumn', ColumnContainer: 'ColumnContainer', SeekTarget: 'SeekTarget' }];
  let cleanup: (() => void) | undefined;
  try {
    const native = discoverNativeNews();
    expect(native.Section).toBe(Section);
    expect(native.Announcement).toBe(Announcement);
    expect(native.PostTextEntry).toBe(Post);
    expect(native.language).toBe(7);
    expect(native.imageQueryKey).toEqual(['image', native.probeGid, 'capsule', 7]);
    expect(activityStore.GetAppActivity).toBe(originalRead);
    expect(map.size).toBe(0);
    expect(clients[1].cleared).toBe(true);
    expect(shared.cleared).toBe(false);
    expect(disposedResources).toBe(2);
    broken = true;
    expect(() => discoverNativeNews()).toThrow('Card structure changed');
    expect(activityStore.GetAppActivity).toBe(originalRead);
    expect(clients[2].cleared).toBe(true);
    expect(disposedResources).toBe(4);
    broken = false;

    const feedManager = new FeedManager();
    feedManager.values[id] = url;
    cleanup = registerLibrary(feedManager);
    const instance = new LayoutController();
    expect([...instance.GetSections({ appid: Number(id) })]).toEqual(['nonsteam', 'activityrollup', 'activity']);
    expect([...nativeSections]).toEqual(['nonsteam']);
    expect(instance.GetSections({ appid: 570 })).toBe(nativeSections);
    expect(context._currentValue).not.toBe(nativeLayout);
    const inner = LayoutController.prototype.GetSections;
    const foreign = function (this: LayoutController, overview: { appid: number }) { return inner.call(this, overview); };
    LayoutController.prototype.GetSections = foreign;
    cleanup();
    expect(LayoutController.prototype.GetSections).toBe(foreign);
    expect(instance.GetSections({ appid: Number(id) })).toBe(nativeSections);
    expect(context._currentValue).toBe(nativeLayout);
    expect(context._currentValue2).toBe(nativeLayout);
    expect(activityStore.GetAppActivity).toBe(originalRead);
    expect(map.size).toBe(0);
    feedManager.dispose();
  } finally {
    cleanup?.();
    runtime.nativeModuleCandidates = [];
    runtime.nativeClassCandidates = [];
    runtime.libraryModule = undefined;
    Object.assign(window, { appActivityStore: previousActivity, libraryEventStore: previousEvents,
      tempNavStore: previousNav, settingsStore: previousSettings });
  }
});


