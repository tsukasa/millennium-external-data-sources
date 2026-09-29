import { beforeAll, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { FeedCache, httpUrl, parseFeed } from '../frontend/feed';
import { decodeResponse } from '../frontend/transport';

beforeAll(() => {
  Object.assign(globalThis, { DOMParser: new JSDOM().window.DOMParser });
});

const source = 'https://example.com/news/feed.xml';
const rss = (items: string) => `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Studio &amp; News</title>${items}</channel></rss>`;
const item = (title: string, date = '', extra = '') => `<item><title>${title}</title><link>/${title}</link><pubDate>${date}</pubDate>${extra}</item>`;

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
    <link rel="self" href="entry.xml"/><link rel="alternate" href="one"/><link rel="enclosure" type="image/png" href="cover.png"/>
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
  const entries = parseFeed(rss(item('safe', '', '<description><![CDATA[<script>alert(1)</script><b>Text</b><img src="cover.png">]]></description>') +
    '<item><title>Unsafe</title><link>javascript:alert(1)</link></item>' + item('plain')), source);

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

test('cache shares requests, expires, retries errors and ignores invalidated completions', async () => {
  let now = 0, calls = 0;
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
