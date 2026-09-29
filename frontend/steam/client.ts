import type { ActivityStore } from './activity-store';
import type { WhatsNewStore, NavigationStore } from './whats-new';

export interface AppOverview {
  appid: number;
  rt_original_release_date: number;
  __cachedReleaseYearString?: string;
}

export interface SteamAppStore {
  allApps?: AppOverview[];
  m_mapApps: Map<number, AppOverview>;
  GetAppOverviewByAppID(appId: number): AppOverview | null;
}

export interface ClientSettings {
  library_whats_new_show_only_product_updates?: boolean;
}

export interface SettingsStore {
  clientSettings?: ClientSettings;
}

export interface SteamSubscription {
  Unregister(): void
}

export interface Popup {
  window?: Window;
  m_strName?: string
}

export interface LocalizationManager {
  m_mapTokens?: Map<string, string>;
  m_mapFallbackTokens?: Map<string, string>;
  GetPreferredLocales?(): string[];
}

export interface BrowserLocation {
  pathname?: string
}

export interface MainWindowBrowserManager {
  m_lastLocation?: BrowserLocation;
  ShowURL?(url: string): void;
}

export interface HeroImages {
  rgHeroImages: string[]
}

export interface AppDetailsStore {
  GetHeroImages?(app: unknown): HeroImages;
}

export interface PopupManager {
  GetExistingPopup(name: string): Popup | undefined;
  AddPopupCreatedCallback(callback: (popup: Popup) => void): SteamSubscription;
  AddPopupDestroyedCallback?(callback: (popup: Popup) => void): SteamSubscription;
}

export interface SteamGlobals {
  LocalizationManager?: LocalizationManager;
  MainWindowBrowserManager?: MainWindowBrowserManager;
  appStore?: SteamAppStore;
  appActivityStore?: ActivityStore;
  libraryEventStore?: WhatsNewStore;
  settingsStore?: SettingsStore;
  tempNavStore?: NavigationStore;
  appDetailsStore?: AppDetailsStore;
  g_PopupManager?: PopupManager;
}

// Millennium's Window declaration exposes a different subset of the private
// stores. Narrow that external boundary once; consumers use the contracts above.
export const steam = () => window as unknown as Window & SteamGlobals;

/**
 * Preferred Steam locales, with the browser language as fallback.
 * @returns An array of preferred locale strings, with the browser language as fallback.
 */
export function dateLocales(): string[] {
  try {
    const preferred = steam().LocalizationManager?.GetPreferredLocales?.();
    if (Array.isArray(preferred) && preferred.every(locale => typeof locale === 'string')) return preferred;
  } catch {
    /* fall back to the Steam browser locale */
  }

  return [navigator.language || 'en-US'];
}

/** Shortcut IDs occupy the unsigned upper half of the AppID range. */
export function isNonSteamId(id: number): boolean {
  return Number.isInteger(id) && id >= 0x80000000 && id <= 0xffffffff;
}

/**
 * Configured shortcut candidate on the current library detail route.
 * @returns The active AppID as a string if it is a non-Steam ID, otherwise undefined.
 */
export function activeAppId(): string | undefined {
  const path = steam().MainWindowBrowserManager?.m_lastLocation?.pathname || '';
  const match = path.match(/^\/library\/app\/(\d+)(?:\/|$)/);
  return match && isNonSteamId(Number(match[1])) ? String(Number(match[1])) : undefined;
}

/**
 * Open HTTP(S) articles through Steam without navigating its current page.
 * @param doc The document context in which to create the link. Usually the card's document.
 * @param url The URL of the article to open.
 */
export function openArticle(doc: Document, url: string) {
  let article: URL;

  try {
    article = new URL(url, doc.baseURI);
  } catch {
    return;
  }

  if (article.protocol !== 'http:' && article.protocol !== 'https:')
    return;

  const link = doc.createElement('a');
  link.href = article.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';

  doc.body.append(link);
  link.click();
  link.remove();
}
