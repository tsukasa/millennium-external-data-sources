import type { ActivityComponent } from './news-types';
import type { FeedManager } from '../feed/manager';
import type { NativeBindings } from './news-discovery';
import { MethodHooks } from './method-hooks';
import { findInTree, findModuleExport } from 'millennium';
import { EXTERNAL_NEWS_PREFIX } from '../constants';
import { activityImageCss } from '../styles';

interface EventTracker {
  QueueForUpload(marking: { event_gid(): string }): void;
}

interface RatingState {
  inert: boolean;
  ariaHidden: string | null;
}

/** `Node.ELEMENT_NODE`; the global `Node` is not available in every realm. */
const ELEMENT_NODE = 1;

/** Whether a fiber's state node is a DOM element rather than a component instance. */
const isElement = (node: unknown): node is HTMLElement =>
  !!node && typeof node === 'object' && 'nodeType' in node && node.nodeType === ELEMENT_NODE;

/** Get the DOM element corresponding to a React ActivityComponent instance. */
function elementFor(instance: ActivityComponent): HTMLElement | undefined {
  const host = findInTree(instance._reactInternals?.child, fiber => isElement(fiber.stateNode),
    { walkable: ['child'] });
  return host?.stateNode as HTMLElement | undefined;
}

/** Remove posting controls and disable Steam actions on native feed cards. */
export function registerActivityComponents(feedManager: FeedManager, native: NativeBindings): () => void {
  const configured = (appId: number) => feedManager.hasFeed(appId);
  const sectionProto = native.Section.prototype;
  const postProto = native.PostTextEntry.prototype;
  const announcementProto = native.Announcement.prototype;
  const styledDocuments = new Map<Document, HTMLStyleElement>();
  const markedSections = new Set<HTMLElement>();
  const markedRatings = new Map<HTMLElement, RatingState>();
  const hooks = new MethodHooks();
  const markSection = (instance: ActivityComponent) => {
    const section = elementFor(instance);

    if (!section)
      return;

    if (!configured(Number(instance.props.appid))) {
      section.removeAttribute('data-external-news-activity');
      markedSections.delete(section);
      return;
    }

    const doc = section.ownerDocument;

    if (!styledDocuments.has(doc)) {
      // Force 16:9 aspect ratio for images so the layout remains consistent
      const style = doc.createElement('style');
      style.textContent = activityImageCss;
      doc.head.append(style);
      styledDocuments.set(doc, style);
    }

    markedSections.add(section);
    section.setAttribute('data-external-news-activity', '');
  };

  /** Mark a rating component as inert and hide it from assistive technologies. */
  const markRating = (instance: ActivityComponent) => {
    if (!instance.props.event?.externalNewsItem)
      return;

    const rating = elementFor(instance)?.querySelector<HTMLElement>('.RatingBar');

    if (!rating || markedRatings.has(rating))
      return;

    markedRatings.set(rating, {
      inert: rating.inert,
      ariaHidden: rating.getAttribute('aria-hidden')
    });

    rating.inert = true;
    rating.setAttribute('aria-hidden', 'true');
  };

  /** Forget elements of an unmounting component; React discards them, so nothing needs restoring. */
  const release = (instance: ActivityComponent) => {
    const element = elementFor(instance);

    if (!element)
      return;

    markedSections.delete(element);

    const rating = element.querySelector<HTMLElement>('.RatingBar');
    if (rating)
      markedRatings.delete(rating);
  };

  const cleanup = () => {
    hooks.restore();
    for (const section of markedSections)
      section.removeAttribute('data-external-news-activity');

    markedSections.clear();

    for (const [rating, previous] of markedRatings) {
      rating.inert = previous.inert;

      if (previous.ariaHidden === null)
        rating.removeAttribute('aria-hidden');
      else
        rating.setAttribute('aria-hidden', previous.ariaHidden);
    }

    markedRatings.clear();

    for (const style of styledDocuments.values())
      style.remove();

    styledDocuments.clear();
  };

  try {
    const Tracker = findModuleExport(value => value?.prototype?.QueueForUpload
      && value?.prototype?.MarkEventShown
      && value?.prototype?.MarkEventRead) as { prototype: EventTracker } | undefined;

    if (Tracker) {
      // Cover native callers that bypass libraryEventStore's tracking methods.
      hooks.wrap(Tracker.prototype, 'QueueForUpload', (original, _instance, [marking]) =>
        marking.event_gid().startsWith(EXTERNAL_NEWS_PREFIX) ? undefined : original());
    }

    hooks.wrap(postProto, 'render', (original, instance) => {
      // The text entry has no appid; find its native Activity parent in either UI.
      const activity = findInTree(instance._reactInternals, fiber => {
        const appId = fiber.pendingProps?.appid ?? fiber.memoizedProps?.appid;
        return appId !== undefined && configured(Number(appId));
      }, { walkable: ['return'] });

      return activity ? null : original();
    });

    hooks.wrap(sectionProto, 'OnPostStatusClicked', (original, instance) =>
      configured(Number(instance.props.appid)) ? undefined : original());

    for (const name of ['componentDidMount', 'componentDidUpdate'] as const) {
      hooks.wrap(sectionProto, name, (original, instance) => {
        const result = original();
        markSection(instance);

        return result;
      });

      hooks.wrap(announcementProto, name, (original, instance) => {
        const result = original();
        markRating(instance);

        return result;
      });
    }

    for (const proto of [sectionProto, announcementProto]) {
      hooks.wrap(proto, 'componentWillUnmount', (original, instance) => {
        const result = original();
        release(instance);

        return result;
      });
    }

    // Newer builds load votes in an observer wrapper; only guard actions the class still has.
    for (const name of [
      'LoadMyVoteInformation',
      'OnRateUpClicked',
      'OnRateDownClicked',
      'ShowOptionsContextMenu',
      'OnViewThread'] as const) {
      // `in` reads no property, so Steam's lazy `@bind` getters stay untouched.
      if (!(name in announcementProto))
        continue;
      hooks.wrap(announcementProto, name, (original, instance) =>
        instance.props.event?.externalNewsItem ? undefined : original());
    }

    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
