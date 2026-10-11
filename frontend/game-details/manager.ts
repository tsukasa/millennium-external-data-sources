import { backendWrite, decodeResponse } from '../transport';
import { notifyListeners } from '../listeners';
import { getPluginI18nString } from '../i18n';
import { isCalendarDate, type CalendarDate } from './calendar-date';
import type { StoreTag } from '../steam/store-tags';

export interface GameDetails {
  releaseDate?: CalendarDate;
  addedToLibraryDate?: CalendarDate;
  developer?: string[];
  publisher?: string[];
  tags?: StoreTag[];
}

export type GameDetailField = keyof GameDetails;
const GAME_DETAIL_FIELDS = [
  'releaseDate',
  'addedToLibraryDate',
  'developer',
  'publisher',
  'tags'
] as const;

function normalizeNames(value: unknown, allowTagIds: boolean): StoreTag[] | undefined {
  if (!Array.isArray(value))
    return undefined;

  const valid = value.every(name => typeof name === 'string'
    || (allowTagIds && typeof name === 'number' && Number.isSafeInteger(name) && name > 0));

  if (!valid)
    return undefined;

  return [...new Set(value.map(name => typeof name === 'string' ? name.trim() : name).filter(Boolean))];
}

function readGameDetails(entry: Record<string, unknown>): GameDetails {
  const details: GameDetails = {};

  for (const field of GAME_DETAIL_FIELDS) {
    const value = entry[field];

    if (field === 'developer' || field === 'publisher' || field === 'tags') {
      // Older settings stored a single name rather than an array.
      const names = typeof value === 'string' ? [value] : value;
      const normalized = normalizeNames(names, field === 'tags');

      if (normalized?.length)
        Object.assign(details, { [field]: normalized });
    } else if (isCalendarDate(value)) {
      details[field] = value;
    }
  }

  return details;
}

function normalizeGameDetail(field: GameDetailField, value: unknown): string | StoreTag[] {
  if (field === 'developer' || field === 'publisher' || field === 'tags') {
    const names = normalizeNames(value, field === 'tags');
    if (names)
      return names;
  } else if (typeof value === 'string') {
    const date = value.trim();
    if (!date || isCalendarDate(date))
      return date;
  }

  throw new Error(getPluginI18nString('couldNotSaveGameDetails'));
}

export class GameDetailsManager {
  details: Record<string, GameDetails> = {};
  private loading?: Promise<void>;
  private listeners = new Set<() => void>();

  load(): Promise<void> {
    return this.loading ||= backend.getGameDetails().then(response => {
      const saved = decodeResponse<Record<string, unknown>>(response) || {};
      this.details = {};

      for (const [id, entry] of Object.entries(saved)) {
        if (!entry || typeof entry !== 'object')
          continue;

        const details = readGameDetails(entry as Record<string, unknown>);

        if (Object.keys(details).length)
          this.details[id] = details;
      }

      this.notify();
    }).catch(error => {
      this.loading = undefined;
      throw error;
    });
  }

  /** Empty values remove that override; other game details remain untouched. */
  async set<K extends GameDetailField>(appId: string, field: K, value: NonNullable<GameDetails[K]>): Promise<void> {
    const normalized = normalizeGameDetail(field, value);
    const encoded = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);

    await backendWrite(() => backend.setGameDetail(appId, field, encoded),
      getPluginI18nString('couldNotSaveGameDetails'));

    const details = { ...this.details[appId] };

    if (normalized.length)
      Object.assign(details, { [field]: normalized });
    else
      delete details[field];

    if (Object.keys(details).length)
      this.details[appId] = details;
    else
      delete this.details[appId];

    this.notify();
  }

  async clear(appId: string): Promise<void> {
    await backendWrite(() => backend.clearGameDetails(appId), getPluginI18nString('couldNotRemoveGameDetails'));

    if (!Object.prototype.hasOwnProperty.call(this.details, appId))
      return;

    delete this.details[appId];
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    notifyListeners(this.listeners);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
