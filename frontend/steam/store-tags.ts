import { steam } from './client';

export type StoreTag = string | number;

export function storeTagName(tag: StoreTag): string {
  return typeof tag === 'string' ? tag
    : steam().appStore?.GetLocalizationForStoreTag?.(tag)
      || steam().appStore?.m_mapStoreTagLocalization?.[tag] || String(tag);
}

export function findStoreTags(query: string): { id: number; name: string }[] {
  const store = steam().appStore;
  const search = query.trim().toLocaleLowerCase();

  if (!search)
    return [];

  const ids = store?.GetTopStoreTags?.(search).map(tag => tag.nTagId)
    || Object.entries(store?.m_mapStoreTagLocalization || {})
      .filter(([, name]) => name.toLocaleLowerCase().includes(search))
      .map(([id]) => Number(id));

  return ids.filter(id => Number.isSafeInteger(id) && id > 0)
    .map(id => ({
      id,
      name: storeTagName(id)
    }));
}

// The native Players filters read store categories rather than store tags.
export const PLAYER_TAG_CATEGORIES: Readonly<Record<number, number>> = {
  4182: 2, // Singleplayer
  3859: 1, // Multiplayer
  1685: 9, // Co-op
  3841: 24, // Local Co-op
  7368: 37, // Local Multiplayer
  128: 20, // Massively Multiplayer
};
