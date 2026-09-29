import type { ActivityComponent } from './news-types';
import type { FeedManager } from '../feed/manager';
import type { NativeBindings } from './news-discovery';
import { isNonSteamId } from './client';
import { MethodHooks } from './method-hooks';

interface RatingState {
  inert: boolean;
  ariaHidden: string | null;
}

/**
 * Get the DOM element corresponding to a React ActivityComponent instance.
 * @param instance The ActivityComponent instance.
 * @returns The HTMLElement corresponding to the instance, or undefined if not found.
 */
function elementFor(instance: ActivityComponent): HTMLElement | undefined {
  let fiber = instance._reactInternals?.child;
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode === 'object' && 'nodeType' in fiber.stateNode && fiber.stateNode.nodeType === 1))
    fiber = fiber.child;
  return fiber?.stateNode as HTMLElement | undefined;
}

/**
 * Remove posting controls and disable Steam actions on native feed cards.
 * @param feedManager The feed manager instance.
 * @param native The native bindings instance.
 */
export function registerActivityComponents(feedManager: FeedManager, native: NativeBindings): () => void {
  const configured = (appId: number) => isNonSteamId(appId) && !!feedManager.values[String(appId)];
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
      style.textContent = `
        [data-external-news-activity] .PartnerEventMediumImage_Image {
          width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; display: block;
        }
      `;
      doc.head.append(style);
      styledDocuments.set(doc, style);
    }

    markedSections.add(section);
    section.setAttribute('data-external-news-activity', '');
  };

  /**
   * Mark a rating component as inert and hide it from assistive technologies.
   * @param instance The ActivityComponent instance containing the rating.
   */
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

  const cleanup = () => {
    hooks.restore();
    for (const section of markedSections) {
      section.removeAttribute('data-external-news-activity');
    }

    markedSections.clear();

    for (const [rating, previous] of markedRatings) {
      rating.inert = previous.inert;

      if (previous.ariaHidden === null) {
        rating.removeAttribute('aria-hidden');
      } else {
        rating.setAttribute('aria-hidden', previous.ariaHidden);
      }
    }

    markedRatings.clear();

    for (const style of styledDocuments.values()) {
      style.remove();
    }

    styledDocuments.clear();
  };

  try {
    hooks.wrap(postProto, 'render', (original, instance) => {
      // The text entry has no appid; find its native Activity parent in either UI.
      for (let fiber = instance._reactInternals; fiber; fiber = fiber.return) {
        const appId = fiber.pendingProps?.appid ?? fiber.memoizedProps?.appid;
        if (appId !== undefined && configured(Number(appId)))
          return null;
      }
      return original();
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
    for (const name of ['LoadMyVoteInformation', 'OnRateUpClicked',
      'OnRateDownClicked', 'ShowOptionsContextMenu', 'OnViewThread'] as const) {
      hooks.wrap(announcementProto, name, (original, instance) =>
        instance.props.event?.externalNewsItem ? undefined : original());
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
