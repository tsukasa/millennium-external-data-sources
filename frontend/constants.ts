// Prefix for external news items.
export const EXTERNAL_NEWS_PREFIX = 'external-news:';

// Maximum age of external news items to be considered "recent" (in seconds).
export const EXTERNAL_NEWS_MAX_AGE = 30 * 24 * 60 * 60;

export const EXTERNAL_NEWS_DEFAULT_MAX_ITEMS = 3;
export const EXTERNAL_NEWS_MAX_ITEMS = 5;
export const EXTERNAL_NEWS_DEFAULT_FETCH_INTERVAL = 10;
export const EXTERNAL_NEWS_DEFAULT_CONCURRENT_FETCHES = 2;

export const EXTERNAL_NEWS_MIN_FETCH_INTERVAL = 10;
export const EXTERNAL_NEWS_MAX_FETCH_INTERVAL = 360;
export const EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES = 1;
export const EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES = 8;

// Various popup manager constants.
export const POPUP_DESKTOP_CLIENT_ACTIVITY = 'SP Desktop_uid0';
export const POPUP_BIG_PICTURE_ACTIVITY = 'SP BPM_uid0';
export const POPUP_ACTIVITY = [POPUP_DESKTOP_CLIENT_ACTIVITY, POPUP_BIG_PICTURE_ACTIVITY];
