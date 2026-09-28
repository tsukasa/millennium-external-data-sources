import { findClassModule } from 'millennium';

type CssClasses = Record<string, string>;

export const RATING_CLASSES_FALLBACK: CssClasses = {
  RatingBar: '_1yWgPveQ73QeYCdLcs6oFQ',
  LikeIcon: '_1OhPtd0sU2yzZwckCTGRNC',
};

export const FEED_CLASSES_FALLBACK: CssClasses = {
  ActivityFeedContainer: '_3yTl3RiWfo-Itg-xp967wP',
  FetchMoreContainer: '_39ZurKJQex6v69aXzvc_nj',
  ViewLastNews: '_1EC1xjjUGqI7fqX6PVzJA3',
  AddToFeed: '_2bqRppbRWGNAZV5lfubW7-',
  PostTextEntry: 'YFAtL5H6txGXk5T_IhpUF',
  PostTextEntryBox: '_3x31AgESSlUqX3D4MTHv2m',
  StatusInputBox: '_3NofiExBJn85uwEhca2dy7',
  StatusInputTextArea: '_10oyYsgiC5Hvnoieb7sHLI',
  StatusControlsRow: '_1HHZQHn8xe900jZYphjUlF',
  StatusControlsActive: '_3UJUKf-LVdVvYTGS51dmj',
  FormattingSpacer: '_3RowZ5DsqhGgvCelRGSZf2',
  FormattingButton: '_2Whi7Nrn2fmTSPtrf9jNFV',
};

export const EVENT_CLASSES_FALLBACK: CssClasses = {
  AppActivityDay: 'S2Fu9HxHCA5MaCLGrN2ib',
  AppActivityDate: '_19LfMT7PFWg2xHOqNjR99q',
  Rule: '_3pcPRPvuGH7hEM33zLknZO',
  Event: 'UVeN0kaD3zv1feMj_mMw5',
  EventBody: 'NEMXhMlqXOCJwfgWlHXhT',
  UserStatus: 'Yo3XX_JHkn0gKBlBhDvyg',
  EventHeadline: 'QCKBqF2k_sRLcXJ5qQIEl',
  EventActorAvatar: '_1gVy5n_zNp3tXpwU2aV9k8',
  SpanEvent: '_3Nxqyyt2ilotu5ci553y82',
  ActorName: '_1t1iyV4uBG9M9tTM7rCFNu',
  HeadlineGameName: 'Gy1Y7lb4Y47vK8odzSru2',
  ActivityAchievementUnlocked: 'yJLy7HDLJT44C1fcm6lPI',
  Reset: '_3A_c3YHYd4YIjA8Y-olnPl',
  PrimaryAchievement: '_26QliGU0MSP6WN4r-RtI5q',
  OneAchievementRow: '_3XupbOaQR2IshnGoougLm2',
  TwoAchievementRow: '_2pdPx3x3zdBcv4K2Wx9AlT',
  PartnerEvent: '_1AYE16384J_ecLpN0sEYc5',
  PartnerEventMediumImage: 'By7D93oEZkZtBeg23NDoR',
  PartnerEventLargeUpdate: '_39Zk32AvV5cr6g-83IVRVS',
  LeftSideMajorUpdateBar: '_3oMUSjOFNB0E9LWcL2sE7',
  PartnerEventMediumImage_Container: '_1HZy7BvOZuPT8feUwadL4W',
  MediumImageContainer: 'ddB5GVHCwLezhshXUMCNL',
  PartnerEventMediumImage_Image: 'VytJzt3Z_t6332-n24Yrc',
  PartnerEventMediumImage_Contents: '_2gv3EsHSu5dMQyMqaz-W9t',
  PartnerEventMediumImage_TextColumn: '_3dJ4Bq6Msivz5-UIHzSEQu',
  PartnerEventMediumImage_Title: '_1gljEIuhbsQpFCWuVhdKTJ',
  PartnerEventMediumImage_Summary: 'Ru7OBQzSxqIo3jIsbtV9g',
  PartnerEventType: '_1ujzuoxGhLunHZQqHAqRgg',
  PartnerEventFeatured: '_3xi-HLpFVHaakihoqhQ_6C',
  PartnerEventLargeImage_Container: 'LibriMVXcLl1HB60ZUp78',
  PartnerEventLargeImage_Contents: '_2tDv0EeJIdDmZLyfUE63t1',
  ImageContainer: '_1XpBItdUymdlwPZzvvOnyW',
  PartnerEventLargeImage_Image: 'fGDsmh9vz8h0RMEoRoAvF',
  PartnerEventLargeImage_Title: '_3fsjzvni7TQ1NphLHM_5r3',
  PartnerEventLargeImage_Summary: '_3zwBRDW1egliiT4pKYIXap',
  PartnerEventLargeImage_TextColumn: '_2HzKE96Sc4z6KHN68gr4DS',
};

// Verified against the live Steam library. Runtime-resolved maps take precedence.
export const APP_SECTION_CLASSES_FALLBACK: CssClasses = {
  AppDetailsSection: '_2r4TK4BAuU-J4FuF_O7v_5',
  AppDetailsSectionContainer: '_31ptFGGMZrSQc5BCX1e5lm',
  AppDetailsSectionHasLabel: '_2G5B7o_YoI__u11--EFjal',
  RightColumnSection: '_3KfxIwlXEvum7FCD_AM2_t',
  Body: '_5uvIN6jXDXzzck59F-nhv',
  InnerContainer: '_2EEApFUXB7aWXBtitgV5dk',
};

export const SECTION_HEADER_CLASSES_FALLBACK: CssClasses = {
  Reset: '_3A_c3YHYd4YIjA8Y-olnPl',
  PadLeft: '_1Q2q_tQ9_Eq8YdEHNAHS3F',
  SectionHeader: '_3jY6xWI4URhFyYsanh9VKL',
  Label: '_1SQ30LQnUhED7sXI79rmas',
  LabelText: '_3i0kopAostOz2IDi9HqmeN',
};


/*****************************************************************************/
/* Helper Functions                                                          */
/*****************************************************************************/

/**
 * Copies the fallback map and overlays valid class names from a resolved module.
 * Empty strings, the literal "undefined", and non-string values are ignored.
 * Neither input is modified; additional module keys are retained.
 */
function withFallback(fallback: CssClasses, found: unknown): CssClasses {
  const resolved = { ...fallback };
  if (found && typeof found === 'object') {
    for (const [key, value] of Object.entries(found)) {
      if (typeof value === 'string' && value.length > 0 && value !== 'undefined')
      resolved[key] = value;
    }
  }
  return resolved;
}


/*****************************************************************************/
/* Functions                                                                 */
/*****************************************************************************/

/**
 * Resolves Steam's activity-feed layout classes on every call, allowing modules
 * loaded after the plugin to be discovered. Missing or invalid entries use a fallback
 * object list; lookup errors return the fallback map directly.
 */
export function feedClasses(): CssClasses {
  try {
    return withFallback(FEED_CLASSES_FALLBACK, findClassModule(m => m.ActivityFeedContainer && m.FetchMoreContainer && m.ViewLastNews));
  } catch {
    return FEED_CLASSES_FALLBACK;
  }
}

/**
 * Resolves Steam's activity-event and news-card classes on every call so late
 * module loads are picked up. Missing or invalid entries use a fallback
 * object list; lookup errors return the fallback map directly.
 */
export function eventClasses(): CssClasses {
  try {
    return withFallback(EVENT_CLASSES_FALLBACK, findClassModule(m => m.AppActivityDay && m.EventHeadline && m.ActivityAchievementUnlocked && m.PartnerEventMediumImage && m.PartnerEventMediumImage_Container));
  } catch {
    return EVENT_CLASSES_FALLBACK;
  }
}

/** Rating controls belong to a separate Steam CSS module from activity cards. */
export function ratingClasses(): CssClasses {
  try {
    return withFallback(RATING_CLASSES_FALLBACK, findClassModule(m => m.RatingBar && m.LikeIcon));
  } catch {
    return RATING_CLASSES_FALLBACK;
  }
}

/**
 * Resolves Steam's app-details section and container classes on every call so
 * late module loads are picked up. Missing or invalid entries use a fallback 
 * object list; lookup errors return the fallback map directly.
 */
export function appSectionClasses(): CssClasses {
  try {
    return withFallback(
      APP_SECTION_CLASSES_FALLBACK,
      findClassModule(m =>
        m.AppDetailsSection &&
        m.AppDetailsSectionContainer &&
        m.AppDetailsSectionHasLabel &&
        m.RightColumnSection &&
        m.Body
      )
    );
  } catch {
    return APP_SECTION_CLASSES_FALLBACK;
  }
}

/**
 * Resolves Steam's section-heading, label, and spacing classes on every call so
 * late module loads are picked up. Missing or invalid entries use a fallback 
 * object list; lookup errors return the fallback map directly.
 */
export function sectionHeaderClasses(): CssClasses {
  try {
    return withFallback(
      SECTION_HEADER_CLASSES_FALLBACK,
      findClassModule(m =>
        m.SectionHeader &&
        m.Label &&
        m.LabelText &&
        m.Reset &&
        m.PadLeft
      )
    );
  } catch {
    return SECTION_HEADER_CLASSES_FALLBACK;
  }
}
