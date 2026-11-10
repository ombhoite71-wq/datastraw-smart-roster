/**
 * Smart Roster Management System - Deterministic Roster Generator
 * Strictly follows PROJECT_SPEC.md Section 5.3, 5.4, and Section 7 (Steps 1-7).
 * Pure TypeScript function: no randomness, no Date.now(), deterministic tie-breaks.
 */

import {
  getApprovedLeaveOnDate,
  getMonthDates,
  getMonthWeeks,
  getWeekday,
  isHolidayDate,
  isProcessOpen,
  isWeekend,
} from './calendar';
import {
  buildRequirementMatrix,
  getAssignedEmployeesForProcess,
  getProcessesForEmployee,
  getWorkingEmployeesForProcessOnDate,
} from './requirements';
import {
  Assignment,
  Employee,
  GenerationInput,
  GenerationOutput,
  Holiday,
  Process,
  RequirementMatrix,
  RosterEntry,
  Setting,
  WeekWindow,
} from './types';
import {
  doesEmployeeRequireOffInWeek,
  isEntryCountingAsWeeklyOff,
  validateRoster,
} from './validate';

/**
 * Computes tightness metrics for ordering employees in Step 3:
 * "employees that are the sole assignee of a process, then multi-brand employees,
 *  then the rest. Tie-break by employee id."
 */
function sortEmployeesByTightness(
  employees: Employee[],
  processes: Process[],
  assignments: Assignment[],
  settings: Setting
): Employee[] {
  const assigneeCountByProcess = new Map<string, number>();
  for (const process of processes) {
    const assigned = getAssignedEmployeesForProcess(
      process.id,
      employees,
      assignments,
      settings
    );
    assigneeCountByProcess.set(process.id, assigned.length);
  }

  const processMap = new Map<string, Process>();
  for (const p of processes) {
    processMap.set(p.id, p);
  }

  const metrics = new Map<
    string,
    {
      isSoleAssignee: number;
      soleProcessCount: number;
      isMultiBrandPrimary: number;
      isMultiBrand: number;
      brandCount: number;
      primaryProcessCount: number;
    }
  >();

  for (const emp of employees) {
    const empAssignments = assignments.filter((a) => a.employeeId === emp.id);
    const empProcesses = empAssignments
      .map((a) => processMap.get(a.processId))
      .filter((p): p is Process => Boolean(p));

    const soleProcessCount = empProcesses.filter(
      (p) => (assigneeCountByProcess.get(p.id) ?? 0) === 1
    ).length;

    const brandIds = new Set(empProcesses.map((p) => p.brandId));
    const primaryAssignments = empAssignments.filter(
      (a) => a.role === 'PRIMARY'
    );
    const primaryBrandIds = new Set(
      primaryAssignments
        .map((a) => processMap.get(a.processId)?.brandId)
        .filter((b): b is string => Boolean(b))
    );

    metrics.set(emp.id, {
      isSoleAssignee: soleProcessCount > 0 ? 1 : 0,
      soleProcessCount,
      isMultiBrandPrimary: primaryBrandIds.size > 1 ? 1 : 0,
      isMultiBrand: brandIds.size > 1 ? 1 : 0,
      brandCount: brandIds.size,
      primaryProcessCount: primaryAssignments.length,
    });
  }

  return [...employees]
    .filter((e) => e.active)
    .sort((a, b) => {
      // Pod leads last if they don't count for coverage
      if (!settings.podLeadsCountForCoverage && a.isPodLead !== b.isPodLead) {
        return a.isPodLead ? 1 : -1;
      }

      const ma = metrics.get(a.id)!;
      const mb = metrics.get(b.id)!;

      // 1. Sole assignees first
      if (ma.isSoleAssignee !== mb.isSoleAssignee) {
        return mb.isSoleAssignee - ma.isSoleAssignee;
      }
      if (ma.soleProcessCount !== mb.soleProcessCount) {
        return mb.soleProcessCount - ma.soleProcessCount;
      }

      // 2. Multi-brand primary owners, then multi-brand floaters
      if (ma.isMultiBrand !== mb.isMultiBrand) {
        return mb.isMultiBrand - ma.isMultiBrand;
      }
      if (ma.isMultiBrandPrimary !== mb.isMultiBrandPrimary) {
        return mb.isMultiBrandPrimary - ma.isMultiBrandPrimary;
      }
      if (ma.primaryProcessCount !== mb.primaryProcessCount) {
        return mb.primaryProcessCount - ma.primaryProcessCount;
      }

      // 3. Tie-break by employee ID
      return a.id.localeCompare(b.id);
    });
}

/**
 * Helper to check if a date is within the regeneration window.
 */
function isDateInRegenWindow(
  date: string,
  fromDate?: string,
  toDate?: string
): boolean {
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

/**
 * Computes the maximum consecutive WORK streak for an employee across `checkDates`
 * if `candidateOffDate` is set to WEEKLY_OFF.
 */
function computeStreakMetricsWithCandidateOff(
  employeeId: string,
  candidateOffDate: string,
  allDatesUpToCandidateWeekEnd: string[],
  entryMap: Map<string, RosterEntry>
): { maxStreak: number; streakImmediatelyBefore: number } {
  let maxStreak = 0;
  let currentStreak = 0;
  let streakImmediatelyBefore = 0;

  for (const date of allDatesUpToCandidateWeekEnd) {
    const isWork =
      date === candidateOffDate
        ? false
        : entryMap.get(`${employeeId}:${date}`)?.status === 'WORK';

    if (date === candidateOffDate) {
      streakImmediatelyBefore = currentStreak;
    }

    if (isWork) {
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

  return { maxStreak, streakImmediatelyBefore };
}

/**
 * Computes maximum consecutive WORK streak across all dates of the month for one employee.
 */
function getMaxConsecutiveWorkDaysForEmployee(
  employeeId: string,
  monthDates: string[],
  entryMap: Map<string, RosterEntry>
): number {
  let maxStreak = 0;
  let current = 0;
  for (const date of monthDates) {
    const entry = entryMap.get(`${employeeId}:${date}`);
    if (entry?.status === 'WORK') {
      current++;
      if (current > maxStreak) {
        maxStreak = current;
      }
    } else {
      current = 0;
    }
  }
  return maxStreak;
}

/**
 * Section 7: Deterministic Roster Generator (`generateRoster`).
 */
export function generateRoster(input: GenerationInput): GenerationOutput {
  const {
    month,
    rosterId = `roster-${month}`,
    brands = [],
    employees,
    processes,
    assignments,
    coverageRules,
    holidays,
    leaves,
    settings,
    entries: existingEntries = [],
    regenerateFromDate,
    regenerateToDate,
  } = input;

  // =========================================================================
  // Step 1: Build the month's dates and requirement matrix req[process][date]
  // =========================================================================
  const dates = getMonthDates(month);
  const weeks = getMonthWeeks(month, settings.partialWeekMinDays);
  const requirements: RequirementMatrix = buildRequirementMatrix(
    month,
    processes,
    holidays,
    coverageRules
  );

  // Lookup existing entries by `${employeeId}:${date}`
  const existingMap = new Map<string, RosterEntry>();
  for (const entry of existingEntries) {
    existingMap.set(`${entry.employeeId}:${entry.date}`, { ...entry });
  }

  const entryMap = new Map<string, RosterEntry>();
  const activeEmployees = [...employees]
    .filter((e) => e.active)
    .sort((a, b) => a.id.localeCompare(b.id));

  // =========================================================================
  // Step 2: Prefill each employee-day using Section 5.3
  // =========================================================================
  for (const emp of activeEmployees) {
    const empProcesses = getProcessesForEmployee(
      emp.id,
      processes,
      assignments
    );

    for (const date of dates) {
      const key = `${emp.id}:${date}`;
      const existing = existingMap.get(key);
      const inRegenWindow = isDateInRegenWindow(
        date,
        regenerateFromDate,
        regenerateToDate
      );

      // 2a. Approved leave or comp-off always takes precedence and is locked
      const approvedLeave = getApprovedLeaveOnDate(emp.id, date, leaves);
      if (approvedLeave) {
        entryMap.set(key, {
          id: existing?.id ?? `entry-${emp.id}-${date}`,
          rosterId,
          employeeId: emp.id,
          date,
          status: approvedLeave.type === 'COMP_OFF' ? 'COMP_OFF' : 'LEAVE',
          locked: true,
          source: existing?.source ?? 'AUTO',
        });
        continue;
      }

      // 2b. Preserve locked entries or entries outside regeneration window
      if (existing && (existing.locked || !inRegenWindow)) {
        entryMap.set(key, { ...existing });
        continue;
      }

      // 2c. If all of the employee's processes are closed that date:
      //     HOLIDAY (if public holiday) or WEEKLY_OFF (if not).
      //     For pod leads with no direct processes, treat Sundays as WEEKLY_OFF and
      //     public holidays as HOLIDAY.
      const isHoliday = isHolidayDate(date, holidays);
      const allProcessesClosed =
        empProcesses.length > 0
          ? empProcesses.every((p) => !isProcessOpen(p, date, holidays))
          : isHoliday || getWeekday(date) === 0;

      if (allProcessesClosed) {
        entryMap.set(key, {
          id: existing?.id ?? `entry-${emp.id}-${date}`,
          rosterId,
          employeeId: emp.id,
          date,
          status: isHoliday ? 'HOLIDAY' : 'WEEKLY_OFF',
          locked: false,
          source: 'AUTO',
        });
        continue;
      }

      // 2d. Hard fixedOffDay constraint: if the employee has a fixedOffDay on this weekday,
      //     place WEEKLY_OFF so FIXED_OFF_VIOLATED never occurs.
      if (
        emp.fixedOffDay !== null &&
        emp.fixedOffDay !== undefined &&
        getWeekday(date) === emp.fixedOffDay
      ) {
        entryMap.set(key, {
          id: existing?.id ?? `entry-${emp.id}-${date}`,
          rosterId,
          employeeId: emp.id,
          date,
          status: 'WEEKLY_OFF',
          locked: false,
          source: 'AUTO',
        });
        continue;
      }

      // 2e. Otherwise, prefill as WORK
      entryMap.set(key, {
        id: existing?.id ?? `entry-${emp.id}-${date}`,
        rosterId,
        employeeId: emp.id,
        date,
        status: 'WORK',
        locked: false,
        source: 'AUTO',
      });
    }
  }

  // =========================================================================
  // Step 3: Order employees by tightness (hardest first)
  // =========================================================================
  const orderedEmployees = sortEmployeesByTightness(
    activeEmployees,
    processes,
    assignments,
    settings
  );

  // Helper to count how many assigned active employees are currently marked WORK
  // for a process on `date`
  const countWorkingOnProcess = (processId: string, date: string): number => {
    const assigned = getAssignedEmployeesForProcess(
      processId,
      activeEmployees,
      assignments,
      settings
    );
    let count = 0;
    for (const emp of assigned) {
      const entry = entryMap.get(`${emp.id}:${date}`);
      if (entry?.status === 'WORK') {
        count++;
      }
    }
    return count;
  };

  // Helper to check how many brands a given employee would be sole cover for on `date`
  // if `candidateOffEmpId` takes `date` off
  const countSoleBrandsForEmployeeOnDate = (
    targetEmpId: string,
    date: string,
    candidateOffEmpId: string
  ): number => {
    const targetProcesses = getProcessesForEmployee(
      targetEmpId,
      processes,
      assignments
    );
    const soleBrands = new Set<string>();
    for (const proc of targetProcesses) {
      const req = requirements[proc.id]?.[date] ?? 0;
      if (req <= 0) continue;
      const assigned = getAssignedEmployeesForProcess(
        proc.id,
        activeEmployees,
        assignments,
        settings
      );
      const workingIds = assigned
        .filter((e) => {
          if (e.id === candidateOffEmpId) return false;
          return entryMap.get(`${e.id}:${date}`)?.status === 'WORK';
        })
        .map((e) => e.id);
      if (workingIds.length === 1 && workingIds[0] === targetEmpId) {
        soleBrands.add(proc.brandId);
      }
    }
    return soleBrands.size;
  };

  // =========================================================================
  // Step 4 & Step 5: Score every eligible day for each employee-week that lacks
  // an off, and place the off even if the best day causes a coverage gap.
  // =========================================================================
  for (const emp of orderedEmployees) {
    const empProcesses = getProcessesForEmployee(
      emp.id,
      processes,
      assignments
    );

    for (const week of weeks) {
      const needsOff = doesEmployeeRequireOffInWeek(
        emp,
        week,
        empProcesses,
        holidays,
        settings
      );
      if (!needsOff) continue;

      // Check if this week already has a valid off day
      const weekEntries = week.dates.map((d) => entryMap.get(`${emp.id}:${d}`));
      const alreadyHasOff = weekEntries.some((entry) =>
        isEntryCountingAsWeeklyOff(entry, settings)
      );

      // Even if the week has a HOLIDAY that counts as an off, check if the employee
      // still exceeds maxConsecutiveWorkDays up to the end of this week (e.g. 9 days
      // between Tue Dec 15 Founders' Day and Fri Dec 25 Christmas on 7-day brands).
      const weekEndIndex = dates.indexOf(week.endDate);
      const datesUpToWeekEnd = dates.slice(0, weekEndIndex + 1);
      const currentStreakThroughWeek = getMaxConsecutiveWorkDaysForEmployee(
        emp.id,
        datesUpToWeekEnd,
        entryMap
      );

      if (
        alreadyHasOff &&
        currentStreakThroughWeek <= settings.maxConsecutiveWorkDays
      ) {
        continue;
      }

      // Also skip if employee is on leave for nearly the entire week
      const nonLeaveCount = weekEntries.filter(
        (entry) => entry?.status !== 'LEAVE'
      ).length;
      if (nonLeaveCount < settings.partialWeekMinDays) continue;

      // Eligible dates in this week: in regen window, not locked, currently WORK
      const eligibleDates = week.dates.filter((d) => {
        if (!isDateInRegenWindow(d, regenerateFromDate, regenerateToDate)) {
          return false;
        }
        const entry = entryMap.get(`${emp.id}:${d}`);
        return entry && !entry.locked && entry.status === 'WORK';
      });

      if (eligibleDates.length === 0) continue;

      // If fixedOffDay exists and is eligible, choose it directly
      if (emp.fixedOffDay !== null && emp.fixedOffDay !== undefined) {
        const fixedDate = eligibleDates.find(
          (d) => getWeekday(d) === emp.fixedOffDay
        );
        if (fixedDate) {
          const entry = entryMap.get(`${emp.id}:${fixedDate}`)!;
          entryMap.set(`${emp.id}:${fixedDate}`, {
            ...entry,
            status: 'WEEKLY_OFF',
            source: 'AUTO',
          });
          continue;
        }
      }

      // Count weekend offs already given to this employee in the month so far
      let weekendOffsSoFar = 0;
      for (const d of dates) {
        const e = entryMap.get(`${emp.id}:${d}`);
        if (
          e &&
          (e.status === 'WEEKLY_OFF' || e.status === 'HOLIDAY') &&
          isWeekend(d)
        ) {
          weekendOffsSoFar++;
        }
      }

      let bestDate = eligibleDates[0];
      let bestScore = Number.POSITIVE_INFINITY;

      for (const candidateDate of eligibleDates) {
        // 1. hardViolations x 1000: number of employee's processes where (working - 1) < required
        let hardViolations = 0;
        let coAssigneeTightnessPenalty = 0;

        for (const proc of empProcesses) {
          const req = requirements[proc.id]?.[candidateDate] ?? 0;
          if (req <= 0) continue;

          const currentWorking = countWorkingOnProcess(proc.id, candidateDate);
          if (currentWorking - 1 < req) {
            hardViolations++;
          } else {
            // Check if taking candidateDate off forces a co-assignee (e.g. floater) into
            // sole-covering multiple brands or reduces slack when other days have more slack
            const assigned = getAssignedEmployeesForProcess(
              proc.id,
              activeEmployees,
              assignments,
              settings
            );
            for (const coEmp of assigned) {
              if (coEmp.id === emp.id) continue;
              const coEntry = entryMap.get(`${coEmp.id}:${candidateDate}`);
              if (coEntry?.status !== 'WORK') {
                // Co-assignee is already off on this date
                coAssigneeTightnessPenalty += 18;
              } else {
                const soleBrands = countSoleBrandsForEmployeeOnDate(
                  coEmp.id,
                  candidateDate,
                  emp.id
                );
                if (soleBrands > 3) {
                  // Avoid causing OVERLOAD (>3 brands sole cover) on the floater
                  coAssigneeTightnessPenalty += 250;
                } else if (soleBrands > 1) {
                  // Spread load across days for shared floaters so one day isn't bottlenecked
                  coAssigneeTightnessPenalty += (soleBrands - 1) * 16;
                }
              }
            }
          }
        }

        // 2. preferenceViolation x 10: day not in preferredOffDays (soft)
        const weekday = getWeekday(candidateDate);
        const hasPreferences =
          emp.preferredOffDays && emp.preferredOffDays.length > 0;
        const preferenceViolation =
          hasPreferences && !emp.preferredOffDays.includes(weekday) ? 1 : 0;

        // 3. fairnessPenalty: weekend offs already given this month
        const fairnessPenalty = isWeekend(candidateDate)
          ? weekendOffsSoFar * 4
          : 0;

        // 4. spacingPenalty: keep offs roughly evenly spaced & avoid > maxConsecutiveWorkDays
        const { maxStreak, streakImmediatelyBefore } =
          computeStreakMetricsWithCandidateOff(
            emp.id,
            candidateOffDateOrString(candidateDate),
            datesUpToWeekEnd,
            entryMap
          );

        let spacingPenalty = 0;
        if (maxStreak > settings.maxConsecutiveWorkDays) {
          spacingPenalty +=
            (maxStreak - settings.maxConsecutiveWorkDays) * 500;
        }
        // Prefer spacing ~5-6 workdays after the previous off day
        if (week.weekIndex > 0) {
          spacingPenalty += Math.abs(streakImmediatelyBefore - 5) * 3;
        }

        const totalScore =
          hardViolations * 1000 +
          preferenceViolation * 10 +
          fairnessPenalty +
          spacingPenalty +
          coAssigneeTightnessPenalty;

        if (totalScore < bestScore) {
          bestScore = totalScore;
          bestDate = candidateDate;
        }
      }

      // Step 5: Place the off even if it causes a coverage gap
      const chosenEntry = entryMap.get(`${emp.id}:${bestDate}`)!;
      entryMap.set(`${emp.id}:${bestDate}`, {
        ...chosenEntry,
        status: 'WEEKLY_OFF',
        source: 'AUTO',
      });
    }
  }

  // =========================================================================
  // Step 6: Repair pass (max 3 iterations)
  // For each COVERAGE_GAP, try moving an unlocked, AUTO-placed weekly off from
  // an employee assigned to that process to a day in the same week where the
  // move creates zero violations. Also repair any avoidable MAX_CONSECUTIVE_DAYS
  // streak violations caused by initial greedy placement.
  // =========================================================================
  for (let iteration = 0; iteration < 3; iteration++) {
    let improved = false;

    // 6a. Repair COVERAGE_GAPs
    for (const process of processes) {
      for (const gapDate of dates) {
        const req = requirements[process.id]?.[gapDate] ?? 0;
        if (req <= 0) continue;

        const currentWorking = countWorkingOnProcess(process.id, gapDate);
        if (currentWorking >= req) continue;

        const week = weeks.find((w) => w.dates.includes(gapDate));
        if (!week) continue;

        const assignedEmployees = getAssignedEmployeesForProcess(
          process.id,
          activeEmployees,
          assignments,
          settings
        );

        // Candidates who are assigned to `process` and have an unlocked AUTO WEEKLY_OFF on `gapDate`
        const offEmployeesOnGapDate = assignedEmployees.filter((emp) => {
          if (
            !isDateInRegenWindow(gapDate, regenerateFromDate, regenerateToDate)
          ) {
            return false;
          }
          if (
            emp.fixedOffDay !== null &&
            emp.fixedOffDay !== undefined &&
            getWeekday(gapDate) === emp.fixedOffDay
          ) {
            return false;
          }
          const e = entryMap.get(`${emp.id}:${gapDate}`);
          return e && !e.locked && e.source === 'AUTO' && e.status === 'WEEKLY_OFF';
        });

        let gapResolved = false;

        for (const emp of offEmployeesOnGapDate) {
          if (gapResolved) break;
          const empProcesses = getProcessesForEmployee(
            emp.id,
            processes,
            assignments
          );

          for (const altDate of week.dates) {
            if (altDate === gapDate) continue;
            if (
              !isDateInRegenWindow(
                altDate,
                regenerateFromDate,
                regenerateToDate
              )
            ) {
              continue;
            }

            const altEntry = entryMap.get(`${emp.id}:${altDate}`);
            if (
              !altEntry ||
              altEntry.locked ||
              altEntry.status !== 'WORK'
            ) {
              continue;
            }

            // Check if moving emp's WEEKLY_OFF to altDate causes any coverage violation on altDate
            const causesGapOnAltDate = empProcesses.some((p) => {
              const altReq = requirements[p.id]?.[altDate] ?? 0;
              if (altReq <= 0) return false;
              const altWorking = countWorkingOnProcess(p.id, altDate);
              return altWorking - 1 < altReq;
            });

            if (causesGapOnAltDate) continue;

            // Temporarily apply the swap and verify consecutive work days <= maxConsecutiveWorkDays
            const gapEntry = entryMap.get(`${emp.id}:${gapDate}`)!;
            entryMap.set(`${emp.id}:${gapDate}`, {
              ...gapEntry,
              status: 'WORK',
            });
            entryMap.set(`${emp.id}:${altDate}`, {
              ...altEntry,
              status: 'WEEKLY_OFF',
              source: 'AUTO',
            });

            const maxStreakAfterMove = getMaxConsecutiveWorkDaysForEmployee(
              emp.id,
              dates,
              entryMap
            );

            if (maxStreakAfterMove <= settings.maxConsecutiveWorkDays) {
              improved = true;
              if (countWorkingOnProcess(process.id, gapDate) >= req) {
                gapResolved = true;
              }
              break;
            } else {
              // Revert temporary swap
              entryMap.set(`${emp.id}:${gapDate}`, gapEntry);
              entryMap.set(`${emp.id}:${altDate}`, altEntry);
            }
          }
        }
      }
    }

    // 6b. Also check if any employee has a MAX_CONSECUTIVE_DAYS > settings.maxConsecutiveWorkDays
    //     that can be fixed by shifting an unlocked AUTO WEEKLY_OFF within its week with 0 coverage gaps.
    for (const emp of orderedEmployees) {
      const currentMaxStreak = getMaxConsecutiveWorkDaysForEmployee(
        emp.id,
        dates,
        entryMap
      );
      if (currentMaxStreak <= settings.maxConsecutiveWorkDays) continue;

      const empProcesses = getProcessesForEmployee(
        emp.id,
        processes,
        assignments
      );

      for (const week of weeks) {
        const currentOffDate = week.dates.find((d) => {
          const e = entryMap.get(`${emp.id}:${d}`);
          return (
            e &&
            !e.locked &&
            e.source === 'AUTO' &&
            e.status === 'WEEKLY_OFF' &&
            (emp.fixedOffDay === null ||
              emp.fixedOffDay === undefined ||
              getWeekday(d) !== emp.fixedOffDay)
          );
        });
        if (!currentOffDate) continue;

        for (const altDate of week.dates) {
          if (altDate === currentOffDate) continue;
          const altEntry = entryMap.get(`${emp.id}:${altDate}`);
          if (!altEntry || altEntry.locked || altEntry.status !== 'WORK') {
            continue;
          }

          const causesGapOnAltDate = empProcesses.some((p) => {
            const altReq = requirements[p.id]?.[altDate] ?? 0;
            if (altReq <= 0) return false;
            return countWorkingOnProcess(p.id, altDate) - 1 < altReq;
          });
          if (causesGapOnAltDate) continue;

          const offEntry = entryMap.get(`${emp.id}:${currentOffDate}`)!;
          entryMap.set(`${emp.id}:${currentOffDate}`, {
            ...offEntry,
            status: 'WORK',
          });
          entryMap.set(`${emp.id}:${altDate}`, {
            ...altEntry,
            status: 'WEEKLY_OFF',
            source: 'AUTO',
          });

          const newMaxStreak = getMaxConsecutiveWorkDaysForEmployee(
            emp.id,
            dates,
            entryMap
          );
          if (newMaxStreak < currentMaxStreak) {
            improved = true;
            break;
          } else {
            entryMap.set(`${emp.id}:${currentOffDate}`, offEntry);
            entryMap.set(`${emp.id}:${altDate}`, altEntry);
          }
        }
      }

      // If still exceeding maxConsecutiveWorkDays (e.g. between two holidays across adjacent weeks),
      // check if any week has both a HOLIDAY and an extra unlocked AUTO WEEKLY_OFF that can be
      // shifted into the long streak window without leaving that week without an off.
      const updatedMaxStreak = getMaxConsecutiveWorkDaysForEmployee(
        emp.id,
        dates,
        entryMap
      );
      if (updatedMaxStreak > settings.maxConsecutiveWorkDays) {
        for (const week of weeks) {
          const weekEntries = week.dates.map((d) =>
            entryMap.get(`${emp.id}:${d}`)
          );
          const offCountInWeek = weekEntries.filter((e) =>
            isEntryCountingAsWeeklyOff(e, settings)
          ).length;
          if (offCountInWeek < 2) continue;

          const movableOffDate = week.dates.find((d) => {
            const e = entryMap.get(`${emp.id}:${d}`);
            return (
              e &&
              !e.locked &&
              e.source === 'AUTO' &&
              e.status === 'WEEKLY_OFF' &&
              (emp.fixedOffDay === null ||
                emp.fixedOffDay === undefined ||
                getWeekday(d) !== emp.fixedOffDay)
            );
          });
          if (!movableOffDate) continue;

          for (const altDate of dates) {
            if (altDate === movableOffDate) continue;
            const altEntry = entryMap.get(`${emp.id}:${altDate}`);
            if (!altEntry || altEntry.locked || altEntry.status !== 'WORK') {
              continue;
            }
            const causesGapOnAltDate = empProcesses.some((p) => {
              const altReq = requirements[p.id]?.[altDate] ?? 0;
              if (altReq <= 0) return false;
              return countWorkingOnProcess(p.id, altDate) - 1 < altReq;
            });
            if (causesGapOnAltDate) continue;

            const offEntry = entryMap.get(`${emp.id}:${movableOffDate}`)!;
            entryMap.set(`${emp.id}:${movableOffDate}`, {
              ...offEntry,
              status: 'WORK',
            });
            entryMap.set(`${emp.id}:${altDate}`, {
              ...altEntry,
              status: 'WEEKLY_OFF',
              source: 'AUTO',
            });

            const afterCrossWeekStreak = getMaxConsecutiveWorkDaysForEmployee(
              emp.id,
              dates,
              entryMap
            );
            if (afterCrossWeekStreak < updatedMaxStreak) {
              improved = true;
              break;
            } else {
              entryMap.set(`${emp.id}:${movableOffDate}`, offEntry);
              entryMap.set(`${emp.id}:${altDate}`, altEntry);
            }
          }
        }
      }
    }

    if (!improved) {
      break;
    }
  }

  // Sort final entries deterministically by employeeId then date
  const finalEntries = Array.from(entryMap.values()).sort((a, b) => {
    const empCmp = a.employeeId.localeCompare(b.employeeId);
    if (empCmp !== 0) return empCmp;
    return a.date.localeCompare(b.date);
  });

  // =========================================================================
  // Step 7: Run the validator on the final entries and return { entries, issues }
  // =========================================================================
  const issues = validateRoster({
    month,
    brands,
    employees,
    processes,
    assignments,
    coverageRules,
    holidays,
    leaves,
    settings,
    entries: finalEntries,
  });

  return {
    entries: finalEntries,
    issues,
    requirements,
  };
}

function candidateOffDateOrString(d: string): string {
  return d;
}
