import { beforeEach, expect, test } from 'bun:test';
import { act, Component, createElement as h } from 'react';
import { createRoot } from './helpers/ui-runtime';
import { installBackend, FeedManager, registerActivityComponents, id, url, runtime } from './helpers/ui-runtime';
import type { NativeBindings } from '../frontend/steam/news-discovery';

beforeEach(installBackend);

test('native activity controls are removed, actions disabled and later plugin wrappers survive cleanup', async () => {
  document.body.replaceChildren();
  const calls: string[] = [];
  const uploads: string[] = [];
  class Tracker {
    QueueForUpload(marking: { event_gid(): string }) { uploads.push(marking.event_gid()); }
    MarkEventShown(gid: string) { this.QueueForUpload({ event_gid: () => gid }); }
    MarkEventRead(gid: string) { this.QueueForUpload({ event_gid: () => gid }); }
  }
  const previousModules = runtime.nativeModuleCandidates;
  runtime.nativeModuleCandidates = [...previousModules, Tracker];
  class Post extends Component<any> {
    render() { return h('textarea', { 'data-native-post': true }); }
  }
  class Announcement extends Component<any> {
    LoadMyVoteInformation() { calls.push('load-vote'); }
    OnRateUpClicked() { calls.push('upvote'); }
    OnRateDownClicked() { calls.push('downvote'); }
    ShowOptionsContextMenu() { calls.push('menu'); }
    OnViewThread() { calls.push('thread'); }
    componentDidMount() { this.LoadMyVoteInformation(); }
    render() { return h('div', null, h('div', { className: 'RatingBar', 'aria-hidden': 'false' }, 'Vote')); }
  }
  let announcement: Announcement | null = null;
  class Section extends Component<any> {
    OnPostStatusClicked() { calls.push('post'); }
    render() { return h('section', null, h(Post), h(Announcement, {
      ref: (value: Announcement | null) => { announcement = value; }, event: { externalNewsItem: {} },
    })); }
  }
  const feedManager = new FeedManager();
  feedManager.sources[id] = { url, showFeedInWhatsNew: true };
  const native = { Section, PostTextEntry: Post, Announcement } as unknown as NativeBindings;
  const originalPost = Post.prototype.render;
  const cleanup = registerActivityComponents(feedManager, native);
  const root = createRoot(document.body);
  try {
    const tracker = new Tracker();
    tracker.MarkEventShown(`external-news:${id}:article`);
    tracker.MarkEventRead(`external-news:${id}:article`);
    expect(uploads).toEqual([]);
    tracker.MarkEventShown('native-event');
    expect(uploads).toEqual(['native-event']);
    await act(async () => root.render(h(Section, { appid: Number(id) })));
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('section')?.hasAttribute('data-external-news-activity')).toBe(true);
    const rating = document.querySelector<HTMLElement>('.RatingBar')!;
    expect(rating.inert).toBe(true);
    expect(rating.getAttribute('aria-hidden')).toBe('true');
    expect(document.head.textContent).toContain('aspect-ratio: 16 / 9');
    const card = announcement! as Announcement;
    card.OnRateUpClicked();
    card.OnRateDownClicked();
    card.ShowOptionsContextMenu();
    card.OnViewThread();
    expect(calls).toEqual([]);

    const innerRender = Post.prototype.render;
    const foreignRender = function (this: Post) { return innerRender.call(this); };
    Post.prototype.render = foreignRender;
    const innerVote = Announcement.prototype.OnRateUpClicked;
    const foreignVote = function (this: Announcement) { innerVote.call(this); };
    Announcement.prototype.OnRateUpClicked = foreignVote;
    cleanup();
    expect(Post.prototype.render).toBe(foreignRender);
    expect(Announcement.prototype.OnRateUpClicked).toBe(foreignVote);
    expect(rating.inert).not.toBe(true);
    expect(rating.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('section')?.hasAttribute('data-external-news-activity')).toBe(false);
    expect(document.head.querySelector('style')).toBeNull();
    card.OnRateUpClicked();
    expect(calls).toEqual(['upvote']);
    await act(async () => root.render(h(Section, { appid: 570 })));
    expect(document.querySelector('textarea')).not.toBeNull();
    // Remove the simulated foreign plugin's hooks too.
    Post.prototype.render = originalPost;
  } finally {
    cleanup();
    runtime.nativeModuleCandidates = previousModules;
    await act(async () => root.unmount());
    feedManager.dispose();
  }
});

test('announcement classes without vote loading keep their own method set', () => {
  // Newer builds load votes in an observer wrapper; the class has no LoadMyVoteInformation.
  class Announcement extends Component<any> {
    OnRateUpClicked() {}
    render() { return h('div'); }
  }
  class Section extends Component<any> {
    render() { return h('section'); }
  }
  class Post extends Component<any> {
    render() { return h('textarea'); }
  }
  // Steam's `@bind` methods are lazy prototype getters that bind on first access.
  let bindingGetterCalls = 0;
  Object.defineProperty(Announcement.prototype, 'OnViewThread', {
    configurable: true,
    get() { bindingGetterCalls++; return () => {}; },
  });
  const feedManager = new FeedManager();
  const native = { Section, PostTextEntry: Post, Announcement } as unknown as NativeBindings;
  const cleanup = registerActivityComponents(feedManager, native);
  try {
    expect(bindingGetterCalls).toBe(0);
    expect('LoadMyVoteInformation' in Announcement.prototype).toBe(false);
    expect('ShowOptionsContextMenu' in Announcement.prototype).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Announcement.prototype, 'OnRateUpClicked')).toBe(true);
  } finally {
    cleanup();
    feedManager.dispose();
  }
  expect('componentDidUpdate' in Announcement.prototype).toBe(false);
});
