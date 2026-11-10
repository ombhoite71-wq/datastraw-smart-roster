/**
 * Smart Roster Management System - Pure Calendar & Availability Helpers
 * Strictly follows PROJECT_SPEC.md Section 5.1, 5.2, 5.4.
 * All date operations use explicit UTC components to avoid local timezone drift.
 */

import {
  CoverageRule,
  Employee,
  Holiday,
  Leave,
  Process,
  RosterEntry,
  Weekday,
  WeekWindow,
} from './types';

const WEEKDAY_NAMES_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAY_NAMES_SHORT = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/**
 * Parses a "YYYY-MM-DD" string into a UTC Date at 00:00:00Z.
 */
export function parseDateUTC(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);
  return new Date(Date.UTC(year, month, day));
}

/**
 * Formats a UTC Date object into "YYYY-MM-DD".
 */
export function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the day of the week (0 = Sunday ... 6 = Saturday) for "YYYY-MM-DD".
 */
export function getWeekday(dateStr: string): Weekday {
  return parseDateUTC(dateStr).getUTCDay() as Weekday;
}

/**
 * Returns display name for a weekday (0 = Sunday ... 6 = Saturday).
 */
export function getWeekdayName(weekday: number, short = false): string {
  const normalized = ((weekday % 7) + 7) % 7;
  return short ? WEEKDAY_NAMES_SHORT[normalized] : WEEKDAY_NAMES_LONG[normalized];
}

/**
 * Returns true if the given weekday is Saturday (6) or Sunday (0).
 */
export function isWeekend(dateStr: string): boolean {
  const day = getWeekday(dateStr);
  return day === 0 || day === 6;
}

/**
 * Returns absolute signed difference in days (dateB - dateA).
 */
export function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 86_400_000;
  const utcA = parseDateUTC(dateA).getTime();
  const utcB = parseDateUTC(dateB).getTime();
  return Math.round((utcB - utcA) / msPerDay);
}

/**
 * Builds all "YYYY-MM-DD" dates in a given "YYYY-MM" month in chronological order.
 */
export function getMonthDates(month: string): string[] {
  const [yearStr, monthNumStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthNumStr) - 1;

  const dates: string[] = [];
  const cursor = new Date(Date.UTC(year, monthIndex, 1));

  while (cursor.getUTCMonth() === monthIndex) {
    dates.push(formatDateUTC(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Splits a month ("YYYY-MM") into Monday-to-Sunday week windows clipped to the month.
 * Per Section 5.4:
 * - Each employee needs one weekly off per Mon-Sun week, clipped to the month.
 * - A partial week at the month edge needs an off only if it has at least
 *   `partialWeekMinDays` (default 4) days in the month.
 */
export function getMonthWeeks(
  month: string,
  partialWeekMinDays = 4
): WeekWindow[] {
  const allDates = getMonthDates(month);
  if (allDates.length === 0) return [];

  const weeks: WeekWindow[] = [];
  let currentDates: string[] = [];

  for (const dateStr of allDates) {
    const weekday = getWeekday(dateStr);
    // Start a new week on Monday (weekday === 1) if we already accumulated dates
    if (weekday === 1 && currentDates.length > 0) {
      weeks.push({
        weekIndex: weeks.length,
        startDate: currentDates[0],
        endDate: currentDates[currentDates.length - 1],
        dates: currentDates,
        requiresWeeklyOff: currentDates.length >= partialWeekMinDays,
      });
      currentDates = [];
    }
    currentDates.push(dateStr);
  }

  if (currentDates.length > 0) {
    weeks.push({
      weekIndex: weeks.length,
      startDate: currentDates[0],
      endDate: currentDates[currentDates.length - 1],
      dates: currentDates,
      requiresWeeklyOff: currentDates.length >= partialWeekMinDays,
    });
  }

  return weeks;
}

/**
 * Returns the missing weekdays (0-6) that were clipped off a partial Mon-Sun week
 * at the start or end of the month. For a full 7-day week, returns [].
 */
export function getClippedWeekdaysForPartialWeek(week: WeekWindow): Weekday[] {
  if (week.dates.length >= 7) return [];
  const present = new Set<number>(week.dates.map((d) => getWeekday(d)));
  const missing: Weekday[] = [];
  for (let d = 0; d <= 6; d++) {
    if (!present.has(d)) {
      missing.push(d as Weekday);
    }
  }
  return missing;
}

/**
 * Checks whether a given date ("YYYY-MM-DD") is a company-wide public holiday.
 */
export function getHolidayOnDate(
  date: string,
  holidays: Holiday[]
): Holiday | undefined {
  return holidays.find((h) => h.date === date);
}

/**
 * Returns true if the given date is a public holiday.
 */
export function isHolidayDate(date: string, holidays: Holiday[]): boolean {
  return Boolean(getHolidayOnDate(date, holidays));
}

/**
 * Section 5.1: Determines if a process is open on a specific date.
 * Closed means:
 * - the weekday is not in `process.openDays`, OR
 * - the date is a holiday and `process.operatesOnHolidays` is false.
 */
export function isProcessOpen(
  process: Process,
  date: string,
  holidays: Holiday[]
): boolean {
  const weekday = getWeekday(date);
  if (!process.openDays.includes(weekday)) {
    return false;
  }
  if (isHolidayDate(date, holidays) && !process.operatesOnHolidays) {
    return false;
  }
  return true;
}

/**
 * Section 5.1: Computes required staffing for a process on a date.
 * 1. If the process is closed that date, return 0.
 * 2. Otherwise, if a date-specific CoverageRule exists, use it.
 * 3. Otherwise, if a weekday-specific CoverageRule exists, use it.
 * 4. Otherwise, use the process default `minStaff`.
 */
export function requiredStaff(
  process: Process,
  date: string,
  holidays: Holiday[],
  coverageRules: CoverageRule[]
): number {
  if (!isProcessOpen(process, date, holidays)) {
    return 0;
  }

  // 2. Date-specific override
  const dateRule = coverageRules.find(
    (r) => r.processId === process.id && r.date === date
  );
  if (dateRule !== undefined) {
    return dateRule.minStaff;
  }

  // 3. Weekday-specific override
  const weekday = getWeekday(date);
  const weekdayRule = coverageRules.find(
    (r) =>
      r.processId === process.id &&
      (r.date === null || r.date === '') &&
      r.weekday === weekday
  );
  if (weekdayRule !== undefined) {
    return weekdayRule.minStaff;
  }

  // 4. Default process minStaff
  return process.minStaff;
}

/**
 * Checks if `date` falls within `[startDate, endDate]` inclusive ("YYYY-MM-DD" lexical order).
 */
export function isDateInRange(
  date: string,
  startDate: string,
  endDate: string
): boolean {
  return date >= startDate && date <= endDate;
}

/**
 * Returns an APPROVED leave or comp-off covering `employeeId` on `date`, if any.
 * Per Section 4.1 & 5.2: Only APPROVED leaves block availability; PENDING is ignored.
 */
export function getApprovedLeaveOnDate(
  employeeId: string,
  date: string,
  leaves: Leave[]
): Leave | undefined {
  return leaves.find(
    (l) =>
      l.employeeId === employeeId &&
      l.status === 'APPROVED' &&
      isDateInRange(date, l.startDate, l.endDate)
  );
}

/**
 * Section 5.2: An employee is available on a date only if all of these are true:
 * - `active` is true.
 * - No APPROVED Leave / COMP_OFF covers the date.
 * - Their roster status for that date is WORK (once a roster entry exists).
 */
export function isEmployeeAvailable(
  employee: Employee,
  date: string,
  leaves: Leave[],
  entry?: RosterEntry
): boolean {
  if (!employee.active) {
    return false;
  }
  if (getApprovedLeaveOnDate(employee.id, date, leaves)) {
    return false;
  }
  if (entry && entry.status !== 'WORK') {
    return false;
  }
  return true;
}
