import type { ActivityStore } from './activity-store';
import type { WhatsNewStore, NavigationStore } from './whats-new';
import { httpUrl } from '../feed/parser';

export interface AppOverview {
  appid: number;
  rt_original_release_date: number;
  rt_purchased_time?: number;
  __cachedReleaseYearString?: string;
  m_setStoreTags?: Set<number>;
  m_setStoreCategories?: Set<number>;
  BHasStoreTag?(tagId: number): boolean;
}

interface SteamAppStore {
  m_mapApps: Map<number, AppOverview>;
  GetAppOverviewByAppID(appId: number): AppOverview | null;
  GetLocalizationForStoreTag?(tagId: number): string | undefined;
  GetTopStoreTags?(query: string): { nTagId: number; nCount: number }[];
  m_mapStoreTagLocalization?: Record<number, string>;
}

interface ClientSettings {
  library_whats_new_show_only_product_updates?: boolean;
}

interface SettingsStore {
  clientSettings?: ClientSettings;
}

export interface SteamSubscription {
  Unregister(): void;
}

interface Popup {
  window?: Window;
  m_strName?: string;
}

interface LocalizationManager {
  GetPreferredLocales?(): string[];
}

interface BrowserLocation {
  pathname?: string;
}

export interface MainWindowBrowserManager {
  m_lastLocation?: BrowserLocation;
}

interface HeroImages {
  rgHeroImages: string[];
}

interface AppDetailsStore {
  GetHeroImages?(app: unknown): HeroImages;
  GetAppData?(appId: number): AppData | undefined;
  m_mapAppData?: Map<number, AppData>;
}

export interface AssociationData {
  rgDevelopers: { strName: string; strURL: string }[];
  rgPublishers: { strName: string; strURL: string }[];
  rgFranchises?: { strName: string; strURL: string }[];
}

export interface AppData {
  associationData: AssociationData | null;
}

export interface LibraryFilter {
  searchText: string;
  GetTagsString(): string;
  GetAllSelectedOptions(): { option: number }[];
}

export interface SteamCollection {
  internalAppFilter?: LibraryFilter;
  Save(): Promise<unknown>;
}

interface PopupManager {
  GetExistingPopup(name: string): Popup | undefined;
  AddPopupCreatedCallback(callback: (popup: Popup) => void): SteamSubscription;
}

interface SteamGlobals {
  LocalizationManager?: LocalizationManager;
  MainWindowBrowserManager?: MainWindowBrowserManager;
  appStore?: SteamAppStore;
  collectionStore?: {
    OnAppOverviewChange(apps: AppOverview[], removedAppIds: number[]): void;
    NewUnsavedCollection?(name: string, filter: LibraryFilter | undefined, apps: AppOverview[]): SteamCollection;
  };
  appActivityStore?: ActivityStore;
  libraryEventStore?: WhatsNewStore;
  settingsStore?: SettingsStore;
  tempNavStore?: NavigationStore;
  appDetailsStore?: AppDetailsStore;
  g_PopupManager?: PopupManager;
  App?: { m_CurrentUser?: { strSteamID?: string } };
}

// Millennium's Window declaration exposes a different subset of the private
// stores. Narrow that external boundary once; consumers use the contracts above.
export const steam = () => window as unknown as Window & SteamGlobals;

/** Preferred Steam locales, with the browser language as fallback. */
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

/** Configured shortcut candidate on the current library detail route. */
export function activeAppId(): string | undefined {
  const path = steam().MainWindowBrowserManager?.m_lastLocation?.pathname || '';
  const match = path.match(/^\/library\/app\/(\d+)(?:\/|$)/);
  return match && isNonSteamId(Number(match[1])) ? String(Number(match[1])) : undefined;
}

/** Open HTTP(S) articles through Steam without navigating its current page. */
export function openArticle(doc: Document, url: string) {
  const article = httpUrl(url, doc.baseURI);

  if (!article)
    return;

  const link = doc.createElement('a');
  link.href = article;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';

  doc.body.append(link);
  link.click();
  link.remove();
}
