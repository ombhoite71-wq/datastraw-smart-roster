/**
 * Smart Roster Management System - Requirement Matrix & Coverage Calculations
 * Strictly follows PROJECT_SPEC.md Section 5.1, 5.2, 5.5, and 7.1.
 */

import { getMonthDates, isHolidayDate, isProcessOpen, requiredStaff } from './calendar';
import {
  Assignment,
  CoverageRule,
  Employee,
  Holiday,
  Process,
  RequirementMatrix,
  RosterEntry,
  Setting,
} from './types';

/**
 * Builds the full requirement matrix `req[processId][date] = requiredHeadcount`
 * for all processes across all dates in `month` ("YYYY-MM").
 */
export function buildRequirementMatrix(
  month: string,
  processes: Process[],
  holidays: Holiday[],
  coverageRules: CoverageRule[]
): RequirementMatrix {
  const dates = getMonthDates(month);
  const sortedProcesses = [...processes].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const matrix: RequirementMatrix = {};

  for (const process of sortedProcesses) {
    matrix[process.id] = {};
    for (const date of dates) {
      matrix[process.id][date] = requiredStaff(
        process,
        date,
        holidays,
        coverageRules
      );
    }
  }

  return matrix;
}

/**
 * Returns all active employees assigned (PRIMARY or BACKUP) to a given process,
 * respecting `settings.podLeadsCountForCoverage`.
 * Sorted deterministically by employee ID.
 */
export function getAssignedEmployeesForProcess(
  processId: string,
  employees: Employee[],
  assignments: Assignment[],
  settings: Setting
): Employee[] {
  const assignedIds = new Set(
    assignments
      .filter((a) => a.processId === processId)
      .map((a) => a.employeeId)
  );

  return employees
    .filter(
      (e) =>
        e.active &&
        assignedIds.has(e.id) &&
        (settings.podLeadsCountForCoverage || !e.isPodLead)
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Returns all processes assigned to a specific employee, sorted by process ID.
 */
export function getProcessesForEmployee(
  employeeId: string,
  processes: Process[],
  assignments: Assignment[]
): Process[] {
  const processIds = new Set(
    assignments
      .filter((a) => a.employeeId === employeeId)
      .map((a) => a.processId)
  );

  return processes
    .filter((p) => processIds.has(p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Computes which assigned employees are working (`status === 'WORK'`) on `date`
 * for `processId`. Respects `settings.podLeadsCountForCoverage`.
 */
export function getWorkingEmployeesForProcessOnDate(
  processId: string,
  date: string,
  employees: Employee[],
  assignments: Assignment[],
  entries: RosterEntry[],
  settings: Setting
): Employee[] {
  const assignedEmployees = getAssignedEmployeesForProcess(
    processId,
    employees,
    assignments,
    settings
  );

  const entryMap = new Map<string, RosterEntry>();
  for (const entry of entries) {
    if (entry.date === date) {
      entryMap.set(entry.employeeId, entry);
    }
  }

  return assignedEmployees.filter((emp) => {
    const entry = entryMap.get(emp.id);
    return entry?.status === 'WORK';
  });
}

/**
 * Section 5.5: Working a public holiday on a process that operates on holidays
 * earns the employee a comp-off credit (shown in UI; not auto-scheduled).
 * Returns the list of holiday dates worked by `employeeId` on open processes.
 */
export function getEarnedCompOffHolidayDates(
  employeeId: string,
  processes: Process[],
  assignments: Assignment[],
  holidays: Holiday[],
  entries: RosterEntry[]
): string[] {
  const empProcesses = getProcessesForEmployee(
    employeeId,
    processes,
    assignments
  );
  if (empProcesses.length === 0) return [];

  const earnedDates: string[] = [];
  const empEntries = entries
    .filter((e) => e.employeeId === employeeId && e.status === 'WORK')
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of empEntries) {
    if (!isHolidayDate(entry.date, holidays)) continue;
    const worksOpenHolidayProcess = empProcesses.some(
      (p) => p.operatesOnHolidays && isProcessOpen(p, entry.date, holidays)
    );
    if (worksOpenHolidayProcess) {
      earnedDates.push(entry.date);
    }
  }

  return earnedDates;
}
