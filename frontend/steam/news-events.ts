import type { NativeEventModel, NativeActivityEvent, QueryDataClient } from './news-types';
import type { NewsItem } from '../feed';
import { steam } from './client';
import type { NativeBindings } from './news-discovery';
import { EXTERNAL_NEWS_PREFIX } from '../constants';

// Steam's EProtoClanEventType.k_EClanNewsEvent.
const CLAN_NEWS_EVENT_TYPE = 28;

export interface ExternalNewsEvent extends NativeActivityEvent {
  eventModel: NativeEventModel;
  externalNewsItem: NewsItem;
}

/** Converts a potentially relative Steam URL to an absolute URL. */
function getAbsoluteSteamUrlFromString(inputUrl: string | undefined): string | undefined {
  return inputUrl ? new URL(inputUrl, steam().location?.href).href : inputUrl;
}

/** Retrieves the hero images for a given Steam App ID. */
function getHeroImagesForAppId(appId: string): string[] {
  try {
    const overview = steam().appStore?.GetAppOverviewByAppID?.(Number(appId));

    // Return early if no overview is available.
    if (!overview)
      return [];

    return steam().appDetailsStore?.GetHeroImages?.(overview)?.rgHeroImages || [];
  } catch {
    // Missing artwork must never prevent the feed itself from rendering.
    return [];
  }
}

/** Models are private to this feed; never register synthetic IDs in Steam's stores. */
export function createExternalNewsModels(native: NativeBindings, appId: string, items: NewsItem[]) {
  const backgroundImages = items.some(item => !item.image) ? getHeroImagesForAppId(appId) : [];
  const emptyImage = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  return items.map(item => {
    const eventModel = new native.EventModel();
    const images = item.image ? [item.image] : backgroundImages;
    const modelImage = getAbsoluteSteamUrlFromString(images[0]) || emptyImage;

    // Steam normally generates a short card summary. Supplying the full RSS
    // article here makes its UpdateLineCount repeatedly lay out thousands of
    // characters per card and can stall the library for many seconds.
    const summary = native.EventModel.GenerateSummaryFromText(item.contents);

    eventModel.GID = `${EXTERNAL_NEWS_PREFIX}${appId}:${item.gid}`;
    eventModel.appid = Number(appId);
    eventModel.type = CLAN_NEWS_EVENT_TYPE;
    eventModel.name = new Map([
      [native.language, item.title],
      [0, item.title]
    ]);
    eventModel.description = new Map([
      [native.language, item.contents],
      [0, item.contents]
    ]);
    eventModel.jsondata = {
      ...eventModel.jsondata,
      // Localized summary - we ignore language here
      localized_summary: Object.assign([], {
        [native.language]: summary,
        0: summary
      }),
      // Localized capsule image - we ignore language here
      localized_capsule_image: Object.assign([], {
        [native.language]: modelImage,
        0: modelImage
      }),
    };
    eventModel.postTime = item.date ?? 0;
    eventModel.rtime32_moderator_reviewed = eventModel.postTime;

    // Big Picture uses AnnouncementGID as the carousel item's focus identity.
    // Without it, controller focus cannot identify the external card.
    eventModel.AnnouncementGID = eventModel.GID;

    return { model: eventModel, item, images };
  });
}

export function createExternalNewsEvents(native: NativeBindings, appId: string, items: NewsItem[], client: QueryDataClient): ExternalNewsEvent[] {
  return createExternalNewsModels(native, appId, items).map(({ model: eventModel, item, images }, index) => {
    // A fresh, private query result prevents the original image hook's store/clan
    // fallback requests, including for articles without an image.
    client.setQueryData(
      native.imageQueryKey.map(value => value === native.probeGid ? eventModel.GID : value),
      images
    );

    // Steam's image hook also asks for fallback artwork even when the card has
    // a capsule. Cache the absent fallback so that query never reaches Steam.
    client.setQueryData(
      ['useFallbackArtworkScreenshot', eventModel.GID],
      null
    );

    const event = new native.ActivityEvent(
      eventModel.postTime,
      eventModel.clanSteamID,
      eventModel.GID,
      eventModel.postTime,
      appId
    );

    Object.defineProperty(event, 'eventModel', { value: eventModel });

    event.GetEvent = async () => eventModel;
    event.ReloadEvent = async () => eventModel;
    // The model is already local. Steam renders its native rating footer only
    // for loaded events; the activity section makes that footer inert.
    event.IsEventLoaded = () => true;
    event.externalNewsItem = item;
    // Use the index here to differentiate!
    event.unUniqueID = `${EXTERNAL_NEWS_PREFIX}${appId}:${index}:${item.gid}`;

    return event as ExternalNewsEvent;
  });
}
