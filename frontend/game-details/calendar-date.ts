/** An ISO calendar date (YYYY-MM-DD), without a time or timezone. */
export type CalendarDate = string;

export const MIN_RELEASE_YEAR = 1960;
export const maxReleaseYear = () => new Date().getFullYear() + 1;

/** Get the number of days in a given month of a specific year. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28;

  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
}

/** Check if a value is a CalendarDate. */
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;

  const [year, month, day] = value.split('-').map(Number);

  return year >= MIN_RELEASE_YEAR && year <= maxReleaseYear()
    && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month);
}

/** Convert a JavaScript Date object to a CalendarDate. */
export function toCalendarDate(date: Date): CalendarDate {
  // Example: 2026-04-27
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}
