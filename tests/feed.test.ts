import { beforeAll, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { FeedCache, httpUrl, parseFeed } from '../frontend/feed';
import { decodeResponse } from '../frontend/transport';
import { openArticle } from '../frontend/steam/client';

beforeAll(() => {
  Object.assign(globalThis, { DOMParser: new JSDOM().window.DOMParser });
});

const source = 'https://example.com/news/feed.xml';
const rss = (items: string) => `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Studio &amp; News</title>${items}</channel></rss>`;
const item = (title: string, date = '', extra = '') =>
  `<item><title>${title}</title><link>/${title}</link><pubDate>${date}</pubDate>${extra}</item>`;
const htmlDescription = (html: string) => `<description><![CDATA[${html}]]></description>`;

test('article links resolve against their document and reject invalid or non-HTTP URLs', () => {
  const doc = new JSDOM('<body></body>', { url: source }).window.document;
  const opened: HTMLAnchorElement[] = [];
  doc.addEventListener('click', event => {
    event.preventDefault();
    opened.push(event.target as HTMLAnchorElement);
  });
  for (const url of ['../article', 'http://studio.test/news', 'javascript:alert(1)', 'data:text/html,test', 'http://['])
    openArticle(doc, url);
  expect(opened.map(link => link.href)).toEqual(['https://example.com/article', 'http://studio.test/news']);
  expect(opened.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer')).toBe(true);
  expect(doc.querySelector('a')).toBeNull();
});

test('live Millennium FFI already decodes JSON responses', async () => {
  expect(decodeResponse<Record<string, string>>({ '3900360037': source })).toEqual({ '3900360037': source });
  const response = { url: source, xml: rss(item('live')) };
  const cache = new FeedCache(async () => response as unknown as string);
  expect((await cache.get('3900360037', source))[0].title).toBe('live');
});

test('RSS: dates, stable undated order, CDATA, deduplication, namespaces and media', () => {
  const entries = parseFeed(
    rss(
      item(
        'old',
        'Mon, 01 Jan 2024 10:00:00 GMT') +
      item(
        'new',
        'Tue, 02 Jan 2024 10:00:00 GMT',
        '<content:encoded><![CDATA[<p>Hello &amp; goodbye</p>]]></content:encoded><media:thumbnail url="../cover.png"/>'
      ) +
      item('new') +
      item('undated') +
      item(
        'invalid-date',
        'nonsense'
      )
    ),
    source
  );

  expect(entries.map(entry => entry.title)).toEqual(['new', 'old', 'undated', 'invalid-date']);

  expect(entries[0]).toMatchObject({
    contents: 'Hello & goodbye',
    image: 'https://example.com/cover.png'
  });

  expect(entries[2].date).toBeNull();
});

test('Atom: xml:base, alternate links, updated fallback, XHTML and enclosure', () => {
  const entries = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://studio.test/">
    <title>Studio</title><entry xml:base="updates/"><id>1</id><title>Update</title>
    <link rel="self" href="entry.xml"/><link rel="alternate" href="one"/>
    <link rel="enclosure" type="image/png" href="cover.png"/>
    <updated>2026-09-01T12:00:00+02:00</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Patch notes</p></div></content>
    </entry></feed>`, source);

  expect(entries[0]).toMatchObject({
    gid: '1',
    url: 'https://studio.test/updates/one',
    image: 'https://studio.test/updates/cover.png',
    contents: 'Patch notes'
  });

  expect(entries[0].date).toBe(Date.parse('2026-09-01T10:00:00Z') / 1000);
});

test('safe text and links, HTML image fallback and no image', () => {
  const unsafe = '<item><title>Unsafe</title><link>javascript:alert(1)</link></item>';
  const safe = item('safe', '', htmlDescription('<script>alert(1)</script><b>Text</b><img src="cover.png">'));
  const entries = parseFeed(rss(safe + unsafe + item('plain')), source);

  expect(entries).toHaveLength(2);
  expect(entries[0].contents).toBe('Text');
  expect(entries[0].image).toBe('https://example.com/news/cover.png');
  expect(entries[1].image).toBeUndefined();
  expect(httpUrl('data:text/html,test')).toBeUndefined();
});

test('empty and unsupported feeds', () => {
  expect(parseFeed(rss(''), source)).toEqual([]);
  expect(() => parseFeed('<html>Not a feed</html>', source)).toThrow();
  expect(() => parseFeed('<rss><channel><item></channel></rss>', source)).toThrow('Invalid feed XML');
});

test('image selection precedes removal of non-visible HTML content', () => {
  const xml = rss(item('cover', '', htmlDescription('<object><img src="cover.png"></object><p>Visible text</p>')));
  expect(parseFeed(xml, source)[0]).toMatchObject({
    contents: 'Visible text',
    image: 'https://example.com/news/cover.png',
  });
});

test('cache shares requests, expires, retries errors and ignores invalidated completions', async () => {
  let now = 0;
  let calls = 0;
  let resolve!: (value: string) => void;

  const cache = new FeedCache(async () => {
    calls++;
    return new Promise<string>(done => {
      resolve = done;
    });
  }, () => now);

  const first = cache.get('2147483648', source);

  expect(cache.get('2147483649', source)).toBe(first);

  resolve(JSON.stringify({
    url: source,
    xml: rss(item('one'))
  }));

  await first;
  await cache.get('2147483648', source);
  expect(calls).toBe(1);

  now = 600_001;
  const expired = cache.get('2147483648', source);
  expect(calls).toBe(2);

  cache.invalidate(source);

  resolve(JSON.stringify({
    url: source,
    xml: rss(item('old'))
  }));

  await expired;
  const fresh = cache.get('2147483648', source);
  expect(calls).toBe(3);

  resolve(JSON.stringify({
    url: source,
    xml: rss(item('fresh'))
  }));

  await fresh;
  let attempts = 0;

  const failing = new FeedCache(async () => {
    attempts++;
    throw new Error('offline');
  });

  await expect(failing.get('2147483648', source)).rejects.toThrow('offline');
  await expect(failing.get('2147483648', source)).rejects.toThrow('offline');
  expect(attempts).toBe(2);
});

test('large feeds keep only the newest entries and parse HTML for those alone', () => {
  const entries = Array.from({ length: 60 }, (_, index) =>
    item(`post-${index}`, new Date(Date.UTC(2026, 0, 1 + index)).toUTCString(),
      '<description>&lt;b&gt;Body&lt;/b&gt;</description>'));
  const parser = new DOMParser();
  const parse = parser.parseFromString.bind(parser);
  let htmlParses = 0;
  parser.parseFromString = ((text: string, type: DOMParserSupportedType) => {
    if (type === 'text/html') htmlParses++;
    return parse(text, type);
  }) as typeof parser.parseFromString;

  const parsed = parseFeed(rss(entries.reverse().join('')), source, parser, 5);
  expect(parsed.map(entry => entry.title)).toEqual(['post-59', 'post-58', 'post-57', 'post-56', 'post-55']);
  expect(parsed[0].contents).toBe('Body');
  // One content document and one title document per kept entry.
  expect(htmlParses).toBe(10);
  expect(parseFeed(rss(entries.join('')), source)).toHaveLength(50);
});
