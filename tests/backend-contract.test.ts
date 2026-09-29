import { expect, test } from 'bun:test';
import {
  EXTERNAL_NEWS_MIN_FETCH_INTERVAL, EXTERNAL_NEWS_MAX_FETCH_INTERVAL,
  EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES, EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES,
  EXTERNAL_NEWS_MAX_ITEMS, EXTERNAL_NEWS_DEFAULT_MAX_ITEMS,
} from '../frontend/constants';

test('frontend and Lua agree on persisted feed setting limits and defaults', async () => {
  const lua = await Bun.file(new URL('../backend/rpc_functions.lua', import.meta.url)).text();
  const constants = new Map([...lua.matchAll(/^local (FEED_\w+) = (\d+)$/gm)]
    .map(([, name, value]) => [name, Number(value)]));
  expect(constants.get('FEED_INTERVAL_MIN')).toBe(EXTERNAL_NEWS_MIN_FETCH_INTERVAL);
  expect(constants.get('FEED_INTERVAL_MAX')).toBe(EXTERNAL_NEWS_MAX_FETCH_INTERVAL);
  expect(constants.get('FEED_CONCURRENCY_MIN')).toBe(EXTERNAL_NEWS_MIN_CONCURRENT_FETCHES);
  expect(constants.get('FEED_CONCURRENCY_MAX')).toBe(EXTERNAL_NEWS_MAX_CONCURRENT_FETCHES);
  expect(constants.get('FEED_ITEMS_MAX')).toBe(EXTERNAL_NEWS_MAX_ITEMS);
  expect(constants.get('FEED_ITEMS_DEFAULT')).toBe(EXTERNAL_NEWS_DEFAULT_MAX_ITEMS);
});
