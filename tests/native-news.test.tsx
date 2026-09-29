import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, Component, createContext, useContext, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createActivityDays, createNativeNews } from '../frontend/native/news';
import type { NativeBindings } from '../frontend/native/discovery';
import type { NewsItem } from '../frontend/feed';

class QueryClient {
  data = new Map<string, unknown>();
  cleared = false;
  setQueryData(key: unknown[], value: unknown) { this.data.set(JSON.stringify(key), value); }
  clear() { this.cleared = true; this.data.clear(); }
}
class EventModel {
  clanSteamID = {}; jsondata = {};
  static GenerateSummaryFromText(text: string) { return text.slice(0, 180); }
}
class ActivityEvent {
  constructor(..._args: unknown[]) {}
  IsEventLoaded() { return true; }
}
const forbidden = () => { throw new Error('Native Steam-only operation was reached'); };
class Loader extends Component { render() { return forbidden(); } }
class Visibility extends Component<any> {
  componentDidMount() { this.OnVisible(); }
  OnVisible() { forbidden(); }
  render() { return <div data-native-visibility>{this.props.children}</div>; }
}
class Summary extends Component<{ text: string }> {
  componentDidMount() { this.UpdateLineCount(); }
  UpdateLineCount() { forbidden(); }
  render() { return <div data-native-summary>{this.props.text}</div>; }
}
class Rating extends Component<any> {
  render() { return <div data-native-rating><button onClick={this.props.fnOnRateUpClicked}>Vote</button></div>; }
}
class Announcement extends Component<any> {
  componentDidMount() { forbidden(); }
  render() {
    return <div data-native-announcement onContextMenu={this.props.onMenuButton}>
      <Loader {...{ event: this.props.event }} />
      <Rating bIsVisible fnOnRateUpClicked={forbidden} upvoters={[]} />
    </div>;
  }
}
function NativeEvent(_props: any): never { return forbidden(); }
function NativeFeed(_props: any): never { return forbidden(); }
class PostTextEntry extends Component { render() { return forbidden(); } }
class Day extends Component<any> {
  render() {
    return <div data-native-day aria-labelledby={this.props.labelId}>
      <h4 id={this.props.labelId}>Native date</h4>
      <div>{this.props.day.events.map((event: any) => <NativeEvent key={event.unUniqueID} event={event} />)}</div>
    </div>;
  }
}
function InnerContainer({ children }: { children: import('react').ReactNode }) {
  // Like Steam's component, this intentionally does not forward style props.
  return <div data-native-container>{children}</div>;
}
class Section extends Component<any> {
  render() { return <section data-native-section><h2>Native activity</h2>
    <InnerContainer>{this.props.showTextBox && <PostTextEntry />}
      <NativeFeed ShowMoreContent={forbidden} /></InnerContainer>
  </section>; }
}
// Steam's MobX observer replaces render with a non-writable instance method.
// A subclass override alone works once and silently stops adapting on updates.
for (const Type of [Section, Day, Announcement, Rating]) {
  const original = Type.prototype.render;
  Type.prototype.render = function (this: Component<any>) {
    Object.defineProperty(this, 'render', { value: original.bind(this), configurable: false, writable: false });
    return this.render() as ReturnType<typeof original>;
  };
}
function Panel({ onActivate, children }: any) { return <button onClick={onActivate}>{children}</button>; }
const clients: QueryClient[] = [];
const QueryContext = createContext<QueryClient | null>(null);
const bindings: NativeBindings = {
  Section, PostTextEntry, postTextEntryClassName: 'native-post-entry Panel',
  Day, Days: ({ rgDays }: any) => <div data-native-days>{rgDays.map((day: any) => <Day key={day.key} day={day} />)}</div>,
  Announcement, Loader, Rating, Visibility, Summary, eventClassName: 'native-event', EventModel, ActivityEvent,
  Card: ({ event }: any) => {
    const client = useContext(QueryContext);
    const [observerClient] = useState(client);
    if (client !== observerClient) throw new Error('Query observer kept a cleared client');
    const title = useMemo(() => event.name.get(0), [event]);
    return <Visibility><Panel onActivate={forbidden}>{title}<Summary text="Native summary" /></Panel></Visibility>;
  },
  QueryClient: class extends QueryClient { constructor() { super(); clients.push(this); } },
  QueryProvider: ({ children, client }: any) => <QueryContext.Provider value={client}>{children}</QueryContext.Provider>,
  imageQueryKey: ['native-image', 'probe', 'capsule', 0, '_400x225', undefined], probeGid: 'probe', language: 0,
};
const article = (gid: string, date: number | null, extra = {}): NewsItem => ({
  gid, date, title: 'External article', contents: 'Summary', url: `https://example.com/${gid}`, ...extra,
});

test('native models keep card summaries short, isolate image caches and separate local dates and years', async () => {
  const client = new QueryClient();
  const contents = 'Full untruncated summary. '.repeat(40);
  const items = [article('a', new Date(2026, 8, 28).getTime() / 1000, { contents, image: 'https://example.com/image.jpg' }),
    article('b', new Date(2025, 8, 28).getTime() / 1000), article('c', null)];
  const days = createActivityDays(bindings, '3900360037', items, client);
  expect(days).toHaveLength(3);
  expect(days.map(day => day.undated)).toEqual([false, false, true]);
  const event = days[0].events[0];
  const model = await event.GetEvent();
  expect(await event.ReloadEvent()).toBe(model);
  expect(model.type).toBe(28);
  expect(model.name.get(0)).toBe('External article');
  expect(model.jsondata.localized_summary[0]).toHaveLength(180);
  expect(model.description.get(0)).toBe(contents);
  expect(model.AnnouncementGID).toBeUndefined();
  expect([...client.data.values()]).toEqual([['https://example.com/image.jpg'], [], []]);
  const other = createActivityDays(bindings, '3900360038', items, new QueryClient());
  expect(other[0].events[0].eventModel.GID).not.toBe(model.GID);
});

test('native render methods run while Steam loaders, votes, impressions and internal navigation do not', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://steamloopback.host' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const native = createNativeNews(bindings);
  const root = createRoot(document.body);
  let items = [article('a', 1700000000), article('b', null, { title: '<img onerror=alert(1)>' })];
  const render = () => <native.Section appId="3900360037" action={<button type="button">Refresh</button>}>
    <native.Feed appId="3900360037" items={items} />
  </native.Section>;
  try {
    await act(async () => root.render(render()));
    expect(document.querySelectorAll('[data-native-section]')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('.native-post-entry')?.style.height).toBe('64px');
    expect(document.querySelector<HTMLElement>('.native-post-entry')?.style.position).toBe('relative');
    expect(document.querySelector<HTMLElement>('.native-post-entry')?.style.padding).toBe('0px');
    expect(document.querySelector<HTMLElement>('.native-post-entry > div')?.style.right).toBe('10px');
    expect(document.querySelector('.native-post-entry button')?.textContent).toBe('Refresh');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelectorAll('[data-native-days]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-native-day]')).toHaveLength(2);
    expect(document.querySelectorAll('h4')).toHaveLength(1);
    expect(document.querySelectorAll('[data-native-visibility]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-native-summary]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-native-rating][inert][aria-hidden="true"]')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img onerror=alert(1)>');
    let opened: string | undefined;
    const capture = (event: Event) => {
      const link = event.target as HTMLAnchorElement;
      if (link.tagName === 'A') { opened = link.href; event.preventDefault(); }
    };
    document.addEventListener('click', capture, true);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-native-visibility] button')!.click());
    document.removeEventListener('click', capture, true);
    expect(opened).toBe('https://example.com/a');
    // Exercise both a parent update with the same cache and a feed refresh.
    await act(async () => root.render(render()));
    expect(document.querySelectorAll('[data-native-rating][inert]')).toHaveLength(2);
    const previousClient = clients[clients.length - 1];
    items = items.map(item => ({ ...item, title: 'Refreshed native article' }));
    await act(async () => root.render(render()));
    expect(document.querySelectorAll('[data-native-section]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-native-rating][inert]')).toHaveLength(2);
    expect(document.body.textContent).toContain('Refreshed native article');
    expect(previousClient.cleared).toBe(true);
    expect(clients[clients.length - 1]?.cleared).toBe(false);
    class ChangedSection extends Component<any> {
      render() { return <section data-changed-section><NativeFeed ShowMoreContent={forbidden} /></section>; }
    }
    const changed = createNativeNews({ ...bindings, Section: ChangedSection });
    await act(async () => root.render(<changed.Section appId="3900360037">
      <changed.Feed appId="3900360037" items={items} />
    </changed.Section>));
    expect(document.querySelector('[data-changed-section]')?.textContent).toContain('Refreshed native article');
    expect(document.querySelectorAll('[data-native-summary]')).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
  expect(clients[clients.length - 1]?.cleared).toBe(true);
});
