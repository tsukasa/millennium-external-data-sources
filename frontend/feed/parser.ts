import { EXTERNAL_NEWS_MAX_PARSED_ITEMS } from '../constants';
import type { NewsItem } from './types';

/** Returns direct child elements with the given local name. */
const children = (element: Element, name: string) =>
  Array.from(element.children).filter(child => child.localName === name);

/** Returns the first direct child element with the given local name. */
const child = (element: Element, name: string) => children(element, name)[0];

/** Returns trimmed text from the first matching direct child element. */
const text = (element: Element, name: string) => child(element, name)?.textContent?.trim() || '';

/** Resolves inherited xml:base attributes from the feed root through an element. */
function baseUrl(element: Element, source: string): string {
  const chain: Element[] = [];

  for (let node: Element | null = element; node; node = node.parentElement)
    chain.unshift(node);

  for (const node of chain) {
    const base = node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base');

    if (base)
      source = httpUrl(base, source) || source;
  }

  return source;
}

/** Extracts visible text from an HTML fragment and normalizes whitespace. */
function plainText(value: string, parser: DOMParser): string {
  return documentText(parser.parseFromString(value, 'text/html'));
}

/** Extracts visible text from an HTML document and normalizes whitespace. */
function documentText(html: Document): string {
  html.querySelectorAll('script,style,iframe,object')
    .forEach(node => node.remove());

  return (html.body.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolves a URL and accepts only HTTP or HTTPS destinations. */
export function httpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function entryUrl(entry: Element, atom: boolean, source: string): string | undefined {
  const link = atom
    ? children(entry, 'link').find(node => !node.getAttribute('rel') || node.getAttribute('rel') === 'alternate')
    : child(entry, 'link');
  const rawLink = atom
    ? link?.getAttribute('href') || ''
    : link?.textContent?.trim() || '';
  return rawLink
    ? httpUrl(rawLink, baseUrl(link || entry, source))
    : undefined;
}

function entryImage(entry: Element, atom: boolean, source: string, content: Element | undefined,
  html: Document): string | undefined {
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

  return image;
}

/**
 * Parses an RSS 2.0 or Atom 1.0 feed into deduplicated news items, newest first.
 * Entries without a valid HTTP or HTTPS link are omitted; only the newest `maxItems` are kept.
 * @throws If the XML is invalid or is not a supported feed format.
 */
export function parseFeed(xml: string, source: string, parser = new DOMParser(),
  maxItems = EXTERNAL_NEWS_MAX_PARSED_ITEMS): NewsItem[] {
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
  const ids = new Set<string>();
  const urls = new Set<string>();
  const candidates: { entry: Element; gid: string; url: string; date: number | null }[] = [];

  // Read only identity and date first; HTML parsing is the expensive part.
  for (const entry of entries) {
    const url = entryUrl(entry, atom, source);

    if (!url)
      continue;

    const gid = text(entry, atom ? 'id' : 'guid') || url;

    if (ids.has(gid) || urls.has(url))
      continue;

    ids.add(gid);
    urls.add(url);

    const timestamp = Date.parse(text(entry, atom ? 'published' : 'pubDate') || text(entry, atom ? 'updated' : 'date'));

    candidates.push({ entry, gid, url, date: Number.isFinite(timestamp) ? timestamp / 1000 : null });
  }

  const newest = candidates
    .sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity))
    .slice(0, maxItems);

  return newest.map(({ entry, gid, url, date }) => {
    const content = child(entry, atom ? 'content' : 'encoded') || child(entry, atom ? 'summary' : 'description');
    const rawContent = content?.getAttribute('type') === 'xhtml' ? content.innerHTML : content?.textContent || '';
    const html = parser.parseFromString(rawContent, 'text/html');
    // Select the image before documentText() removes non-visible elements.
    const image = entryImage(entry, atom, source, content, html);

    return {
      gid,
      url,
      title: plainText(text(entry, 'title'), parser) || 'Untitled',
      contents: documentText(html),
      date,
      image
    };
  });
}
