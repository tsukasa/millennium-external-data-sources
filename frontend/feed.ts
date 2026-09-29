import { decodeResponse } from './transport';

/** Normalized input for the news-card renderer. */
export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  contents: string;
  date: number | null;
  feedlabel?: string;
  image?: string;
}

/** Returns direct child elements with the given local name. */
const children = (element: Element, name: string) => Array.from(element.children).filter(child => child.localName === name);

/** Returns the first direct child element with the given local name. */
const child = (element: Element, name: string) => children(element, name)[0];

/** Returns trimmed text from the first matching direct child element. */
const text = (element: Element, name: string) => child(element, name)?.textContent?.trim() || '';


/*****************************************************************************/
/* Helper Functions                                                          */
/*****************************************************************************/

/** Resolves inherited xml:base attributes from the feed root through an element. */
function baseUrl(element: Element, source: string): string {
  const chain: Element[] = [];

  for (let node: Element | null = element; node; node = node.parentElement) {
    chain.unshift(node);
  }

  for (const node of chain) {
    const base = node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base');
    
    if (base)
      source = httpUrl(base, source) || source;
  }

  return source;
}

/** Extracts visible text from an HTML fragment and normalizes whitespace. */
function plainText(value: string, parser: DOMParser): string {
  const html = parser.parseFromString(value, 'text/html');
  html.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
  return (html.body.textContent || '').replace(/\s+/g, ' ').trim();
}


/*****************************************************************************/
/* Functions                                                                 */
/*****************************************************************************/

/**
 * Resolves a URL and accepts only HTTP or HTTPS destinations.
 * @param value URL to validate or resolve.
 * @param base Optional base URL for relative values.
 * @returns The absolute URL, or undefined if it is invalid or unsupported.
 */
export function httpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parses an RSS 2.0 or Atom 1.0 feed into deduplicated news items, newest first.
 * Entries without a valid HTTP or HTTPS link are omitted.
 * @param xml Feed XML to parse.
 * @param source Feed URL used to resolve relative links.
 * @param parser DOM parser, injectable for testing.
 * @returns Normalized news items.
 * @throws If the XML is invalid or is not a supported feed format.
 */
export function parseFeed(xml: string, source: string, parser = new DOMParser()): NewsItem[] {
  const doc = parser.parseFromString(xml, 'application/xml');
  
  if (doc.getElementsByTagName('parsererror').length)
    throw new Error('Invalid feed XML');
  
  const root = doc.documentElement;
  const atom = root?.localName === 'feed' && root.namespaceURI === 'http://www.w3.org/2005/Atom';
  const channel = root?.localName === 'rss' ? child(root, 'channel') : undefined;
  
  if (!atom && !channel)
    throw new Error('Expected an RSS 2.0 or Atom 1.0 feed');
  
  const container = atom ? root : channel!;
  const entries = children(container, atom ? 'entry' : 'item');
  const label = plainText(text(container, 'title'), parser);
  const ids = new Set<string>();
  const urls = new Set<string>();
  const items: NewsItem[] = [];
  
  for (const entry of entries) {
    const link = atom
      ? children(entry, 'link').find(node => !node.getAttribute('rel') || node.getAttribute('rel') === 'alternate')
      : child(entry, 'link');
    const rawLink = atom
      ? link?.getAttribute('href') || ''
      : link?.textContent?.trim() || '';
    const url = rawLink
      ? httpUrl(rawLink, baseUrl(link || entry, source))
      : undefined;

    if (!url)
      continue;

    const gid = text(entry, atom ? 'id' : 'guid') || url;

    if (ids.has(gid) || urls.has(url))
      continue;

    ids.add(gid); urls.add(url);

    const content = child(entry, atom ? 'content' : 'encoded') || child(entry, atom ? 'summary' : 'description');
    const rawContent = content?.getAttribute('type') === 'xhtml' ? content.innerHTML : content?.textContent || '';
    const html = parser.parseFromString(rawContent, 'text/html');

    const media = Array.from(entry.getElementsByTagName('*')).filter(node =>
      node.namespaceURI === 'http://search.yahoo.com/mrss/' && ['content', 'thumbnail'].includes(node.localName));

    const enclosure = children(entry, atom ? 'link' : 'enclosure').filter(node =>
      (!atom || node.getAttribute('rel') === 'enclosure') && (node.getAttribute('type') || '').startsWith('image/'));

    let image: string | undefined;

    for (const node of [...media, ...enclosure]) {
      const value = node.getAttribute('url') || node.getAttribute('href');

      if (value && (!node.getAttribute('type') || node.getAttribute('type')!.startsWith('image/'))) {
        image = httpUrl(value, baseUrl(node, source));

        if (image)
          break;
      }
    }

    if (!image) {
      const value = html.querySelector('img[src]')?.getAttribute('src');
      if (value)
        image = httpUrl(value, baseUrl(content || entry, source));
    }

    const timestamp = Date.parse(text(entry, atom ? 'published' : 'pubDate') || text(entry, atom ? 'updated' : 'date'));

    items.push({
      gid,
      url,
      title: plainText(text(entry, 'title'), parser) || 'Untitled',
      contents: plainText(rawContent, parser),
      date: Number.isFinite(timestamp) ? timestamp / 1000 : null,
      feedlabel: label || 'News', image
    });
  }

  return items.sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
}

/** Fetches and caches parsed feeds by URL for ten minutes, sharing in-flight requests. */
export class FeedCache {
  private entries = new Map<string, { time: number; items: NewsItem[] }>();
  private pending = new Map<string, Promise<NewsItem[]>>();

  /**
   * @param fetcher Fetches the raw response for an app ID.
   * @param now Clock used to determine cache expiration.
   */
  constructor(private fetcher: (appId: string) => Promise<string>, private now = Date.now) {}

  /** Removes the cached entry and pending request for a feed URL. */
  invalidate(url: string) { this.entries.delete(url); this.pending.delete(url); }

  /** Removes all cached entries and pending requests. */
  clear() { this.entries.clear(); this.pending.clear(); }

  /**
   * Returns news items for a feed, fetching and parsing them when the cache expires.
   * @param appId App ID passed to the fetcher.
   * @param url Expected feed URL and cache key.
   * @throws If the response URL differs from the requested feed URL.
   */
  get(appId: string, url: string): Promise<NewsItem[]> {
    const cached = this.entries.get(url);

    if (cached && this.now() - cached.time < 600_000)
      return Promise.resolve(cached.items);

    const pending = this.pending.get(url);

    if (pending)
      return pending;

    const request = this.fetcher(appId).then(raw => {
      const response = decodeResponse<{ url: string; xml: string }>(raw);

      if (response.url !== url)
        throw new Error('Feed source changed during request');

      const items = parseFeed(response.xml, response.url);
      
      if (this.pending.get(url) === request)
        this.entries.set(url, { time: this.now(), items });

      return items;
    }).finally(() => {
      if (this.pending.get(url) === request)
        this.pending.delete(url);
    });

    this.pending.set(url, request);

    return request;
  }
}
