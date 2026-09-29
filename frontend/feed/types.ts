export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  contents: string;
  date: number | null;
  image?: string;
}

export interface FeedSourceSettings {
  url: string;
  showFeedInWhatsNew: boolean;
  maxItemsFromFeedInWhatsNew?: number;
}

export type FeedSourceSettingsByAppId = Record<string, FeedSourceSettings>;

export interface GlobalFeedSettings {
  refreshIntervalMinutes?: number;
  concurrentFetches?: number;
}

export interface FeedResponse {
  url: string;
  xml: string;
}

export interface FeedParseStats {
  appId: string;
  durationMs: number;
  itemCount: number;
}
