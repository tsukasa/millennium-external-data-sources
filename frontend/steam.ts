interface Subscription {
  Unregister(): void
}

export interface Popup {
  window?: Window;
  m_strName?: string
}

export interface SteamGlobals {
  LocalizationManager?: {
    m_mapTokens?: Map<string, string>;
    m_mapFallbackTokens?: Map<string, string>;
    GetPreferredLocales?(): string[];
  };

  MainWindowBrowserManager?: {
    m_lastLocation?: { pathname?: string };
    ShowURL?(url: string): void
  };

  appStore?: {
    allApps?: {
      appid: number
    }[]
  };

  g_PopupManager?: {
    GetExistingPopup(name: string): Popup | undefined;
    AddPopupCreatedCallback(callback: (popup: Popup) => void): Subscription;
    AddPopupDestroyedCallback?(callback: (popup: Popup) => void): Subscription;
  };
}

export const steam = () => window as Window & SteamGlobals;


/*****************************************************************************/
/* Functions                                                                 */
/*****************************************************************************/

export function loc(token: string, fallback: string): string {
  const manager = steam().LocalizationManager;
  return manager?.m_mapTokens?.get(token) || manager?.m_mapFallbackTokens?.get(token) || fallback;
}

export function dateLocales(): string[] {
  try {
    const preferred = steam().LocalizationManager?.GetPreferredLocales?.();
    if (Array.isArray(preferred) && preferred.every(locale => typeof locale === 'string')) return preferred;
  } catch {
    /* fall back to the Steam browser locale */
  }

  return [navigator.language || 'en-US'];
}

/** Match Steam's activity-date formatter: relative days, long month, older year. */
export function activityDate(date: Date): string {
  const dateDesc = [
    [0, 'Time_Today', 'Today'],
    [-1, 'Time_Yesterday', 'Yesterday'],
    [1, 'Time_Tomorrow', 'Tomorrow'],
  ] as const;
  const now = new Date();
  const locales = dateLocales();
  
  if (date.getFullYear() !== now.getFullYear())
    return date.toLocaleDateString(locales, { year: 'numeric', month: 'short', day: 'numeric' });

  // Compare local calendar days, including across daylight-saving transitions.
  for (const [offset, token, fallback] of dateDesc) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    
    if (date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate())
      return loc(token, fallback);
  }

  return date.toLocaleDateString(locales, { month: 'long', day: 'numeric' });
}

export function isNonSteamId(id: number): boolean {
  return Number.isInteger(id) && id >= 0x80000000 && id <= 0xffffffff;
}

export function activeAppId(): string | undefined {
  const path = steam().MainWindowBrowserManager?.m_lastLocation?.pathname || '';
  const match = path.match(/^\/library\/app\/(\d+)(?:\/|$)/);
  return match && isNonSteamId(Number(match[1])) ? String(Number(match[1])) : undefined;
}

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
