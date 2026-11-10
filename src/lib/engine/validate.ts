/**
 * Smart Roster Management System - Pure Roster Validator
 * Strictly follows PROJECT_SPEC.md Section 6.
 * Single source of truth for roster validity. Never mutates inputs.
 */

import {
  getApprovedLeaveOnDate,
  getClippedWeekdaysForPartialWeek,
  getMonthDates,
  getMonthWeeks,
  getWeekday,
  getWeekdayName,
  isProcessOpen,
} from './calendar';
import {
  buildRequirementMatrix,
  getAssignedEmployeesForProcess,
  getProcessesForEmployee,
  getWorkingEmployeesForProcessOnDate,
} from './requirements';
import {
  Brand,
  Employee,
  Holiday,
  Issue,
  Process,
  RosterEntry,
  Setting,
  ValidationInput,
  WeekWindow,
} from './types';

/**
 * Helper: Determines whether a given employee requires an off day inside `week`
 * (within the current month).
 * - Full 7-day weeks always require a weekly off.
 * - Partial weeks with `< partialWeekMinDays` never require a weekly off.
 * - Partial weeks with `>= partialWeekMinDays` (at the month boundary) do not require
 *   an off inside the clipped days if the employee's fixedOffDay or natural process-closed
 *   off day (e.g. Sunday for Mon-Sat brands) falls in the clipped-out days of that week.
 */
export function doesEmployeeRequireOffInWeek(
  employee: Employee,
  week: WeekWindow,
  empProcesses: Process[],
  holidays: Holiday[],
  settings: Setting
): boolean {
  if (!week.requiresWeeklyOff) {
    return false;
  }

  // Full 7-day week inside the month always requires 1 weekly off
  if (week.dates.length >= 7) {
    return true;
  }

  const clippedWeekdays = getClippedWeekdaysForPartialWeek(week);
  if (clippedWeekdays.length === 0) {
    return true;
  }

  // If the employee has a hard fixedOffDay that lies in the clipped part of the week
  if (
    employee.fixedOffDay !== null &&
    employee.fixedOffDay !== undefined &&
    clippedWeekdays.includes(employee.fixedOffDay as 0 | 1 | 2 | 3 | 4 | 5 | 6)
  ) {
    return false;
  }

  // If the employee has assigned processes and either:
  // (a) ALL of their processes are closed on at least one clipped weekday (e.g. Sunday = 0
  //     for Mon-Sat processes in the Dec 28-31 Mon-Thu partial week), OR
  // (b) The employee is assigned to a Mon-Sat process that is closed on a clipped weekday
  //     (e.g. E30 on M5-NDR which is Mon-Sat only, so E30's weekly off must fall on Sunday),
  // then their natural weekly off for that Mon-Sun week falls on that clipped day.
  if (empProcesses.length > 0) {
    const hasNaturalOffInClippedPart = clippedWeekdays.some((weekday) =>
      empProcesses.some((p) => !p.openDays.includes(weekday))
    );
    if (hasNaturalOffInClippedPart) {
      return false;
    }
  }

  // Also check if the partial week already contains a day where all of the employee's
  // processes are closed (e.g. Sunday Dec 6 in the Dec 1-6 partial week)
  const hasClosedDayInsideWeek =
    empProcesses.length > 0 &&
    week.dates.some((date) =>
      empProcesses.every((p) => !isProcessOpen(p, date, holidays))
    );
  if (hasClosedDayInsideWeek) {
    return true;
  }

  return true;
}

/**
 * Helper: Returns true if `entry` counts as a weekly rest/off day under `settings`.
 */
export function isEntryCountingAsWeeklyOff(
  entry: RosterEntry | undefined,
  settings: Setting
): boolean {
  if (!entry) return false;
  if (entry.status === 'WEEKLY_OFF' || entry.status === 'COMP_OFF') {
    return true;
  }
  if (entry.status === 'HOLIDAY' && settings.holidayCountsAsWeeklyOff) {
    return true;
  }
  return false;
}

/**
 * Formats a process label with its brand name when available.
 */
function formatProcessLabel(process: Process, brandMap: Map<string, Brand>): string {
  const brand = brandMap.get(process.brandId);
  return brand ? `${brand.name} (${process.name})` : `${process.brandId} (${process.name})`;
}

/**
 * Pure validator implementing all 7 ERROR codes and 2 WARNING codes from Section 6:
 * - NO_ASSIGNED_EMPLOYEE (ERROR)
 * - INSUFFICIENT_HEADCOUNT (ERROR)
 * - COVERAGE_GAP (ERROR)
 * - MISSING_WEEKLY_OFF (ERROR)
 * - MAX_CONSECUTIVE_DAYS (ERROR)
 * - LEAVE_CONFLICT (ERROR)
 * - FIXED_OFF_VIOLATED (ERROR)
 * - OVERLOAD (WARNING)
 * - PREFERENCE_VIOLATED (WARNING)
 */
export function validateRoster(input: ValidationInput): Issue[] {
  const {
    month,
    brands = [],
    employees,
    processes,
    assignments,
    coverageRules,
    holidays,
    leaves,
    settings,
    entries,
  } = input;

  const issues: Issue[] = [];
  const dates = getMonthDates(month);
  const weeks = getMonthWeeks(month, settings.partialWeekMinDays);
  const reqMatrix = buildRequirementMatrix(
    month,
    processes,
    holidays,
    coverageRules
  );

  const brandMap = new Map<string, Brand>();
  for (const b of brands) {
    brandMap.set(b.id, b);
  }

  const sortedProcesses = [...processes].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const sortedEmployees = [...employees]
    .filter((e) => e.active)
    .sort((a, b) => a.id.localeCompare(b.id));

  // Build quick lookup: entryByEmpDate.get(`${employeeId}:${date}`) -> RosterEntry[]
  const entriesByEmpDate = new Map<string, RosterEntry[]>();
  for (const entry of entries) {
    const key = `${entry.employeeId}:${entry.date}`;
    const list = entriesByEmpDate.get(key);
    if (list) {
      list.push(entry);
    } else {
      entriesByEmpDate.set(key, [entry]);
    }
  }

  const getSingleEntry = (
    employeeId: string,
    date: string
  ): RosterEntry | undefined => {
    const list = entriesByEmpDate.get(`${employeeId}:${date}`);
    return list && list.length > 0 ? list[0] : undefined;
  };

  // =========================================================================
  // 1. Structural & Date-Specific Process Checks:
  //    NO_ASSIGNED_EMPLOYEE, INSUFFICIENT_HEADCOUNT, COVERAGE_GAP
  // =========================================================================
  for (const process of sortedProcesses) {
    const assignedEmployees = getAssignedEmployeesForProcess(
      process.id,
      employees,
      assignments,
      settings
    );
    const assignedCount = assignedEmployees.length;
    const processLabel = formatProcessLabel(process, brandMap);

    let maxRequiredInMonth = 0;
    const insufficientDates: string[] = [];

    for (const date of dates) {
      const req = reqMatrix[process.id]?.[date] ?? 0;
      if (req > maxRequiredInMonth) {
        maxRequiredInMonth = req;
      }
      if (req > assignedCount) {
        insufficientDates.push(date);
      }
    }

    // 1a. NO_ASSIGNED_EMPLOYEE (Structural)
    if (assignedCount === 0 && maxRequiredInMonth > 0) {
      issues.push({
        code: 'NO_ASSIGNED_EMPLOYEE',
        severity: 'ERROR',
        processId: process.id,
        message: `${processLabel} requires coverage (minStaff ${maxRequiredInMonth}), but no active employee is assigned to it.`,
        details: {
          required: maxRequiredInMonth,
          assignedCount: 0,
        },
      });
      continue;
    }

    // 1b. INSUFFICIENT_HEADCOUNT (Structural)
    if (assignedCount > 0 && insufficientDates.length > 0) {
      const firstInsufficientDate = insufficientDates[0];
      const peakReq = reqMatrix[process.id][firstInsufficientDate];
      issues.push({
        code: 'INSUFFICIENT_HEADCOUNT',
        severity: 'ERROR',
        processId: process.id,
        date: firstInsufficientDate,
        message: `${processLabel} requires up to ${maxRequiredInMonth} staff (e.g. on ${firstInsufficientDate}), exceeding its total assigned headcount of ${assignedCount} active employee(s).`,
        details: {
          required: peakReq,
          assignedCount,
          affectedDatesCount: insufficientDates.length,
        },
      });
    }

    // 1c. COVERAGE_GAP (Date-specific)
    for (const date of dates) {
      const req = reqMatrix[process.id]?.[date] ?? 0;
      if (req <= 0) continue;

      const workingEmployees = getWorkingEmployeesForProcessOnDate(
        process.id,
        date,
        employees,
        assignments,
        entries,
        settings
      );
      const actual = workingEmployees.length;

      if (actual < req) {
        const causes: string[] = [];
        for (const emp of assignedEmployees) {
          const entry = getSingleEntry(emp.id, date);
          const approvedLeave = getApprovedLeaveOnDate(emp.id, date, leaves);
          if (approvedLeave) {
            causes.push(
              `${emp.name} on approved ${approvedLeave.type === 'COMP_OFF' ? 'comp-off' : 'leave'}`
            );
          } else if (!entry) {
            causes.push(`${emp.name} not scheduled`);
          } else if (entry.status === 'WEEKLY_OFF') {
            causes.push(`${emp.name} on weekly off`);
          } else if (entry.status === 'LEAVE') {
            causes.push(`${emp.name} on leave`);
          } else if (entry.status === 'COMP_OFF') {
            causes.push(`${emp.name} on comp-off`);
          } else if (entry.status === 'HOLIDAY') {
            causes.push(`${emp.name} on holiday`);
          }
        }

        if (req > assignedCount) {
          causes.push(
            `required staff (${req}) exceeds total assigned headcount (${assignedCount})`
          );
        }

        const causeText =
          causes.length > 0 ? ` Cause: ${causes.join('; ')}.` : '';

        issues.push({
          code: 'COVERAGE_GAP',
          severity: 'ERROR',
          processId: process.id,
          date,
          message: `${processLabel} on ${date} (${getWeekdayName(getWeekday(date), true)}) requires ${req} staff, but only ${actual} working.${causeText}`,
          details: {
            required: req,
            actual,
            assignedCount,
            causes,
          },
        });
      }
    }
  }

  // =========================================================================
  // 2. Employee-Level Checks:
  //    LEAVE_CONFLICT, FIXED_OFF_VIOLATED, MISSING_WEEKLY_OFF,
  //    MAX_CONSECUTIVE_DAYS, PREFERENCE_VIOLATED
  // =========================================================================
  for (const emp of sortedEmployees) {
    const empProcesses = getProcessesForEmployee(
      emp.id,
      processes,
      assignments
    );

    // 2a. LEAVE_CONFLICT & 2b. FIXED_OFF_VIOLATED per date
    for (const date of dates) {
      const list = entriesByEmpDate.get(`${emp.id}:${date}`) ?? [];

      // Check duplicate conflicting entries on same date
      if (list.length > 1) {
        const distinctStatuses = new Set(list.map((e) => e.status));
        if (distinctStatuses.size > 1) {
          issues.push({
            code: 'LEAVE_CONFLICT',
            severity: 'ERROR',
            employeeId: emp.id,
            date,
            message: `${emp.name} has conflicting multiple statuses (${Array.from(distinctStatuses).join(', ')}) on ${date}.`,
          });
        }
      }

      const entry = list[0];
      const approvedLeave = getApprovedLeaveOnDate(emp.id, date, leaves);

      if (approvedLeave && entry && entry.status === 'WORK') {
        issues.push({
          code: 'LEAVE_CONFLICT',
          severity: 'ERROR',
          employeeId: emp.id,
          date,
          message: `${emp.name} is marked WORK on ${date}, conflicting with an APPROVED ${approvedLeave.type === 'COMP_OFF' ? 'comp-off' : 'leave'} (${approvedLeave.startDate} to ${approvedLeave.endDate}).`,
          details: {
            conflictingLeaveId: approvedLeave.id,
          },
        });
      }

      // FIXED_OFF_VIOLATED
      if (
        emp.fixedOffDay !== null &&
        emp.fixedOffDay !== undefined &&
        getWeekday(date) === emp.fixedOffDay &&
        entry?.status === 'WORK'
      ) {
        issues.push({
          code: 'FIXED_OFF_VIOLATED',
          severity: 'ERROR',
          employeeId: emp.id,
          date,
          message: `${emp.name} is scheduled to WORK on ${date} (${getWeekdayName(emp.fixedOffDay)}), violating their mandatory fixed off day.`,
          details: {
            fixedDay: emp.fixedOffDay,
          },
        });
      }
    }

    // 2c. MISSING_WEEKLY_OFF & PREFERENCE_VIOLATED per Mon-Sun week
    for (const week of weeks) {
      const needsOff = doesEmployeeRequireOffInWeek(
        emp,
        week,
        empProcesses,
        holidays,
        settings
      );

      if (!needsOff) continue;

      const weekEntries = week.dates.map((d) => getSingleEntry(emp.id, d));
      const hasWeeklyOff = weekEntries.some((entry) =>
        isEntryCountingAsWeeklyOff(entry, settings)
      );

      // Also check if the employee is on approved LEAVE for every day of the week
      // (or has fewer than partialWeekMinDays non-leave days in the week)
      const nonLeaveDays = weekEntries.filter(
        (entry) => entry?.status !== 'LEAVE'
      );

      if (!hasWeeklyOff && nonLeaveDays.length >= settings.partialWeekMinDays) {
        issues.push({
          code: 'MISSING_WEEKLY_OFF',
          severity: 'ERROR',
          employeeId: emp.id,
          date: week.startDate,
          message: `${emp.name} has no weekly off between ${week.startDate} and ${week.endDate}.`,
          details: {
            weekStart: week.startDate,
            weekEnd: week.endDate,
          },
        });
      }

      // PREFERENCE_VIOLATED (Soft WARNING):
      // Only check if the employee has preferredOffDays and at least one preferred weekday
      // exists inside this week window.
      if (emp.preferredOffDays && emp.preferredOffDays.length > 0) {
        const preferredDatesInWeek = week.dates.filter((d) =>
          emp.preferredOffDays.includes(getWeekday(d))
        );

        if (preferredDatesInWeek.length > 0) {
          const gotPreferredOff = preferredDatesInWeek.some((d) => {
            const entry = getSingleEntry(emp.id, d);
            return entry && entry.status !== 'WORK';
          });

          if (!gotPreferredOff) {
            const firstViolatedDate = preferredDatesInWeek[0];
            const prefNames = emp.preferredOffDays
              .map((day) => getWeekdayName(day, true))
              .join('/');
            issues.push({
              code: 'PREFERENCE_VIOLATED',
              severity: 'WARNING',
              employeeId: emp.id,
              date: firstViolatedDate,
              message: `${emp.name} worked on preferred off day (${prefNames}) during week ${week.startDate} to ${week.endDate} to prioritize coverage.`,
              details: {
                weekStart: week.startDate,
                weekEnd: week.endDate,
                preferredDays: emp.preferredOffDays,
              },
            });
          }
        }
      }
    }

    // 2d. MAX_CONSECUTIVE_DAYS
    let currentStreak = 0;
    let streakStart = '';

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const entry = getSingleEntry(emp.id, date);

      if (entry?.status === 'WORK') {
        if (currentStreak === 0) {
          streakStart = date;
        }
        currentStreak++;
      } else {
        if (currentStreak > settings.maxConsecutiveWorkDays) {
          const streakEnd = dates[i - 1];
          issues.push({
            code: 'MAX_CONSECUTIVE_DAYS',
            severity: 'ERROR',
            employeeId: emp.id,
            date: streakEnd,
            message: `${emp.name} works ${currentStreak} consecutive days (${streakStart} to ${streakEnd}), exceeding the maximum of ${settings.maxConsecutiveWorkDays} days.`,
            details: {
              streakLength: currentStreak,
              streakStart,
              streakEnd,
            },
          });
        }
        currentStreak = 0;
        streakStart = '';
      }
    }

    if (currentStreak > settings.maxConsecutiveWorkDays) {
      const streakEnd = dates[dates.length - 1];
      issues.push({
        code: 'MAX_CONSECUTIVE_DAYS',
        severity: 'ERROR',
        employeeId: emp.id,
        date: streakEnd,
        message: `${emp.name} works ${currentStreak} consecutive days (${streakStart} to ${streakEnd}), exceeding the maximum of ${settings.maxConsecutiveWorkDays} days.`,
        details: {
          streakLength: currentStreak,
          streakStart,
          streakEnd,
        },
      });
    }
  }

  // =========================================================================
  // 3. OVERLOAD Warning Check (Section 5.5 & Section 6):
  //    "One person is sole cover for more than 3 brands on one day."
  // =========================================================================
  for (const date of dates) {
    // Map employeeId -> Set of brandIds where employee is the sole working cover on `date`
    const soleBrandsByEmployee = new Map<string, Set<string>>();

    for (const process of sortedProcesses) {
      const req = reqMatrix[process.id]?.[date] ?? 0;
      if (req <= 0) continue;

      const working = getWorkingEmployeesForProcessOnDate(
        process.id,
        date,
        employees,
        assignments,
        entries,
        settings
      );

      if (working.length === 1) {
        const soleEmp = working[0];
        let set = soleBrandsByEmployee.get(soleEmp.id);
        if (!set) {
          set = new Set<string>();
          soleBrandsByEmployee.set(soleEmp.id, set);
        }
        set.add(process.brandId);
      }
    }

    for (const emp of sortedEmployees) {
      const brandSet = soleBrandsByEmployee.get(emp.id);
      if (brandSet && brandSet.size > 3) {
        const brandNames = Array.from(brandSet)
          .sort()
          .map((bId) => brandMap.get(bId)?.name ?? bId);
        issues.push({
          code: 'OVERLOAD',
          severity: 'WARNING',
          employeeId: emp.id,
          date,
          message: `${emp.name} is the sole working cover for ${brandSet.size} brands on ${date} (${brandNames.join(', ')}), exceeding the safe limit of 3 brands.`,
          details: {
            soleBrandsCount: brandSet.size,
            soleBrandNames: brandNames,
          },
        });
      }
    }
  }

  return issues;
}
