import { decodeResponse } from '../transport';
import { getPluginI18nString } from '../i18n';
import { isCalendarDate, toCalendarDate, type CalendarDate } from './calendar-date';

export class ReleaseDateManager {
  dates: Record<string, CalendarDate> = {};
  private loading?: Promise<void>;
  private listeners = new Set<() => void>();

  /**
   * Load the release dates from the backend.
   * @returns A promise that resolves when the release dates have been loaded.
   */
  load(): Promise<void> {
    return this.loading ||= backend.getReleaseDates().then(response => {
      const dates = decodeResponse<Record<string, unknown>>(response) || {};
      this.dates = Object.fromEntries(Object.entries(dates).filter((entry): entry is [string, CalendarDate] =>
        isCalendarDate(entry[1])));
      this.notify();
    }).catch(error => {
      this.loading = undefined;
      throw error;
    });
  }

  /**
   * Set the release date for a specific appId.
   * @param appId The ID of the app.
   * @param date The release date to set.
   * @returns A promise that resolves when the release date has been set.
   */
  async set(appId: string, date: Date): Promise<void> {
    const calendarDate = toCalendarDate(date);

    if (!isCalendarDate(calendarDate) || !await backend.setReleaseDate(appId,
      calendarDate.year, calendarDate.month, calendarDate.day))
      throw new Error(getPluginI18nString('couldNotSaveReleaseDate'));

    this.dates[appId] = calendarDate;
    this.notify();
  }

  /**
   * Clear the release date for a specific appId.
   * @param appId The ID of the app.
   * @returns A promise that resolves when the release date has been cleared.
   */
  async clear(appId: string): Promise<void> {
    if (!await backend.clearReleaseDate(appId))
      throw new Error(getPluginI18nString('couldNotRemoveReleaseDate'));

    delete this.dates[appId];
    this.notify();
  }

  /**
   * Subscribe to changes in the release dates.
   * @param listener The listener function to call when the release dates change.
   * @returns A function to unsubscribe the listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Notify all subscribed listeners of changes in the release dates.
   */
  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  /**
   * Dispose of the release date manager, clearing all listeners.
   */
  dispose(): void {
    this.listeners.clear();
  }
}
