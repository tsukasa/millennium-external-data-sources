/** A calendar date with no time or timezone in Millennium's configuration. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const MIN_RELEASE_YEAR = 1960;
export const maxReleaseYear = () => new Date().getFullYear() + 1;

/**
 * Get the number of days in a given month of a specific year.
 * @param year The year.
 * @param month The month (1-12).
 * @returns The number of days in the month.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28;

  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
}

/**
 * Check if a value is a CalendarDate.
 * @param value The value to check.
 * @returns True if the value is a CalendarDate, false otherwise.
 */
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (!value || typeof value !== 'object')
    return false;

  const { year, month, day } = value as Partial<CalendarDate>;
  return typeof year === 'number' && typeof month === 'number' && typeof day === 'number'
    && Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    && year >= MIN_RELEASE_YEAR && year <= maxReleaseYear() && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Convert a JavaScript Date object to a CalendarDate.
 * @param date The Date object to convert.
 * @returns A CalendarDate representing the same date.
 */
export function toCalendarDate(date: Date): CalendarDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}
