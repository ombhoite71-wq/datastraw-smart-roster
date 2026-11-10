/**
 * Smart Roster Management System - Simulate-Before-Suggest Engine
 * Strictly follows PROJECT_SPEC.md Section 8.
 * Never mutates input data. Every candidate is simulated on a copy of the roster
 * and validated with `validateRoster` to guarantee 0 new ERRORs.
 */

import { getMonthWeeks, getWeekday, getWeekdayName } from './calendar';
import {
  buildRequirementMatrix,
  getAssignedEmployeesForProcess,
} from './requirements';
import {
  Assignment,
  Brand,
  CoverageRule,
  Employee,
  Issue,
  Process,
  RosterEntry,
  Suggestion,
  ValidationInput,
} from './types';
import { validateRoster } from './validate';

/**
 * Builds a unique key for an Issue to compare baseline vs simulated errors.
 */
function getIssueIdentityKey(issue: Issue): string {
  return [
    issue.code,
    issue.severity,
    issue.processId ?? '',
    issue.employeeId ?? '',
    issue.date ?? '',
    String(issue.details?.weekStart ?? ''),
  ].join('|');
}

/**
 * Counts how many new ERRORs appear in `simulatedIssues` that were not present
 * in `baselineErrors`, and ensures total ERROR count does not increase.
 */
function countNewErrors(
  baselineErrors: Issue[],
  simulatedIssues: Issue[],
  targetProcessId: string,
  targetDate: string
): { newErrorCount: number; gapImproved: boolean } {
  const baselineKeys = new Set(baselineErrors.map(getIssueIdentityKey));
  const simErrors = simulatedIssues.filter((i) => i.severity === 'ERROR');

  let newErrorCount = 0;
  for (const err of simErrors) {
    const key = getIssueIdentityKey(err);
    if (!baselineKeys.has(key)) {
      // Allow a reduced COVERAGE_GAP on the exact same (targetProcessId, targetDate)
      // if required > actual was partially improved, though full resolution removes it.
      if (
        err.code === 'COVERAGE_GAP' &&
        err.processId === targetProcessId &&
        err.date === targetDate
      ) {
        continue;
      }
      newErrorCount++;
    }
  }

  const baselineGap = baselineErrors.find(
    (e) =>
      e.code === 'COVERAGE_GAP' &&
      e.processId === targetProcessId &&
      e.date === targetDate
  );
  const simGap = simErrors.find(
    (e) =>
      e.code === 'COVERAGE_GAP' &&
      e.processId === targetProcessId &&
      e.date === targetDate
  );

  const baseActual = Number(baselineGap?.details?.actual ?? 0);
  const simActual = simGap
    ? Number(simGap.details?.actual ?? 0)
    : Number(baselineGap?.details?.required ?? 1);

  const gapImproved = !simGap || simActual > baseActual;

  return { newErrorCount, gapImproved };
}

/**
 * Determines the primary pod ID for a process (based on its assigned employees).
 */
function getProcessPrimaryPodId(
  processId: string,
  employees: Employee[],
  assignments: Assignment[]
): string | undefined {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const procAssignments = assignments.filter((a) => a.processId === processId);
  const primaryAssignment =
    procAssignments.find((a) => a.role === 'PRIMARY') ?? procAssignments[0];
  if (!primaryAssignment) return undefined;
  return empMap.get(primaryAssignment.employeeId)?.podId;
}

/**
 * Generates and simulates candidate fixes for a single `COVERAGE_GAP` issue.
 * Section 8:
 * 1. Swap off: an employee assigned to the process whose weekly off falls on the gap date
 *    moves it to another day with slack.
 * 2. Backup call-in: a BACKUP, or an employee in the same pod who is currently off, works
 *    that day. This earns the employee a comp-off.
 * 3. Waive / reduce minimum for that date: an explicit manager decision; never applied automatically.
 *
 * Ranking: (1) no new errors, (2) fewest comp-offs created, (3) same pod preferred.
 * If nothing works, returns a flagged "Needs external resource" suggestion.
 */
export function suggestFixesForGap(
  input: ValidationInput,
  gapIssue: Issue
): Suggestion[] {
  if (
    gapIssue.code !== 'COVERAGE_GAP' ||
    !gapIssue.processId ||
    !gapIssue.date
  ) {
    return [];
  }

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

  const targetProcessId = gapIssue.processId;
  const gapDate = gapIssue.date;
  const process = processes.find((p) => p.id === targetProcessId);
  if (!process) return [];

  const brandMap = new Map<string, Brand>(brands.map((b) => [b.id, b]));
  const brandName = brandMap.get(process.brandId)?.name ?? process.brandId;
  const processLabel = `${brandName} (${process.name})`;

  const baselineIssues = validateRoster(input);
  const baselineErrors = baselineIssues.filter((i) => i.severity === 'ERROR');
  const weeks = getMonthWeeks(month, settings.partialWeekMinDays);
  const targetWeek = weeks.find((w) => w.dates.includes(gapDate));
  const reqMatrix = buildRequirementMatrix(
    month,
    processes,
    holidays,
    coverageRules
  );
  const requiredOnGap = reqMatrix[targetProcessId]?.[gapDate] ?? process.minStaff;

  const primaryPodId = getProcessPrimaryPodId(
    targetProcessId,
    employees,
    assignments
  );

  const assignedEmployees = getAssignedEmployeesForProcess(
    targetProcessId,
    employees,
    assignments,
    settings
  );
  const assignedIds = new Set(assignedEmployees.map((e) => e.id));

  const validSuggestions: Suggestion[] = [];

  // =========================================================================
  // Candidate Type 1: SWAP_OFF
  // An employee assigned to the process whose WEEKLY_OFF falls on `gapDate`
  // moves their WEEKLY_OFF to another date `altDate` in the same week.
  // =========================================================================
  if (targetWeek) {
    for (const emp of assignedEmployees) {
      const gapEntry = entries.find(
        (e) => e.employeeId === emp.id && e.date === gapDate
      );
      if (!gapEntry || gapEntry.status !== 'WEEKLY_OFF') continue;

      for (const altDate of targetWeek.dates) {
        if (altDate === gapDate) continue;
        const altEntry = entries.find(
          (e) => e.employeeId === emp.id && e.date === altDate
        );
        if (!altEntry || altEntry.locked || altEntry.status !== 'WORK') {
          continue;
        }

        // Simulate on a copy of entries
        const simulatedEntries: RosterEntry[] = entries.map((e) => {
          if (e.employeeId === emp.id && e.date === gapDate) {
            return {
              ...e,
              status: 'WORK',
              locked: true,
              source: 'MANUAL',
            };
          }
          if (e.employeeId === emp.id && e.date === altDate) {
            return {
              ...e,
              status: 'WEEKLY_OFF',
              locked: true,
              source: 'MANUAL',
            };
          }
          return { ...e };
        });

        const simIssues = validateRoster({
          ...input,
          entries: simulatedEntries,
        });

        const { newErrorCount, gapImproved } = countNewErrors(
          baselineErrors,
          simIssues,
          targetProcessId,
          gapDate
        );

        if (newErrorCount === 0 && gapImproved) {
          validSuggestions.push({
            id: `sug-swap-${targetProcessId}-${gapDate}-${emp.id}-${altDate}`,
            processId: targetProcessId,
            date: gapDate,
            type: 'SWAP_OFF',
            title: `Swap weekly off for ${emp.name}`,
            description: `Move ${emp.name}'s weekly off from ${gapDate} (${getWeekdayName(getWeekday(gapDate), true)}) to ${altDate} (${getWeekdayName(getWeekday(altDate), true)}) where coverage has slack. (0 new errors, 0 comp-offs)`,
            employeeId: emp.id,
            swapToDate: altDate,
            compOffsCreated: 0,
            samePod: emp.podId === primaryPodId,
            newErrorsCreated: 0,
            simulatedEntries,
          });
        }
      }
    }
  }

  // =========================================================================
  // Candidate Type 2: BACKUP_CALL_IN
  // A BACKUP assigned to the process, or an active operational employee in the
  // same pod (or floater pool) who is currently off on `gapDate` (or can cover
  // `gapDate` without errors), works on `gapDate`. Earns 1 comp-off.
  // =========================================================================
  const candidatePool = [...employees]
    .filter(
      (e) =>
        e.active &&
        (settings.podLeadsCountForCoverage || !e.isPodLead) &&
        (assignedIds.has(e.id) ||
          e.podId === primaryPodId ||
          assignments.some((a) => a.employeeId === e.id && a.role === 'BACKUP'))
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const emp of candidatePool) {
    const gapEntry = entries.find(
      (e) => e.employeeId === emp.id && e.date === gapDate
    );
    if (!gapEntry) continue;

    const isAlreadyAssigned = assignedIds.has(emp.id);
    const samePod = emp.podId === primaryPodId;

    // Case 2A: Employee is currently WEEKLY_OFF or HOLIDAY on `gapDate`
    if (gapEntry.status === 'WEEKLY_OFF' || gapEntry.status === 'HOLIDAY') {
      // First try calling them in directly on `gapDate` (if they already have another off/holiday
      // in `targetWeek` so MISSING_WEEKLY_OFF is not violated)
      const directSimEntries: RosterEntry[] = entries.map((e) => {
        if (e.employeeId === emp.id && e.date === gapDate) {
          return {
            ...e,
            status: 'WORK',
            locked: true,
            source: 'MANUAL',
          };
        }
        return { ...e };
      });

      const tempAssignment: Assignment | undefined = isAlreadyAssigned
        ? undefined
        : {
            id: `asgn-callin-${targetProcessId}-${emp.id}`,
            employeeId: emp.id,
            processId: targetProcessId,
            role: 'BACKUP',
          };

      const directSimAssignments = tempAssignment
        ? [...assignments, tempAssignment]
        : assignments;

      const directSimIssues = validateRoster({
        ...input,
        assignments: directSimAssignments,
        entries: directSimEntries,
      });

      const directCheck = countNewErrors(
        baselineErrors,
        directSimIssues,
        targetProcessId,
        gapDate
      );

      if (directCheck.newErrorCount === 0 && directCheck.gapImproved) {
        validSuggestions.push({
          id: `sug-callin-${targetProcessId}-${gapDate}-${emp.id}`,
          processId: targetProcessId,
          date: gapDate,
          type: 'BACKUP_CALL_IN',
          title: `Call in ${emp.name} (${samePod ? 'Same Pod' : 'Backup Floater'})`,
          description: `Call in ${emp.name} to work on ${gapDate} for ${processLabel}. Earns 1 comp-off credit; creates 0 new errors.`,
          employeeId: emp.id,
          compOffsCreated: 1,
          samePod,
          newErrorsCreated: 0,
          simulatedEntries: directSimEntries,
          simulatedNewAssignment: tempAssignment,
        });
        continue;
      }

      // If direct call-in would leave `emp` without a weekly off in `targetWeek`,
      // simulate calling them in on `gapDate` and granting their COMP_OFF on a slack day in `targetWeek`.
      if (targetWeek) {
        for (const compDate of targetWeek.dates) {
          if (compDate === gapDate) continue;
          const compEntry = entries.find(
            (e) => e.employeeId === emp.id && e.date === compDate
          );
          if (!compEntry || compEntry.locked || compEntry.status !== 'WORK') {
            continue;
          }

          const simEntriesWithComp: RosterEntry[] = entries.map((e) => {
            if (e.employeeId === emp.id && e.date === gapDate) {
              return {
                ...e,
                status: 'WORK',
                locked: true,
                source: 'MANUAL',
              };
            }
            if (e.employeeId === emp.id && e.date === compDate) {
              return {
                ...e,
                status: 'COMP_OFF',
                locked: true,
                source: 'MANUAL',
              };
            }
            return { ...e };
          });

          const simIssuesWithComp = validateRoster({
            ...input,
            assignments: directSimAssignments,
            entries: simEntriesWithComp,
          });

          const compCheck = countNewErrors(
            baselineErrors,
            simIssuesWithComp,
            targetProcessId,
            gapDate
          );

          if (compCheck.newErrorCount === 0 && compCheck.gapImproved) {
            validSuggestions.push({
              id: `sug-callin-${targetProcessId}-${gapDate}-${emp.id}-${compDate}`,
              processId: targetProcessId,
              date: gapDate,
              type: 'BACKUP_CALL_IN',
              title: `Call in ${emp.name} (${samePod ? 'Same Pod' : 'Backup'}) with comp-off on ${compDate}`,
              description: `Have ${emp.name} cover ${processLabel} on ${gapDate} and take earned comp-off on ${compDate} (${getWeekdayName(getWeekday(compDate), true)}). Creates 0 new errors.`,
              employeeId: emp.id,
              swapToDate: compDate,
              compOffsCreated: 1,
              samePod,
              newErrorsCreated: 0,
              simulatedEntries: simEntriesWithComp,
              simulatedNewAssignment: tempAssignment,
            });
            break;
          }
        }
      }
    }
  }

  // =========================================================================
  // Sort valid staffing fixes according to Section 8 Ranking:
  // (1) no new errors (all have newErrorsCreated === 0),
  // (2) fewest comp-offs created (0 before 1),
  // (3) same pod preferred (samePod true before false),
  // (4) deterministic tie-break by id.
  // =========================================================================
  validSuggestions.sort((a, b) => {
    if (a.newErrorsCreated !== b.newErrorsCreated) {
      return a.newErrorsCreated - b.newErrorsCreated;
    }
    if (a.compOffsCreated !== b.compOffsCreated) {
      return a.compOffsCreated - b.compOffsCreated;
    }
    if (a.samePod !== b.samePod) {
      return a.samePod ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  // =========================================================================
  // Candidate Type 3: WAIVE_MINIMUM (Explicit manager decision)
  // Always available as an explicit manager override when simulated with 0 new errors.
  // =========================================================================
  const actualOnGap = Number(gapIssue.details?.actual ?? 0);
  const waiveRule: CoverageRule = {
    id: `rule-waive-${targetProcessId}-${gapDate}`,
    processId: targetProcessId,
    weekday: null,
    date: gapDate,
    minStaff: actualOnGap,
  };

  const waiveRules = [
    ...coverageRules.filter(
      (r) => !(r.processId === targetProcessId && r.date === gapDate)
    ),
    waiveRule,
  ];

  const waiveIssues = validateRoster({
    ...input,
    coverageRules: waiveRules,
  });

  const waiveCheck = countNewErrors(
    baselineErrors,
    waiveIssues,
    targetProcessId,
    gapDate
  );

  // If no staffing fix (SWAP_OFF or BACKUP_CALL_IN) resolved the gap completely,
  // include the "Needs external resource" diagnostic item per Section 8.
  const hasFullStaffingFix = validSuggestions.some((s) => {
    if (!s.simulatedEntries) return false;
    const postIssues = validateRoster({
      ...input,
      assignments: s.simulatedNewAssignment
        ? [...assignments, s.simulatedNewAssignment]
        : assignments,
      entries: s.simulatedEntries,
    });
    return !postIssues.some(
      (i) =>
        i.code === 'COVERAGE_GAP' &&
        i.processId === targetProcessId &&
        i.date === gapDate
    );
  });

  if (waiveCheck.newErrorCount === 0) {
    validSuggestions.push({
      id: `sug-waive-${targetProcessId}-${gapDate}`,
      processId: targetProcessId,
      date: gapDate,
      type: 'WAIVE_MINIMUM',
      title: `Waive / reduce minimum to ${actualOnGap} for ${gapDate}`,
      description: `Explicit manager decision: override ${processLabel} minimum staffing from ${requiredOnGap} to ${actualOnGap} on ${gapDate} only.`,
      compOffsCreated: 0,
      samePod: true,
      newErrorsCreated: 0,
      simulatedEntries: entries.map((e) => ({ ...e })),
      simulatedCoverageRule: waiveRule,
    });
  }

  if (!hasFullStaffingFix) {
    validSuggestions.push({
      id: `sug-external-${targetProcessId}-${gapDate}`,
      processId: targetProcessId,
      date: gapDate,
      type: 'NEEDS_EXTERNAL_RESOURCE',
      title: 'Needs external resource',
      description: `No internal off-day swap or backup call-in can fully satisfy ${processLabel} (requires ${requiredOnGap}, currently ${actualOnGap} working) on ${gapDate} without creating new errors. Needs external resource.`,
      compOffsCreated: 0,
      samePod: false,
      newErrorsCreated: 0,
    });
  }

  return validSuggestions;
}

/**
 * Generates simulated suggestions for a specific `COVERAGE_GAP` issue, or for all
 * `COVERAGE_GAP` issues currently present in the roster.
 */
export function suggestFixes(
  input: ValidationInput,
  targetIssue?: Issue
): Suggestion[] {
  if (targetIssue) {
    return suggestFixesForGap(input, targetIssue);
  }

  const allIssues = validateRoster(input);
  const gapIssues = allIssues.filter((i) => i.code === 'COVERAGE_GAP');
  const results: Suggestion[] = [];

  for (const gap of gapIssues) {
    results.push(...suggestFixesForGap(input, gap));
  }

  return results;
}
