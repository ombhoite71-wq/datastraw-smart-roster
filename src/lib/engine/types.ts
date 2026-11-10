/**
 * Smart Roster Management System - Pure Engine Types
 * Strictly follows PROJECT_SPEC.md Section 4.1, 6, 7, and 8.
 * Pure TypeScript interfaces with zero database or UI dependencies.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday ... 6 = Saturday

export type AssignmentRole = 'PRIMARY' | 'BACKUP';

export type LeaveType = 'LEAVE' | 'COMP_OFF';

export type LeaveStatus = 'APPROVED' | 'PENDING';

export type RosterStatus = 'DRAFT' | 'PUBLISHED';

export type DayStatus = 'WORK' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE' | 'COMP_OFF';

export type EntrySource = 'AUTO' | 'MANUAL';

export type IssueCode =
  | 'COVERAGE_GAP'
  | 'NO_ASSIGNED_EMPLOYEE'
  | 'INSUFFICIENT_HEADCOUNT'
  | 'MISSING_WEEKLY_OFF'
  | 'MAX_CONSECUTIVE_DAYS'
  | 'LEAVE_CONFLICT'
  | 'FIXED_OFF_VIOLATED'
  | 'OVERLOAD'
  | 'PREFERENCE_VIOLATED';

export type IssueSeverity = 'ERROR' | 'WARNING';

export type SuggestionType =
  | 'SWAP_OFF'
  | 'BACKUP_CALL_IN'
  | 'WAIVE_MINIMUM'
  | 'NEEDS_EXTERNAL_RESOURCE';

export interface Pod {
  id: string;
  name: string;
  leadEmployeeId: string;
}

export interface Employee {
  id: string;
  name: string;
  podId: string;
  isPodLead: boolean;
  active: boolean;
  /** 0 = Sunday ... 6 = Saturday (soft constraint) */
  preferredOffDays: number[];
  /** 0 = Sunday ... 6 = Saturday (hard constraint when defined) */
  fixedOffDay?: number | null;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Process {
  id: string;
  brandId: string;
  /** Process name e.g. CS, ACC, NDR, RETENTION */
  name: string;
  /** 0 = Sunday ... 6 = Saturday */
  openDays: number[];
  operatesOnHolidays: boolean;
  minStaff: number;
}

export interface Assignment {
  id: string;
  employeeId: string;
  processId: string;
  role: AssignmentRole;
}

export interface CoverageRule {
  id: string;
  processId: string;
  /** 0-6 when weekday-specific; null when date-specific */
  weekday: number | null;
  /** "YYYY-MM-DD" when date-specific; null when weekday-specific */
  date: string | null;
  minStaff: number;
}

export interface Holiday {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  name: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  /** "YYYY-MM-DD" inclusive */
  startDate: string;
  /** "YYYY-MM-DD" inclusive */
  endDate: string;
  type: LeaveType;
  status: LeaveStatus;
  reason?: string;
}

export interface Roster {
  id: string;
  /** "YYYY-MM" */
  month: string;
  status: RosterStatus;
}

export interface RosterEntry {
  id: string;
  rosterId: string;
  employeeId: string;
  /** "YYYY-MM-DD" */
  date: string;
  status: DayStatus;
  locked: boolean;
  source: EntrySource;
}

export interface Setting {
  maxConsecutiveWorkDays: number;
  holidayCountsAsWeeklyOff: boolean;
  partialWeekMinDays: number;
  podLeadsCountForCoverage: boolean;
}

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  processId?: string;
  employeeId?: string;
  date?: string;
  details?: {
    required?: number;
    actual?: number;
    assignedCount?: number;
    causes?: string[];
    weekStart?: string;
    weekEnd?: string;
    streakLength?: number;
    streakStart?: string;
    streakEnd?: string;
    soleBrandsCount?: number;
    soleBrandNames?: string[];
    preferredDays?: number[];
    fixedDay?: number;
    conflictingLeaveId?: string;
    [key: string]: unknown;
  };
}

export interface Suggestion {
  id: string;
  processId: string;
  date: string;
  type: SuggestionType;
  title: string;
  description: string;
  employeeId?: string;
  /** For SWAP_OFF: the new date where the employee's weekly off moves */
  swapToDate?: string;
  /** Number of new comp-off credits earned by this fix (0 for SWAP_OFF, 1 for BACKUP_CALL_IN) */
  compOffsCreated: number;
  /** Whether the suggested employee belongs to the same pod as the process's primary team */
  samePod: boolean;
  /** Number of new ERRORs created when simulated (always 0 for actionable suggestions) */
  newErrorsCreated: number;
  /** Simulated full set of roster entries if this suggestion is applied */
  simulatedEntries?: RosterEntry[];
  /** Optional temporary Assignment if a same-pod employee is called in */
  simulatedNewAssignment?: Assignment;
  /** Optional date-specific CoverageRule if manager chooses to waive/reduce minimum */
  simulatedCoverageRule?: CoverageRule;
}

export interface WeekWindow {
  /** Index of the week slice in the month (0-based) */
  weekIndex: number;
  /** First date of the Mon-Sun week clipped to the month ("YYYY-MM-DD") */
  startDate: string;
  /** Last date of the Mon-Sun week clipped to the month ("YYYY-MM-DD") */
  endDate: string;
  /** All "YYYY-MM-DD" dates in this clipped week */
  dates: string[];
  /** True if dates.length >= settings.partialWeekMinDays */
  requiresWeeklyOff: boolean;
}

/**
 * Requirement matrix: req[processId][date] = required headcount (0 when closed)
 */
export type RequirementMatrix = Record<string, Record<string, number>>;

export interface ValidationInput {
  /** "YYYY-MM" */
  month: string;
  pods?: Pod[];
  brands?: Brand[];
  employees: Employee[];
  processes: Process[];
  assignments: Assignment[];
  coverageRules: CoverageRule[];
  holidays: Holiday[];
  leaves: Leave[];
  settings: Setting;
  entries: RosterEntry[];
}

export interface GenerationInput extends ValidationInput {
  rosterId?: string;
  /** Optional regeneration window start date ("YYYY-MM-DD") */
  regenerateFromDate?: string;
  /** Optional regeneration window end date ("YYYY-MM-DD") */
  regenerateToDate?: string;
}

export interface GenerationOutput {
  entries: RosterEntry[];
  issues: Issue[];
  requirements: RequirementMatrix;
}

export interface RosterDataset {
  pods: Pod[];
  employees: Employee[];
  brands: Brand[];
  processes: Process[];
  assignments: Assignment[];
  coverageRules: CoverageRule[];
  holidays: Holiday[];
  leaves: Leave[];
  rosters: Roster[];
  entries: RosterEntry[];
  settings: Setting;
}
