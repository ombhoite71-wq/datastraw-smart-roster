/**
 * Smart Roster Management System - Production Operations Workbench
 * Strictly uses the pure scheduling engine in src/lib/engine/ and deterministic seedData in src/lib/seedData.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileCheck2,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  getMonthDates,
  getMonthWeeks,
  getWeekday,
  getWeekdayName,
  isDateInRange,
  isHolidayDate,
  isProcessOpen,
} from './lib/engine/calendar';
import { generateRoster } from './lib/engine/generate';
import {
  buildRequirementMatrix,
  getEarnedCompOffHolidayDates,
  getProcessesForEmployee,
  getWorkingEmployeesForProcessOnDate,
} from './lib/engine/requirements';
import { suggestFixes } from './lib/engine/suggest';
import {
  Assignment,
  AssignmentRole,
  Brand,
  CoverageRule,
  DayStatus,
  Employee,
  Holiday,
  Issue,
  Leave,
  LeaveStatus,
  LeaveType,
  Process,
  RosterDataset,
  RosterStatus,
  Suggestion,
} from './lib/engine/types';
import { validateRoster } from './lib/engine/validate';
import {
  createSeedDataset,
  loadDatasetFromStorage,
  resetDemoData,
  saveDatasetToStorage,
} from './lib/seedData';

type MainTab = 'roster' | 'manage' | 'verification';
type RosterViewMode = 'company' | 'pod' | 'brand' | 'process' | 'employee';

interface ResolvedIssueRecord {
  id: string;
  code: string;
  processId?: string;
  date?: string;
  originalMessage: string;
  appliedFixTitle: string;
  appliedFixDescription: string;
}

interface DisplayIssueItem {
  key: string;
  code: Issue['code'];
  severity: Issue['severity'];
  message: string;
  processId?: string;
  employeeId?: string;
  date?: string;
  groupedDates?: string[];
}

/**
 * Formats an ISO date string ("YYYY-MM-DD") into "DD/MM/YYYY" for UI display.
 * Internal engine strings remain "YYYY-MM-DD".
 */
export function formatDateUI(isoDate?: string | null): string {
  if (!isoDate) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Replaces all embedded "YYYY-MM-DD" substrings inside any message or description
 * with "DD/MM/YYYY" for consistent UI presentation.
 */
export function formatTextDatesUI(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

const STATUS_BADGE_CLASSES: Record<DayStatus, string> = {
  WORK: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  WEEKLY_OFF: 'bg-slate-100 text-slate-700 border-slate-300',
  HOLIDAY: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  LEAVE: 'bg-amber-50 text-amber-800 border-amber-300',
  COMP_OFF: 'bg-teal-50 text-teal-800 border-teal-200',
};

const STATUS_SHORT_LABEL: Record<DayStatus, string> = {
  WORK: 'W',
  WEEKLY_OFF: 'OFF',
  HOLIDAY: 'HOL',
  LEAVE: 'LV',
  COMP_OFF: 'CO',
};

const CYCLE_STATUSES: DayStatus[] = [
  'WORK',
  'WEEKLY_OFF',
  'HOLIDAY',
  'LEAVE',
  'COMP_OFF',
];

const CALENDAR_PRESETS: Record<
  string,
  { label: string; openDays: number[]; operatesOnHolidays: boolean }
> = {
  '365': {
    label: '365 days (incl. Sundays & holidays)',
    openDays: [0, 1, 2, 3, 4, 5, 6],
    operatesOnHolidays: true,
  },
  DAILY_NO_HOL: {
    label: 'Daily except public holidays',
    openDays: [0, 1, 2, 3, 4, 5, 6],
    operatesOnHolidays: false,
  },
  MON_SAT_NO_HOL: {
    label: 'Sundays and public holidays off (Mon–Sat)',
    openDays: [1, 2, 3, 4, 5, 6],
    operatesOnHolidays: false,
  },
  CUSTOM: {
    label: 'Custom operating days & holiday rule',
    openDays: [1, 2, 3, 4, 5],
    operatesOnHolidays: false,
  },
};

export default function App() {
  const [dataset, setDataset] = useState<RosterDataset>(() =>
    loadDatasetFromStorage()
  );
  const [month, setMonth] = useState<string>('2026-12');
  const [activeTab, setActiveTab] = useState<MainTab>('roster');
  const [rosterView, setRosterView] = useState<RosterViewMode>('company');
  const [selectedPodId, setSelectedPodId] = useState<string>('ALL');
  const [selectedBrandId, setSelectedBrandId] = useState<string>('M2');
  const [selectedProcessId, setSelectedProcessId] = useState<string>('M2-CS');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('E01');
  const [highlightedCell, setHighlightedCell] = useState<{
    employeeId?: string;
    processId?: string;
    date?: string;
  } | null>(null);
  const [changeBanner, setChangeBanner] = useState<string | null>(null);

  const employees = dataset.employees;
  const activeEmployee =
    employees.find((e) => e.id === selectedEmployeeId) || employees[0];

  useEffect(() => {
    if (activeEmployee && selectedEmployeeId !== activeEmployee.id) {
      setSelectedEmployeeId(activeEmployee.id);
    }
  }, [activeEmployee, selectedEmployeeId]);

  useEffect(() => {
    if (!changeBanner) return;
    const timer = setTimeout(() => setChangeBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [changeBanner]);

  // Resolved issues history & collapsible toggle
  const [resolvedIssues, setResolvedIssues] = useState<ResolvedIssueRecord[]>(
    []
  );
  const [solvedDropdownOpen, setSolvedDropdownOpen] = useState<boolean>(true);

  // Publish confirmation modal state
  const [showPublishConfirmModal, setShowPublishConfirmModal] =
    useState<boolean>(false);

  // Manage Data tab forms
  const [newLeaveEmpId, setNewLeaveEmpId] = useState<string>('E02');
  const [newLeaveStart, setNewLeaveStart] = useState<string>('2026-12-08');
  const [newLeaveEnd, setNewLeaveEnd] = useState<string>('2026-12-08');
  const [newLeaveType, setNewLeaveType] = useState<LeaveType>('LEAVE');
  const [newLeaveStatus, setNewLeaveStatus] = useState<LeaveStatus>('APPROVED');
  const [newLeaveReason, setNewLeaveReason] = useState<string>(
    'Personal leave request'
  );

  const [newHolidayDate, setNewHolidayDate] = useState<string>('2026-12-24');
  const [newHolidayName, setNewHolidayName] =
    useState<string>('Christmas Eve');

  const [newBrandCode, setNewBrandCode] = useState<string>('S21');
  const [newBrandTitle, setNewBrandTitle] = useState<string>('KalaSutra');
  const [newProcessName, setNewProcessName] = useState<string>('CS');
  const [newProcessPreset, setNewProcessPreset] =
    useState<string>('MON_SAT_NO_HOL');
  const [customOpenDays, setCustomOpenDays] = useState<number[]>([
    1, 2, 3, 4, 5, 6,
  ]);
  const [customOperatesOnHolidays, setCustomOperatesOnHolidays] =
    useState<boolean>(false);
  const [newProcessMinStaff, setNewProcessMinStaff] = useState<number>(1);
  const [newEmpCode, setNewEmpCode] = useState<string>('E33');
  const [newEmpFullName, setNewEmpFullName] =
    useState<string>('Aarohi Deshpande');
  const [newEmpPodId, setNewEmpPodId] = useState<string>('P1');
  const [newEmpRole, setNewEmpRole] = useState<AssignmentRole>('PRIMARY');

  // Standalone Assignment linking form for existing Employees & Processes
  const [linkEmpId, setLinkEmpId] = useState<string>('E31');
  const [linkProcId, setLinkProcId] = useState<string>('S02-CS');
  const [linkRole, setLinkRole] = useState<AssignmentRole>('BACKUP');

  // Coverage Rule Override form
  const [newRuleProcessId, setNewRuleProcessId] = useState<string>('S01-CS');
  const [newRuleMinStaff, setNewRuleMinStaff] = useState<number>(2);
  const [newRuleWeekday, setNewRuleWeekday] = useState<string>('6');

  const dates = useMemo(() => getMonthDates(month), [month]);
  const weeks = useMemo(
    () => getMonthWeeks(month, dataset.settings.partialWeekMinDays),
    [month, dataset.settings.partialWeekMinDays]
  );

  const currentRosterRecord = useMemo(() => {
    return (
      dataset.rosters.find((r) => r.month === month) ?? {
        id: `roster-${month}`,
        month,
        status: 'DRAFT' as RosterStatus,
      }
    );
  }, [dataset.rosters, month]);

  const monthEntries = useMemo(() => {
    const filtered = dataset.entries.filter((e) => e.date.startsWith(month));
    if (filtered.length > 0) return filtered;
    const generated = generateRoster({
      ...dataset,
      month,
      entries: [],
    });
    return generated.entries;
  }, [dataset, month]);

  const requirements = useMemo(
    () =>
      buildRequirementMatrix(
        month,
        dataset.processes,
        dataset.holidays,
        dataset.coverageRules
      ),
    [month, dataset.processes, dataset.holidays, dataset.coverageRules]
  );

  const issues = useMemo(
    () =>
      validateRoster({
        ...dataset,
        month,
        entries: monthEntries,
      }),
    [dataset, month, monthEntries]
  );

  const errors = useMemo(
    () => issues.filter((i) => i.severity === 'ERROR'),
    [issues]
  );
  const warnings = useMemo(
    () => issues.filter((i) => i.severity === 'WARNING'),
    [issues]
  );

  // Group repeated PREFERENCE_VIOLATED warnings by employee into 1 single summary card
  const groupedDisplayIssues = useMemo<DisplayIssueItem[]>(() => {
    const items: DisplayIssueItem[] = [];
    const prefViolationsByEmp = new Map<
      string,
      {
        employeeId: string;
        dates: string[];
        preferredDays: number[];
      }
    >();

    for (const issue of issues) {
      if (issue.code === 'PREFERENCE_VIOLATED' && issue.employeeId) {
        const existing = prefViolationsByEmp.get(issue.employeeId);
        const prefDays = Array.isArray(issue.details?.preferredDays)
          ? (issue.details?.preferredDays as number[])
          : [];
        if (existing) {
          if (issue.date && !existing.dates.includes(issue.date)) {
            existing.dates.push(issue.date);
          }
        } else {
          prefViolationsByEmp.set(issue.employeeId, {
            employeeId: issue.employeeId,
            dates: issue.date ? [issue.date] : [],
            preferredDays: prefDays,
          });
        }
      } else {
        items.push({
          key: `${issue.code}-${issue.processId ?? ''}-${issue.employeeId ?? ''}-${issue.date ?? items.length}`,
          code: issue.code,
          severity: issue.severity,
          message: formatTextDatesUI(issue.message),
          processId: issue.processId,
          employeeId: issue.employeeId,
          date: issue.date,
        });
      }
    }

    for (const [empId, group] of prefViolationsByEmp.entries()) {
      const emp = dataset.employees.find((e) => e.id === empId);
      const empName = emp?.name ?? empId;
      const prefNames =
        group.preferredDays.length > 0
          ? group.preferredDays.map((d) => getWeekdayName(d, true)).join('/')
          : 'Preferred';
      const sortedDates = [...group.dates].sort();
      const formattedDates = sortedDates.map((d) => formatDateUI(d)).join(', ');

      items.push({
        key: `PREFERENCE_VIOLATED-GROUPED-${empId}`,
        code: 'PREFERENCE_VIOLATED',
        severity: 'WARNING',
        employeeId: empId,
        date: sortedDates[0],
        groupedDates: sortedDates,
        message: `${empName} worked on preferred off day (${prefNames}) across ${sortedDates.length} week(s) [${formattedDates}] to prioritize mandatory client coverage.`,
      });
    }

    return items;
  }, [issues, dataset.employees]);

  const suggestions = useMemo(() => {
    if (errors.filter((e) => e.code === 'COVERAGE_GAP').length === 0) {
      return [];
    }
    return suggestFixes({
      ...dataset,
      month,
      entries: monthEntries,
    });
  }, [dataset, month, monthEntries, errors]);

  const entryLookup = useMemo(() => {
    const map = new Map<string, (typeof monthEntries)[number]>();
    for (const e of monthEntries) {
      map.set(`${e.employeeId}:${e.date}`, e);
    }
    return map;
  }, [monthEntries]);

  // Run automated S1-S11 verification suite on pure engine
  const scenarioResults = useMemo(() => {
    const base = createSeedDataset();
    const res1 = generateRoster({ ...base, month: '2026-12', entries: [] });
    const res1Errors = res1.issues.filter((i) => i.severity === 'ERROR');

    // S2
    const s2Pass =
      res1.requirements['S01-CS']?.['2026-12-06'] === 0 &&
      !res1.issues.some(
        (i) => i.code === 'COVERAGE_GAP' && i.processId?.startsWith('S0')
      );

    // S3
    const e16CompOffs = getEarnedCompOffHolidayDates(
      'E16',
      base.processes,
      base.assignments,
      base.holidays,
      res1.entries
    );
    const e16OffDays = res1.entries.filter(
      (e) => e.employeeId === 'E16' && e.status === 'WEEKLY_OFF'
    );
    const s3Pass =
      e16CompOffs.includes('2026-12-25') &&
      e16OffDays.length >= 4 &&
      !res1.issues.some(
        (i) => i.code === 'COVERAGE_GAP' && i.processId?.startsWith('S17-')
      );

    // S4
    const m2CsFri = res1.entries.filter(
      (e) =>
        (e.employeeId === 'E22' || e.employeeId === 'E23') &&
        e.date === '2026-12-11' &&
        e.status === 'WORK'
    );
    const s4Pass =
      m2CsFri.length === 2 && res1.requirements['M2-ACC']?.['2026-12-06'] === 0;

    // S5
    const res2 = generateRoster({ ...base, month: '2026-12', entries: [] });
    const s5Pass =
      JSON.stringify(res1.entries) === JSON.stringify(res2.entries);

    // S6
    const lockedEntries = res1.entries.map((e) =>
      e.employeeId === 'E01' && e.date === '2026-12-02'
        ? {
            ...e,
            status: 'WEEKLY_OFF' as const,
            locked: true,
            source: 'MANUAL' as const,
          }
        : e
    );
    const res6 = generateRoster({
      ...base,
      month: '2026-12',
      entries: lockedEntries,
    });
    const lockedPreserved = res6.entries.find(
      (e) => e.employeeId === 'E01' && e.date === '2026-12-02'
    );
    const approvedLeavePreserved = res6.entries.find(
      (e) => e.employeeId === 'E22' && e.date === '2026-12-09'
    );
    const s6Pass =
      lockedPreserved?.status === 'WEEKLY_OFF' &&
      lockedPreserved?.locked === true &&
      approvedLeavePreserved?.status === 'LEAVE';

    // S7
    const leavesS7 = base.leaves.map((l) =>
      l.id === 'leave-pending-1' ? { ...l, status: 'APPROVED' as const } : l
    );
    const res7 = generateRoster({
      ...base,
      month: '2026-12',
      leaves: leavesS7,
      entries: [],
    });
    const gapS7 = res7.issues.find(
      (i) =>
        i.code === 'COVERAGE_GAP' &&
        i.processId === 'S02-CS' &&
        i.date === '2026-12-08'
    );
    const sugS7 = gapS7
      ? suggestFixes(
          { ...base, month: '2026-12', leaves: leavesS7, entries: res7.entries },
          gapS7
        )
      : [];
    const s7Pass = Boolean(gapS7) && sugS7.length > 0;

    // S8
    const leavesS8 = [
      ...base.leaves,
      {
        id: 'l-e22-sat',
        employeeId: 'E22',
        startDate: '2026-12-12',
        endDate: '2026-12-12',
        type: 'LEAVE' as const,
        status: 'APPROVED' as const,
      },
      {
        id: 'l-e23-sat',
        employeeId: 'E23',
        startDate: '2026-12-12',
        endDate: '2026-12-12',
        type: 'LEAVE' as const,
        status: 'APPROVED' as const,
      },
    ];
    const res8 = generateRoster({
      ...base,
      month: '2026-12',
      leaves: leavesS8,
      entries: [],
    });
    const gapS8 = res8.issues.find(
      (i) =>
        i.code === 'COVERAGE_GAP' &&
        i.processId === 'M2-CS' &&
        i.date === '2026-12-12'
    );
    const sugS8 = gapS8
      ? suggestFixes(
          { ...base, month: '2026-12', leaves: leavesS8, entries: res8.entries },
          gapS8
        )
      : [];
    const s8Pass =
      Boolean(gapS8) &&
      sugS8.some((s) => s.type === 'NEEDS_EXTERNAL_RESOURCE');

    // S9
    const asgnS9 = base.assignments.filter(
      (a) => !(a.employeeId === 'E31' && a.processId.startsWith('S17-'))
    );
    const res9 = generateRoster({
      ...base,
      month: '2026-12',
      assignments: asgnS9,
      entries: [],
    });
    const s9Pass = res9.issues.some(
      (i) => i.code === 'COVERAGE_GAP' && i.processId?.startsWith('S17-')
    );

    // S10
    const procsS10 = base.processes.map((p) =>
      p.id === 'S01-CS' ? { ...p, minStaff: 3 } : p
    );
    const issuesS10 = validateRoster({
      ...base,
      month: '2026-12',
      processes: procsS10,
      entries: res1.entries,
    });
    const s10Pass = issuesS10.some(
      (i) => i.code === 'INSUFFICIENT_HEADCOUNT' && i.processId === 'S01-CS'
    );

    // S11
    const asgnS11 = base.assignments.filter((a) => a.processId !== 'S01-CS');
    const issuesS11 = validateRoster({
      ...base,
      month: '2026-12',
      assignments: asgnS11,
      entries: res1.entries,
    });
    const s11Pass = issuesS11.some(
      (i) => i.code === 'NO_ASSIGNED_EMPLOYEE' && i.processId === 'S01-CS'
    );

    return [
      {
        id: 'S1',
        title: 'Generate Dec 2026 on baseline data gives 0 ERRORs',
        passed: res1Errors.length === 0,
        detail: `${res1Errors.length} ERRORs, ${res1.issues.length - res1Errors.length} WARNINGs (soft preference notes)`,
      },
      {
        id: 'S2',
        title:
          'Sunday-off brands (S01-S12, M3) have 0 Sunday requirement & 0 gaps',
        passed: s2Pass,
        detail: 'S01-CS Sunday (06/12/2026) requiredStaff = 0; 0 Sunday gaps',
      },
      {
        id: 'S3',
        title:
          '365 brand owner (E16) gets weekday off covered by E31; 25/12/2026 earns comp-off',
        passed: s3Pass,
        detail: `E16 earned holiday comp-offs: ${e16CompOffs.map((d) => formatDateUI(d)).join(', ')}`,
      },
      {
        id: 'S4',
        title:
          'Glowbar CS has both E22 & E23 working Fri-Sun; Glowbar ACC closed Sundays',
        passed: s4Pass,
        detail: 'M2-CS Fri-Sun actual = 2/2; M2-ACC Sunday req = 0',
      },
      {
        id: 'S5',
        title: 'Deterministic generator: running twice produces identical output',
        passed: s5Pass,
        detail: `Compared ${res1.entries.length} entries across two runs`,
      },
      {
        id: 'S6',
        title: 'Regeneration preserves locked manual entries and approved leaves',
        passed: s6Pass,
        detail:
          'Locked E01 02/12/2026 WEEKLY_OFF & E22 09/12/2026 LEAVE preserved',
      },
      {
        id: 'S7',
        title:
          'Approved leave for single-resource E02 on Tue 08/12/2026 flags COVERAGE_GAP + suggestions',
        passed: s7Pass,
        detail: `Flagged S02-CS gap; ${sugS7.length} simulated suggestions returned`,
      },
      {
        id: 'S8',
        title:
          'Both Glowbar CS employees on leave on Sat 12/12/2026 (min 2) flags Needs external resource',
        passed: s8Pass,
        detail: 'M2-CS 0/2 working -> flagged Needs external resource',
      },
      {
        id: 'S9',
        title:
          'Removing floater E31 from 365 brand S17 flags COVERAGE_GAPs without hiding welfare off',
        passed: s9Pass,
        detail:
          'Weekly offs still placed; COVERAGE_GAP errors surfaced by validator',
      },
      {
        id: 'S10',
        title:
          'Raising minStaff above assigned headcount flags INSUFFICIENT_HEADCOUNT',
        passed: s10Pass,
        detail:
          'S01-CS minStaff 3 > 1 assigned -> structural INSUFFICIENT_HEADCOUNT',
      },
      {
        id: 'S11',
        title:
          'Process with zero assigned employees flags NO_ASSIGNED_EMPLOYEE',
        passed: s11Pass,
        detail: 'Unassigned S01-CS -> structural NO_ASSIGNED_EMPLOYEE',
      },
    ];
  }, []);

  const updateRosterStatus = (
    targetMonth: string,
    newStatus: RosterStatus,
    baseDataset: RosterDataset
  ): RosterDataset => {
    const exists = baseDataset.rosters.some((r) => r.month === targetMonth);
    const updatedRosters = exists
      ? baseDataset.rosters.map((r) =>
          r.month === targetMonth ? { ...r, status: newStatus } : r
        )
      : [
          ...baseDataset.rosters,
          { id: `roster-${targetMonth}`, month: targetMonth, status: newStatus },
        ];
    return {
      ...baseDataset,
      rosters: updatedRosters,
    };
  };

  const handleRegenerateMonth = (freshUnlockAll = false) => {
    const otherMonthEntries = dataset.entries.filter(
      (e) => !e.date.startsWith(month)
    );
    const generated = generateRoster({
      ...dataset,
      month,
      entries: freshUnlockAll ? [] : monthEntries,
    });
    const next: RosterDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      entries: [...otherMonthEntries, ...generated.entries],
    });
    setDataset(next);
    saveDatasetToStorage(next);
    setChangeBanner(
      freshUnlockAll
        ? `Generated fresh ${month} roster for all ${dataset.employees.length} employees and ${dataset.brands.length} brands.`
        : `Regenerated ${month} roster (preserving locked cells and approved leaves).`
    );
  };

  const handleRegenerateActiveWeek = () => {
    const targetDate =
      highlightedCell?.date ??
      errors[0]?.date ??
      `${month}-07`;
    const activeWeek =
      weeks.find((w) => w.dates.includes(targetDate)) ?? weeks[1] ?? weeks[0];
    if (!activeWeek) return;

    const otherMonthEntries = dataset.entries.filter(
      (e) => !e.date.startsWith(month)
    );
    const generated = generateRoster({
      ...dataset,
      month,
      entries: monthEntries,
      regenerateFromDate: activeWeek.startDate,
      regenerateToDate: activeWeek.endDate,
    });
    const next: RosterDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      entries: [...otherMonthEntries, ...generated.entries],
    });
    setDataset(next);
    saveDatasetToStorage(next);
    setChangeBanner(
      `Regenerated week ${formatDateUI(activeWeek.startDate)} to ${formatDateUI(activeWeek.endDate)} while respecting locked entries and approved leaves.`
    );
  };

  const handlePublishClick = () => {
    if (currentRosterRecord.status === 'PUBLISHED') {
      const next = updateRosterStatus(month, 'DRAFT', dataset);
      setDataset(next);
      saveDatasetToStorage(next);
      setChangeBanner(`Reverted ${month} roster status back to DRAFT.`);
      return;
    }
    if (errors.length > 0) {
      setShowPublishConfirmModal(true);
      return;
    }
    const next = updateRosterStatus(month, 'PUBLISHED', dataset);
    setDataset(next);
    saveDatasetToStorage(next);
    setChangeBanner(`Published ${month} roster with 0 ERRORs.`);
  };

  const handleConfirmPublishWithErrors = () => {
    const next = updateRosterStatus(month, 'PUBLISHED', dataset);
    setDataset(next);
    saveDatasetToStorage(next);
    setShowPublishConfirmModal(false);
    setChangeBanner(
      `Published ${month} roster with manager override (${errors.length} acknowledged ERRORs).`
    );
  };

  const handleExportCsv = () => {
    if (currentRosterRecord.status !== 'PUBLISHED') return;

    const escapeCsvField = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const sortedEmployees = [...dataset.employees].sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    const rows: string[] = [
      'Date,Day,Employee_ID,Employee_Name,Pod,Assigned_Brands,Shift_Status,Comp_Off_Earned',
    ];

    for (const date of dates) {
      const formattedDate = formatDateUI(date);
      const dayShort = getWeekdayName(getWeekday(date), true);

      for (const emp of sortedEmployees) {
        const empBrands = emp.isPodLead
          ? 'Pod Lead (Supervisory)'
          : Array.from(
              new Set(
                dataset.assignments
                  .filter((a) => a.employeeId === emp.id)
                  .map((a) => {
                    const proc = dataset.processes.find(
                      (p) => p.id === a.processId
                    );
                    return proc
                      ? `${proc.brandId}${a.role === 'BACKUP' ? '(B)' : ''}`
                      : '';
                  })
                  .filter(Boolean)
              )
            ).join(' | ') || 'Unassigned';

        const compOffDates = getEarnedCompOffHolidayDates(
          emp.id,
          dataset.processes,
          dataset.assignments,
          dataset.holidays,
          monthEntries
        );
        const entry = entryLookup.get(`${emp.id}:${date}`);
        const shiftStatus: DayStatus = entry?.status ?? 'WORK';
        const compOffEarned = compOffDates.includes(date) ? 'YES' : 'NO';

        rows.push(
          [
            escapeCsvField(formattedDate),
            escapeCsvField(dayShort),
            escapeCsvField(emp.id),
            escapeCsvField(emp.name),
            escapeCsvField(emp.podId),
            escapeCsvField(empBrands),
            escapeCsvField(shiftStatus),
            escapeCsvField(compOffEarned),
          ].join(',')
        );
      }
    }

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Datastraw_Roster_December_2026.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setChangeBanner(
      'Exported published roster to Datastraw_Roster_December_2026.csv.'
    );
  };

  const handleResetDemo = () => {
    const fresh = resetDemoData();
    setDataset(fresh);
    setMonth('2026-12');
    setResolvedIssues([]);
    setShowPublishConfirmModal(false);
    setChangeBanner(
      'Reset localStorage to deterministic December 2026 baseline seed data.'
    );
  };

  const handleCycleCellStatus = (employeeId: string, date: string) => {
    const current = entryLookup.get(`${employeeId}:${date}`);
    const currentStatus: DayStatus = current?.status ?? 'WORK';
    const nextStatus =
      CYCLE_STATUSES[
        (CYCLE_STATUSES.indexOf(currentStatus) + 1) % CYCLE_STATUSES.length
      ];

    const updatedEntries = dataset.entries.map((e) => {
      if (e.employeeId === employeeId && e.date === date) {
        return {
          ...e,
          status: nextStatus,
          locked: true,
          source: 'MANUAL' as const,
        };
      }
      return e;
    });

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      entries: updatedEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Manual edit: ${employeeId} on ${formatDateUI(date)} changed from ${currentStatus} to ${nextStatus} (locked, revalidated immediately).`
    );
  };

  const handleTogglePendingLeave = () => {
    const pendingLeave = dataset.leaves.find((l) => l.id === 'leave-pending-1');
    if (!pendingLeave) return;
    const newStatus =
      pendingLeave.status === 'PENDING' ? 'APPROVED' : 'PENDING';

    const updatedLeaves = dataset.leaves.map((l) =>
      l.id === 'leave-pending-1'
        ? { ...l, status: newStatus as 'APPROVED' | 'PENDING' }
        : l
    );

    const updatedEntries = dataset.entries.map((e) => {
      if (e.employeeId === 'E02' && e.date === '2026-12-08') {
        return {
          ...e,
          status: (newStatus === 'APPROVED' ? 'LEAVE' : 'WORK') as DayStatus,
          locked: newStatus === 'APPROVED',
          source: 'AUTO' as const,
        };
      }
      return e;
    });

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      leaves: updatedLeaves,
      entries: updatedEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      newStatus === 'APPROVED'
        ? `Approved E02 leave on Tue ${formatDateUI('2026-12-08')} -> Validator detected S02 coverage gap and simulated candidate fixes.`
        : `Reverted E02 leave on Tue ${formatDateUI('2026-12-08')} back to PENDING -> Coverage restored to 0 errors.`
    );
  };

  const handleApplySuggestion = (sug: Suggestion) => {
    if (!sug.simulatedEntries) return;

    const targetErrors = errors.filter(
      (err) =>
        err.code === 'COVERAGE_GAP' &&
        err.processId === sug.processId &&
        err.date === sug.date
    );

    const otherMonthEntries = dataset.entries.filter(
      (e) => !e.date.startsWith(month)
    );
    const nextAssignments = sug.simulatedNewAssignment
      ? [...dataset.assignments, sug.simulatedNewAssignment]
      : dataset.assignments;
    const nextRules = sug.simulatedCoverageRule
      ? [
          ...dataset.coverageRules.filter(
            (r) =>
              !(
                r.processId === sug.simulatedCoverageRule!.processId &&
                r.date === sug.simulatedCoverageRule!.date
              )
          ),
          sug.simulatedCoverageRule,
        ]
      : dataset.coverageRules;

    const nextDataset: RosterDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      assignments: nextAssignments,
      coverageRules: nextRules,
      entries: [...otherMonthEntries, ...sug.simulatedEntries],
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);

    const newSolvedRecords: ResolvedIssueRecord[] =
      targetErrors.length > 0
        ? targetErrors.map((err, i) => ({
            id: `solved-${Date.now()}-${i}-${sug.id}`,
            code: err.code,
            processId: err.processId,
            date: err.date,
            originalMessage: formatTextDatesUI(err.message),
            appliedFixTitle: formatTextDatesUI(sug.title),
            appliedFixDescription: formatTextDatesUI(sug.description),
          }))
        : [
            {
              id: `solved-${Date.now()}-${sug.id}`,
              code: 'COVERAGE_GAP',
              processId: sug.processId,
              date: sug.date,
              originalMessage: `${sug.processId} coverage gap on ${formatDateUI(sug.date)}`,
              appliedFixTitle: formatTextDatesUI(sug.title),
              appliedFixDescription: formatTextDatesUI(sug.description),
            },
          ];

    setResolvedIssues((prev) => [...newSolvedRecords, ...prev]);
    setSolvedDropdownOpen(true);
    setChangeBanner(`Applied validated fix: ${formatTextDatesUI(sug.title)}`);
  };

  // Manage Data Handlers
  const handleAddLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveEmpId || !newLeaveStart || !newLeaveEnd) return;
    const start = newLeaveStart <= newLeaveEnd ? newLeaveStart : newLeaveEnd;
    const end = newLeaveEnd >= newLeaveStart ? newLeaveEnd : newLeaveStart;

    const newLeave: Leave = {
      id: `leave-${Date.now()}`,
      employeeId: newLeaveEmpId,
      startDate: start,
      endDate: end,
      type: newLeaveType,
      status: newLeaveStatus,
      reason: newLeaveReason.trim() || 'Manager added leave',
    };

    const nextLeaves = [...dataset.leaves, newLeave];
    let nextEntries = [...dataset.entries];

    if (newLeaveStatus === 'APPROVED') {
      nextEntries = nextEntries.map((entry) => {
        if (
          entry.employeeId === newLeaveEmpId &&
          isDateInRange(entry.date, start, end)
        ) {
          return {
            ...entry,
            status: newLeaveType === 'COMP_OFF' ? 'COMP_OFF' : 'LEAVE',
            locked: true,
            source: 'MANUAL',
          };
        }
        return entry;
      });
    }

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      leaves: nextLeaves,
      entries: nextEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Added ${newLeaveStatus} ${newLeaveType} for ${newLeaveEmpId} (${formatDateUI(start)} to ${formatDateUI(end)}).`
    );
  };

  const handleToggleExistingLeaveStatus = (leaveId: string) => {
    const target = dataset.leaves.find((l) => l.id === leaveId);
    if (!target) return;
    const nextStatus: LeaveStatus =
      target.status === 'APPROVED' ? 'PENDING' : 'APPROVED';

    const nextLeaves = dataset.leaves.map((l) =>
      l.id === leaveId ? { ...l, status: nextStatus } : l
    );

    const nextEntries = dataset.entries.map((entry) => {
      if (
        entry.employeeId === target.employeeId &&
        isDateInRange(entry.date, target.startDate, target.endDate)
      ) {
        return {
          ...entry,
          status: (nextStatus === 'APPROVED'
            ? target.type === 'COMP_OFF'
              ? 'COMP_OFF'
              : 'LEAVE'
            : 'WORK') as DayStatus,
          locked: nextStatus === 'APPROVED',
          source: 'AUTO' as const,
        };
      }
      return entry;
    });

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      leaves: nextLeaves,
      entries: nextEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Updated leave ${target.employeeId} (${formatDateUI(target.startDate)}) to ${nextStatus}.`
    );
  };

  const handleDeleteLeave = (leaveId: string) => {
    const target = dataset.leaves.find((l) => l.id === leaveId);
    const nextLeaves = dataset.leaves.filter((l) => l.id !== leaveId);
    const nextEntries = target
      ? dataset.entries.map((entry) => {
          if (
            entry.employeeId === target.employeeId &&
            isDateInRange(entry.date, target.startDate, target.endDate) &&
            (entry.status === 'LEAVE' || entry.status === 'COMP_OFF')
          ) {
            return {
              ...entry,
              status: 'WORK' as DayStatus,
              locked: false,
              source: 'AUTO' as const,
            };
          }
          return entry;
        })
      : dataset.entries;

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      leaves: nextLeaves,
      entries: nextEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner('Removed leave record and revalidated roster.');
  };

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName.trim()) return;
    if (dataset.holidays.some((h) => h.date === newHolidayDate)) {
      setChangeBanner(
        `Holiday on ${formatDateUI(newHolidayDate)} already exists.`
      );
      return;
    }

    const newHol: Holiday = {
      id: `hol-${newHolidayDate}`,
      date: newHolidayDate,
      name: newHolidayName.trim(),
    };
    const nextHolidays = [...dataset.holidays, newHol].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const nextEntries = dataset.entries.map((entry) => {
      if (entry.date !== newHolidayDate) return entry;
      if (
        entry.status === 'LEAVE' ||
        entry.status === 'COMP_OFF' ||
        entry.locked
      ) {
        return entry;
      }
      const empProcs = getProcessesForEmployee(
        entry.employeeId,
        dataset.processes,
        dataset.assignments
      );
      const allClosedOnHoliday =
        empProcs.length > 0
          ? empProcs.every(
              (p) => !isProcessOpen(p, newHolidayDate, nextHolidays)
            )
          : true;

      if (allClosedOnHoliday) {
        return {
          ...entry,
          status: 'HOLIDAY' as DayStatus,
          source: 'AUTO' as const,
        };
      }
      return entry;
    });

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      holidays: nextHolidays,
      entries: nextEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Added public holiday "${newHol.name}" on ${formatDateUI(newHolidayDate)}. Closed-holiday brands flipped to HOLIDAY; 365-day working staff earn comp-off credit.`
    );
  };

  const handleDeleteHoliday = (holidayId: string) => {
    const target = dataset.holidays.find((h) => h.id === holidayId);
    const nextHolidays = dataset.holidays.filter((h) => h.id !== holidayId);
    const nextEntries = target
      ? dataset.entries.map((entry) => {
          if (entry.date === target.date && entry.status === 'HOLIDAY') {
            return {
              ...entry,
              status: 'WORK' as DayStatus,
              locked: false,
              source: 'AUTO' as const,
            };
          }
          return entry;
        })
      : dataset.entries;

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      holidays: nextHolidays,
      entries: nextEntries,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      target
        ? `Deleted public holiday on ${formatDateUI(target.date)}.`
        : 'Deleted holiday.'
    );
  };

  const handleToggleCustomWeekday = (weekday: number) => {
    setCustomOpenDays((prev) =>
      prev.includes(weekday)
        ? prev.filter((d) => d !== weekday)
        : [...prev, weekday].sort((a, b) => a - b)
    );
  };

  const handleCreateBrandProcessEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    const bId = newBrandCode.trim().toUpperCase();
    const bTitle = newBrandTitle.trim();
    const pName = newProcessName.trim().toUpperCase();
    const eId = newEmpCode.trim().toUpperCase();
    const eFullName = newEmpFullName.trim();

    if (!bId || !bTitle || !pName || !eId || !eFullName) return;

    const isCustom = newProcessPreset === 'CUSTOM';
    const preset =
      CALENDAR_PRESETS[newProcessPreset] ?? CALENDAR_PRESETS.MON_SAT_NO_HOL;
    const openDays = isCustom ? [...customOpenDays] : [...preset.openDays];
    const operatesOnHolidays = isCustom
      ? customOperatesOnHolidays
      : preset.operatesOnHolidays;

    const brandDisplayName = bTitle.startsWith(bId)
      ? bTitle
      : `${bId} - ${bTitle}`;
    const nextBrands: Brand[] = dataset.brands.some((b) => b.id === bId)
      ? dataset.brands
      : [...dataset.brands, { id: bId, name: brandDisplayName }];

    const procId = `${bId}-${pName}`;
    const newProcess: Process = {
      id: procId,
      brandId: bId,
      name: pName,
      openDays,
      operatesOnHolidays,
      minStaff: Math.max(1, Number(newProcessMinStaff) || 1),
    };
    const nextProcesses = [
      ...dataset.processes.filter((p) => p.id !== procId),
      newProcess,
    ];

    const empDisplayName = eFullName.startsWith(eId)
      ? eFullName
      : `${eId} - ${eFullName}`;
    const newEmp: Employee = {
      id: eId,
      name: empDisplayName,
      podId: newEmpPodId,
      isPodLead: false,
      active: true,
      preferredOffDays: [],
      fixedOffDay: null,
    };
    const nextEmployees = [
      ...dataset.employees.filter((emp) => emp.id !== eId),
      newEmp,
    ];

    const asgnId = `asgn-${procId}-${eId}`;
    const newAssignment: Assignment = {
      id: asgnId,
      employeeId: eId,
      processId: procId,
      role: newEmpRole,
    };
    const nextAssignments = [
      ...dataset.assignments.filter((a) => a.id !== asgnId),
      newAssignment,
    ];

    const otherMonthEntries = dataset.entries.filter(
      (entry) => !entry.date.startsWith(month)
    );
    const generated = generateRoster({
      ...dataset,
      month,
      brands: nextBrands,
      processes: nextProcesses,
      employees: nextEmployees,
      assignments: nextAssignments,
      entries: monthEntries,
    });

    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      brands: nextBrands,
      processes: nextProcesses,
      employees: nextEmployees,
      assignments: nextAssignments,
      entries: [...otherMonthEntries, ...generated.entries],
    });

    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setSelectedBrandId(bId);
    setSelectedProcessId(procId);
    setSelectedEmployeeId(eId);
    setChangeBanner(
      `Created ${brandDisplayName} (${procId}, minStaff ${newProcess.minStaff}) + ${empDisplayName} (${newEmpRole}) and regenerated ${month} roster.`
    );
  };

  const handleAddStandaloneAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkEmpId || !linkProcId) return;
    const asgnId = `asgn-${linkProcId}-${linkEmpId}`;
    const newAssignment: Assignment = {
      id: asgnId,
      employeeId: linkEmpId,
      processId: linkProcId,
      role: linkRole,
    };
    const nextAssignments = [
      ...dataset.assignments.filter(
        (a) => !(a.employeeId === linkEmpId && a.processId === linkProcId)
      ),
      newAssignment,
    ];
    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      assignments: nextAssignments,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Assigned ${linkEmpId} to ${linkProcId} as ${linkRole}.`
    );
  };

  const handleDeleteAssignment = (assignmentId: string) => {
    const target = dataset.assignments.find((a) => a.id === assignmentId);
    const nextAssignments = dataset.assignments.filter(
      (a) => a.id !== assignmentId
    );
    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      assignments: nextAssignments,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      target
        ? `Removed assignment ${target.employeeId} from ${target.processId}.`
        : 'Removed assignment.'
    );
  };

  const handleAddCoverageRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleProcessId) return;
    const weekdayNum = Number(newRuleWeekday);
    const ruleId = `rule-${newRuleProcessId}-wd-${weekdayNum}`;
    const rule: CoverageRule = {
      id: ruleId,
      processId: newRuleProcessId,
      weekday: weekdayNum,
      date: null,
      minStaff: Math.max(1, Number(newRuleMinStaff) || 1),
    };
    const nextRules = [
      ...dataset.coverageRules.filter((r) => r.id !== ruleId),
      rule,
    ];
    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      coverageRules: nextRules,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner(
      `Updated coverage rule: ${newRuleProcessId} on ${getWeekdayName(weekdayNum)} minStaff = ${rule.minStaff}.`
    );
  };

  const handleDeleteCoverageRule = (ruleId: string) => {
    const nextRules = dataset.coverageRules.filter((r) => r.id !== ruleId);
    const nextDataset = updateRosterStatus(month, 'DRAFT', {
      ...dataset,
      coverageRules: nextRules,
    });
    setDataset(nextDataset);
    saveDatasetToStorage(nextDataset);
    setChangeBanner('Removed coverage rule override.');
  };

  const filteredEmployees = useMemo(() => {
    const all = [...dataset.employees].sort((a, b) => a.id.localeCompare(b.id));
    if (rosterView === 'pod') {
      if (selectedPodId === 'ALL') {
        return [...all].sort((a, b) => {
          const podCmp = a.podId.localeCompare(b.podId);
          if (podCmp !== 0) return podCmp;
          if (a.isPodLead !== b.isPodLead) return a.isPodLead ? -1 : 1;
          return a.id.localeCompare(b.id);
        });
      }
      return all
        .filter((e) => e.podId === selectedPodId)
        .sort((a, b) => {
          if (a.isPodLead !== b.isPodLead) return a.isPodLead ? -1 : 1;
          return a.id.localeCompare(b.id);
        });
    }
    if (rosterView === 'brand') {
      const brandProcIds = new Set(
        dataset.processes
          .filter((p) => p.brandId === selectedBrandId)
          .map((p) => p.id)
      );
      const empIds = new Set(
        dataset.assignments
          .filter((a) => brandProcIds.has(a.processId))
          .map((a) => a.employeeId)
      );
      return all.filter((e) => empIds.has(e.id));
    }
    if (rosterView === 'process') {
      const empIds = new Set(
        dataset.assignments
          .filter((a) => a.processId === selectedProcessId)
          .map((a) => a.employeeId)
      );
      return all.filter((e) => empIds.has(e.id));
    }
    if (rosterView === 'employee') {
      return activeEmployee
        ? all.filter((e) => e.id === activeEmployee.id)
        : [];
    }
    return all;
  }, [
    dataset.employees,
    dataset.processes,
    dataset.assignments,
    rosterView,
    selectedPodId,
    selectedBrandId,
    selectedProcessId,
    activeEmployee,
  ]);

  const e02Leave = dataset.leaves.find((l) => l.id === 'leave-pending-1');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Bar: 3 clean tabs */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('roster');
          }}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Datastraw Roster Engine
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {(
            [
              ['roster', 'Roster Schedule'],
              ['manage', 'Manage Data'],
              ['verification', 'System Verification'],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === tabKey
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleResetDemo}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Demo Data
          </button>
        </div>
      </header>

      {/* Workspace Controls & Summary Strip */}
      <div className="px-6 py-4 bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <label
                htmlFor="month-select"
                className="text-xs font-medium text-slate-600"
              >
                Month:
              </label>
              <select
                id="month-select"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="text-xs font-mono font-medium bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900"
              >
                <option value="2026-12">12/2026 (Dec 2026 Demo)</option>
                <option value="2027-02">02/2027 (Feb 2027 - 28 Days)</option>
              </select>
            </div>

            <button
              onClick={() => handleRegenerateMonth(false)}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Generate Roster
            </button>

            <button
              onClick={handleRegenerateActiveWeek}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Regenerate the selected/active week while respecting locked manual cells and approved leaves"
            >
              Regenerate Week
            </button>

            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <span
                className={`text-[11px] font-mono font-semibold px-2.5 py-1 rounded border ${
                  currentRosterRecord.status === 'PUBLISHED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}
              >
                {currentRosterRecord.status}
              </span>

              <button
                onClick={handlePublishClick}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  currentRosterRecord.status === 'PUBLISHED'
                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                {currentRosterRecord.status === 'PUBLISHED'
                  ? 'Unpublish Roster'
                  : 'Publish Roster'}
              </button>

              <button
                onClick={handleExportCsv}
                disabled={currentRosterRecord.status !== 'PUBLISHED'}
                title={
                  currentRosterRecord.status === 'PUBLISHED'
                    ? 'Download Datastraw_Roster_December_2026.csv'
                    : 'Publish the roster first to enable CSV export'
                }
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
                  currentRosterRecord.status === 'PUBLISHED'
                    ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Export Roster (CSV)
              </button>
            </div>

            <button
              onClick={handleTogglePendingLeave}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                e02Leave?.status === 'APPROVED'
                  ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {e02Leave?.status === 'APPROVED'
                ? `Revert E02 Leave (${formatDateUI('2026-12-08')}) to PENDING`
                : `Quick Demo: Approve E02 Leave (${formatDateUI('2026-12-08')})`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
            <span>{dataset.employees.length} People</span>
            <span aria-hidden="true">·</span>
            <span>80% Single-Resource Brands · 20% Multi-Employee Brands</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                errors.length === 0
                  ? 'text-emerald-700 font-semibold'
                  : 'text-red-600 font-semibold'
              }
            >
              {errors.length} ERRORs
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-700 font-semibold">
              {warnings.length} WARNINGs
            </span>
          </div>
        </div>

        {/* 5-View Switcher Bar inside Roster Schedule */}
        {activeTab === 'roster' && (
          <div className="max-w-[1600px] mx-auto mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['company', 'Company-Wide'],
                  ['pod', 'Pod-Wise'],
                  ['brand', 'Brand-Wise'],
                  ['process', 'Process-Wise'],
                  ['employee', 'Employee-Wise'],
                ] as const
              ).map(([vMode, vLabel]) => (
                <button
                  key={vMode}
                  onClick={() => setRosterView(vMode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    rosterView === vMode
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {vLabel}
                </button>
              ))}
            </div>

            {rosterView !== 'company' && (
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="w-4 h-4 text-slate-400" />
                {rosterView === 'pod' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Select Pod:
                    </span>
                    <button
                      onClick={() => setSelectedPodId('ALL')}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        selectedPodId === 'ALL'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      All Pods (Grouped)
                    </button>
                    {dataset.pods.map((pod) => (
                      <button
                        key={pod.id}
                        onClick={() => setSelectedPodId(pod.id)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                          selectedPodId === pod.id
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {pod.id} — {pod.name}
                      </button>
                    ))}
                  </div>
                )}

                {rosterView === 'brand' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Select Brand:
                    </span>
                    <select
                      value={selectedBrandId}
                      onChange={(e) => setSelectedBrandId(e.target.value)}
                      className="text-xs font-medium bg-slate-50 border border-slate-300 rounded px-2.5 py-1"
                    >
                      {dataset.brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {rosterView === 'process' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Select Process:
                    </span>
                    <select
                      value={selectedProcessId}
                      onChange={(e) => setSelectedProcessId(e.target.value)}
                      className="text-xs font-medium bg-slate-50 border border-slate-300 rounded px-2.5 py-1"
                    >
                      {dataset.processes.map((p) => {
                        const brand = dataset.brands.find(
                          (b) => b.id === p.brandId
                        );
                        return (
                          <option key={p.id} value={p.id}>
                            {brand?.name ?? p.brandId} — {p.name}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {rosterView === 'employee' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Select Employee:
                    </span>
                    <select
                      value={activeEmployee.id}
                      onChange={(e) => setSelectedEmployeeId(e.target.value)}
                      className="text-xs font-medium bg-slate-50 border border-slate-300 rounded px-2.5 py-1"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.podId}
                          {emp.isPodLead ? ' - Pod Lead' : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Change Notification Banner */}
      {changeBanner && (
        <div className="px-6 py-2.5 bg-slate-900 text-white text-xs flex items-center justify-between">
          <span>{formatTextDatesUI(changeBanner)}</span>
          <button
            onClick={() => setChangeBanner(null)}
            aria-label="Close notification banner"
            title="Dismiss"
            className="text-slate-300 hover:text-white ml-4 shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Publish Confirmation Modal when ERROR > 0 */}
      {showPublishConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Unresolved Coverage or Welfare Errors ({errors.length})
              </div>
              <button
                onClick={() => setShowPublishConfirmModal(false)}
                className="text-xs font-mono text-slate-500 hover:text-slate-900"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              This roster currently has{' '}
              <span className="font-mono font-bold text-red-600">
                {errors.length} mandatory ERROR(s)
              </span>
              . Publishing with active errors requires explicit manager confirmation:
            </p>
            <div className="mt-3 max-h-48 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-200 bg-slate-50">
              {errors.map((err, i) => (
                <div key={i} className="p-2.5 text-xs font-mono text-red-900">
                  <div className="font-bold">
                    {err.code} {err.date ? `· ${formatDateUI(err.date)}` : ''}
                  </div>
                  <div className="text-[11px] text-slate-700 mt-0.5">
                    {formatTextDatesUI(err.message)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPublishConfirmModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPublishWithErrors}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Confirm &amp; Publish Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-6 grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left/Center Column */}
        <div className="xl:col-span-9 flex flex-col gap-6 min-w-0">
          {activeTab === 'verification' ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    System Verification &amp; Automated Health Checks
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Pure TypeScript scheduling and validation engine verification running live against baseline seed data.
                  </p>
                </div>
                <div className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1">
                  {scenarioResults.filter((s) => s.passed).length} /{' '}
                  {scenarioResults.length} PASSED
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {scenarioResults.map((s) => (
                  <div
                    key={s.id}
                    className="py-3 flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      {s.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          <span className="font-mono mr-2">{s.id}:</span>
                          {s.title}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {s.detail}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-mono font-semibold shrink-0 ${
                        s.passed ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {s.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === 'manage' ? (
            <div className="flex flex-col gap-6">
              {/* Section 1: Leaves & Comp-Offs */}
              <section className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="pb-3 mb-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    01. Planned Leaves &amp; Comp-Offs
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Only APPROVED leaves block availability and lock the roster cell. Adding an approved leave revalidates immediately.
                  </p>
                </div>

                <form
                  onSubmit={handleAddLeave}
                  className="grid grid-cols-1 md:grid-cols-6 gap-3 pb-4 mb-4 border-b border-slate-200"
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Employee
                    </label>
                    <select
                      value={newLeaveEmpId}
                      onChange={(e) => setNewLeaveEmpId(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {dataset.employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Start Date ({formatDateUI(newLeaveStart)})
                    </label>
                    <input
                      type="date"
                      value={newLeaveStart}
                      onChange={(e) => {
                        setNewLeaveStart(e.target.value);
                        if (newLeaveEnd < e.target.value) {
                          setNewLeaveEnd(e.target.value);
                        }
                      }}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      End Date ({formatDateUI(newLeaveEnd)})
                    </label>
                    <input
                      type="date"
                      value={newLeaveEnd}
                      onChange={(e) => setNewLeaveEnd(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Type
                    </label>
                    <select
                      value={newLeaveType}
                      onChange={(e) =>
                        setNewLeaveType(e.target.value as LeaveType)
                      }
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="LEAVE">LEAVE</option>
                      <option value="COMP_OFF">COMP_OFF</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Status
                    </label>
                    <select
                      value={newLeaveStatus}
                      onChange={(e) =>
                        setNewLeaveStatus(e.target.value as LeaveStatus)
                      }
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="APPROVED">APPROVED</option>
                      <option value="PENDING">PENDING</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Leave
                    </button>
                  </div>
                </form>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                        <th className="py-2 px-3">Employee</th>
                        <th className="py-2 px-3">Dates (DD/MM/YYYY)</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Note</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {dataset.leaves.map((lv) => {
                        const emp = dataset.employees.find(
                          (e) => e.id === lv.employeeId
                        );
                        return (
                          <tr key={lv.id}>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {emp?.name ?? lv.employeeId}
                            </td>
                            <td className="py-2 px-3 tabular-nums">
                              {formatDateUI(lv.startDate)} →{' '}
                              {formatDateUI(lv.endDate)}
                            </td>
                            <td className="py-2 px-3">{lv.type}</td>
                            <td className="py-2 px-3">
                              <span
                                className={
                                  lv.status === 'APPROVED'
                                    ? 'text-emerald-700 font-bold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {lv.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-sans text-slate-600">
                              {lv.reason ? formatTextDatesUI(lv.reason) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right flex items-center justify-end gap-2">
                              <button
                                onClick={() =>
                                  handleToggleExistingLeaveStatus(lv.id)
                                }
                                className="px-2.5 py-1 text-[11px] border border-slate-300 rounded bg-white hover:bg-slate-50"
                              >
                                Toggle{' '}
                                {lv.status === 'APPROVED'
                                  ? 'PENDING'
                                  : 'APPROVED'}
                              </button>
                              <button
                                onClick={() => handleDeleteLeave(lv.id)}
                                className="p-1 text-slate-500 hover:text-red-600"
                                title="Delete leave"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 2: Public Holidays */}
              <section className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="pb-3 mb-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    02. Company Public Holidays
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Adding a holiday updates closed-holiday brand employees to HOLIDAY and awards comp-off credits to 365-day working staff.
                  </p>
                </div>

                <form
                  onSubmit={handleAddHoliday}
                  className="grid grid-cols-1 md:grid-cols-4 gap-3 pb-4 mb-4 border-b border-slate-200"
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Holiday Date ({formatDateUI(newHolidayDate)})
                    </label>
                    <input
                      type="date"
                      value={newHolidayDate}
                      onChange={(e) => setNewHolidayDate(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-[11px] font-mono text-slate-600">
                      Holiday Name
                    </label>
                    <input
                      type="text"
                      value={newHolidayName}
                      onChange={(e) => setNewHolidayName(e.target.value)}
                      placeholder="e.g. Year-End Bank Holiday"
                      className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Public Holiday
                    </button>
                  </div>
                </form>

                <div className="divide-y divide-slate-200 text-xs font-mono">
                  {dataset.holidays.map((h) => (
                    <div
                      key={h.id}
                      className="py-2.5 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-slate-900 mr-3">
                          {formatDateUI(h.date)}
                        </span>
                        <span className="font-sans text-slate-700">
                          {h.name}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteHoliday(h.id)}
                        className="p-1 text-slate-500 hover:text-red-600"
                        title="Delete holiday"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Section 3: Add Brand + Process + Employee + Assignment */}
              <section className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="pb-3 mb-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    03. Onboard New Brand, Process &amp; Employee Assignment
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Create a new brand, configure its process calendar preset and minimum staffing, and assign an employee as PRIMARY or BACKUP.
                  </p>
                </div>

                <form
                  onSubmit={handleCreateBrandProcessEmployee}
                  className="grid grid-cols-1 md:grid-cols-4 gap-3"
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Brand ID
                    </label>
                    <input
                      type="text"
                      value={newBrandCode}
                      onChange={(e) => setNewBrandCode(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Brand Name
                    </label>
                    <input
                      type="text"
                      value={newBrandTitle}
                      onChange={(e) => setNewBrandTitle(e.target.value)}
                      className="text-xs border border-slate-300 rounded px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Process Name &amp; Min Staff
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newProcessName}
                        onChange={(e) => setNewProcessName(e.target.value)}
                        placeholder="CS"
                        className="text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 flex-1"
                      />
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={newProcessMinStaff}
                        onChange={(e) =>
                          setNewProcessMinStaff(Number(e.target.value))
                        }
                        title="Default minStaff"
                        className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 w-16"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Operating Calendar Preset
                    </label>
                    <select
                      value={newProcessPreset}
                      onChange={(e) => setNewProcessPreset(e.target.value)}
                      className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {Object.entries(CALENDAR_PRESETS).map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {newProcessPreset === 'CUSTOM' && (
                    <div className="md:col-span-4 p-3 bg-slate-50 border border-slate-200 rounded flex flex-wrap items-center justify-between gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-slate-600">
                          Open Days:
                        </span>
                        {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                          <button
                            key={wd}
                            type="button"
                            onClick={() => handleToggleCustomWeekday(wd)}
                            className={`px-2.5 py-1 text-xs font-mono rounded border ${
                              customOpenDays.includes(wd)
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-300'
                            }`}
                          >
                            {getWeekdayName(wd, true)}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={customOperatesOnHolidays}
                          onChange={(e) =>
                            setCustomOperatesOnHolidays(e.target.checked)
                          }
                        />
                        Operates on Public Holidays
                      </label>
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Employee ID
                    </label>
                    <input
                      type="text"
                      value={newEmpCode}
                      onChange={(e) => setNewEmpCode(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Employee Name
                    </label>
                    <input
                      type="text"
                      value={newEmpFullName}
                      onChange={(e) => setNewEmpFullName(e.target.value)}
                      className="text-xs border border-slate-300 rounded px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Pod &amp; Role
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={newEmpPodId}
                        onChange={(e) => setNewEmpPodId(e.target.value)}
                        className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white flex-1"
                      >
                        {dataset.pods.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newEmpRole}
                        onChange={(e) =>
                          setNewEmpRole(e.target.value as AssignmentRole)
                        }
                        className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white flex-1"
                      >
                        <option value="PRIMARY">PRIMARY</option>
                        <option value="BACKUP">BACKUP</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add &amp; Regenerate
                    </button>
                  </div>
                </form>

                {/* Link Existing Employee to Existing Process */}
                <div className="mt-5 pt-4 border-t border-slate-200">
                  <h3 className="text-xs font-bold text-slate-800 mb-2">
                    Manage Process Assignments ({dataset.assignments.length})
                  </h3>
                  <form
                    onSubmit={handleAddStandaloneAssignment}
                    className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3"
                  >
                    <select
                      value={linkEmpId}
                      onChange={(e) => setLinkEmpId(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {dataset.employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={linkProcId}
                      onChange={(e) => setLinkProcId(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {dataset.processes.map((proc) => (
                        <option key={proc.id} value={proc.id}>
                          {proc.id}
                        </option>
                      ))}
                    </select>
                    <select
                      value={linkRole}
                      onChange={(e) =>
                        setLinkRole(e.target.value as AssignmentRole)
                      }
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="PRIMARY">PRIMARY</option>
                      <option value="BACKUP">BACKUP</option>
                    </select>
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Save Assignment Link
                    </button>
                  </form>

                  <div className="max-h-44 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-200 text-xs font-mono">
                    {dataset.assignments.map((asgn) => {
                      const emp = dataset.employees.find(
                        (e) => e.id === asgn.employeeId
                      );
                      return (
                        <div
                          key={asgn.id}
                          className="py-1.5 px-3 flex items-center justify-between hover:bg-slate-50"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">
                              {asgn.processId}
                            </span>
                            <span className="mx-2 text-slate-400">·</span>
                            <span className="text-slate-700">
                              {emp?.name ?? asgn.employeeId}
                            </span>
                            <span className="ml-2 text-[10px] text-slate-500">
                              ({asgn.role})
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteAssignment(asgn.id)}
                            className="p-1 text-slate-400 hover:text-red-600"
                            title="Remove assignment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Section 4: Coverage Rules Override */}
              <section className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="pb-3 mb-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">
                    04. Weekday / Date Coverage Rule Overrides
                  </h2>
                </div>
                <form
                  onSubmit={handleAddCoverageRule}
                  className="grid grid-cols-1 md:grid-cols-4 gap-3 pb-4 mb-4 border-b border-slate-200"
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Process
                    </label>
                    <select
                      value={newRuleProcessId}
                      onChange={(e) => setNewRuleProcessId(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {dataset.processes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Weekday
                    </label>
                    <select
                      value={newRuleWeekday}
                      onChange={(e) => setNewRuleWeekday(e.target.value)}
                      className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                        <option key={wd} value={wd}>
                          {getWeekdayName(wd)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-slate-600">
                      Min Staff Required
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={newRuleMinStaff}
                      onChange={(e) =>
                        setNewRuleMinStaff(Number(e.target.value))
                      }
                      className="text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Save Coverage Rule
                    </button>
                  </div>
                </form>

                <div className="divide-y divide-slate-200 text-xs font-mono">
                  {dataset.coverageRules.map((r) => (
                    <div
                      key={r.id}
                      className="py-2 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-slate-900 mr-3">
                          {r.processId}
                        </span>
                        <span className="text-slate-600">
                          {r.date
                            ? `Date ${formatDateUI(r.date)}`
                            : `Every ${getWeekdayName(r.weekday ?? 0)}`}{' '}
                          → minStaff = {r.minStaff}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteCoverageRule(r.id)}
                        className="p-1 text-slate-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            /* Roster Schedule Matrix Grid with all days 01..31 and Sticky Employee Column */
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {rosterView === 'company' &&
                      `Company-Wide Roster Grid (All ${filteredEmployees.length} Employees)`}
                    {rosterView === 'pod' &&
                      `Pod-Wise Schedule — ${
                        selectedPodId === 'ALL'
                          ? 'All Pods Grouped by Pod Lead'
                          : selectedPodId
                      }`}
                    {rosterView === 'brand' &&
                      `Brand-Wise Schedule & Daily Coverage — ${
                        dataset.brands.find((b) => b.id === selectedBrandId)
                          ?.name
                      }`}
                    {rosterView === 'process' &&
                      `Process-Wise Schedule — ${selectedProcessId}`}
                    {rosterView === 'employee' &&
                      `Employee Monthly Calendar — ${activeEmployee.name}`}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click any cell to cycle status (WORK → WEEKLY_OFF → HOLIDAY → LEAVE → COMP_OFF), lock it as MANUAL, and revalidate immediately.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-slate-600">
                  <span>W = Work</span>
                  <span>·</span>
                  <span>OFF = Weekly Off</span>
                  <span>·</span>
                  <span>HOL = Holiday</span>
                  <span>·</span>
                  <span>LV = Leave</span>
                  <span>·</span>
                  <span>CO = Comp-Off</span>
                </div>
              </div>

              <div className="w-full overflow-x-auto">
                <table className="min-w-max w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600">
                      <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 min-w-[220px] border-r border-slate-200">
                        Employee / Process
                      </th>
                      <th className="px-2 py-2 border-r border-slate-200 min-w-[56px] text-center">
                        Pod
                      </th>
                      {dates.map((d) => {
                        const dayNum = d.slice(8, 10);
                        const wd = getWeekday(d);
                        const wdShort = getWeekdayName(wd, true);
                        const isHol = isHolidayDate(d, dataset.holidays);
                        const isSun = wd === 0;
                        return (
                          <th
                            key={d}
                            className={`px-1 py-1.5 text-center min-w-[38px] border-r border-slate-200 tabular-nums ${
                              isHol
                                ? 'bg-indigo-50/70 text-indigo-900 font-bold'
                                : isSun
                                ? 'bg-slate-100 text-slate-700'
                                : ''
                            }`}
                            title={
                              isHol
                                ? `${formatDateUI(d)} (${wdShort}) - Public Holiday`
                                : `${formatDateUI(d)} (${wdShort})`
                            }
                          >
                            <div>{dayNum}</div>
                            <div className="text-[9px] text-slate-400">
                              {wdShort}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {/* Brand or Process Daily Coverage Rows */}
                    {(rosterView === 'brand' || rosterView === 'process') &&
                      dataset.processes
                        .filter((p) =>
                          rosterView === 'brand'
                            ? p.brandId === selectedBrandId
                            : p.id === selectedProcessId
                        )
                        .map((proc) => (
                          <tr
                            key={`cov-${proc.id}`}
                            className="bg-slate-50/90 font-mono text-[11px]"
                          >
                            <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 font-semibold text-slate-900 border-r border-slate-200">
                              Coverage: {proc.id} (Actual / Req)
                            </td>
                            <td className="px-2 py-2 text-center text-slate-500 border-r border-slate-200">
                              min {proc.minStaff}
                            </td>
                            {dates.map((d) => {
                              const req = requirements[proc.id]?.[d] ?? 0;
                              const actual =
                                getWorkingEmployeesForProcessOnDate(
                                  proc.id,
                                  d,
                                  dataset.employees,
                                  dataset.assignments,
                                  monthEntries,
                                  dataset.settings
                                ).length;
                              const isShort = req > 0 && actual < req;
                              return (
                                <td
                                  key={d}
                                  title={`${proc.id} on ${formatDateUI(d)}: ${actual} working / ${req} required`}
                                  className={`px-1 py-1.5 text-center border-r border-slate-200 tabular-nums ${
                                    req === 0
                                      ? 'text-slate-300'
                                      : isShort
                                      ? 'bg-red-100 text-red-800 font-bold'
                                      : 'bg-emerald-50/50 text-emerald-800 font-medium'
                                  }`}
                                >
                                  {req === 0 ? '—' : `${actual}/${req}`}
                                </td>
                              );
                            })}
                          </tr>
                        ))}

                    {/* Employee Schedule Rows */}
                    {filteredEmployees.map((emp) => {
                      const empBrands = Array.from(
                        new Set(
                          dataset.assignments
                            .filter((a) => a.employeeId === emp.id)
                            .map((a) => {
                              const proc = dataset.processes.find(
                                (p) => p.id === a.processId
                              );
                              return proc
                                ? `${proc.brandId}${a.role === 'BACKUP' ? '(B)' : ''}`
                                : '';
                            })
                            .filter(Boolean)
                        )
                      ).join(', ');

                      const compOffCredits = getEarnedCompOffHolidayDates(
                        emp.id,
                        dataset.processes,
                        dataset.assignments,
                        dataset.holidays,
                        monthEntries
                      );

                      return (
                        <tr
                          key={emp.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-slate-200">
                            <div className="font-medium text-slate-900 truncate max-w-[200px]">
                              {emp.name}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">
                              {emp.isPodLead
                                ? 'Pod Lead (Supervisory)'
                                : empBrands || 'Unassigned'}
                              {compOffCredits.length > 0 &&
                                ` · +${compOffCredits.length} CO (${compOffCredits
                                  .map((cd) => formatDateUI(cd))
                                  .join(', ')})`}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center font-mono text-[11px] text-slate-600 border-r border-slate-200">
                            {emp.podId}
                          </td>
                          {dates.map((d) => {
                            const entry = entryLookup.get(`${emp.id}:${d}`);
                            const status: DayStatus = entry?.status ?? 'WORK';
                            const isHighlighted =
                              highlightedCell &&
                              highlightedCell.date === d &&
                              (highlightedCell.employeeId === emp.id ||
                                !highlightedCell.employeeId);

                            return (
                              <td
                                key={d}
                                onClick={() => handleCycleCellStatus(emp.id, d)}
                                className={`p-0.5 text-center border-r border-slate-200 cursor-pointer select-none min-w-[38px] ${
                                  isHighlighted
                                    ? 'ring-2 ring-slate-900 z-10'
                                    : ''
                                }`}
                                title={`${emp.name} on ${formatDateUI(d)}: ${status}${
                                  entry?.locked ? ' (LOCKED)' : ''
                                }`}
                              >
                                <div
                                  className={`w-full py-1 rounded text-[10px] font-mono font-medium border ${
                                    STATUS_BADGE_CLASSES[status]
                                  } ${
                                    entry?.locked
                                      ? 'underline decoration-dotted'
                                      : ''
                                  }`}
                                >
                                  {STATUS_SHORT_LABEL[status]}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Validator Issues & Simulated Fixes */}
        <aside className="xl:col-span-3 flex flex-col gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Validator Issues ({groupedDisplayIssues.length})
              </h3>
              <span className="text-xs font-mono text-slate-500">
                {errors.length} ERR · {warnings.length} WARN
              </span>
            </div>

            {/* Collapsible Green "Issues Solved (N)" Dropdown */}
            {resolvedIssues.length > 0 && (
              <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50/70 overflow-hidden">
                <button
                  onClick={() => setSolvedDropdownOpen((prev) => !prev)}
                  className="w-full px-3 py-2 flex items-center justify-between text-left text-xs font-mono font-semibold text-emerald-900 hover:bg-emerald-100/70 transition-colors"
                >
                  <span>✅ Issues Solved ({resolvedIssues.length})</span>
                  {solvedDropdownOpen ? (
                    <ChevronUp className="w-4 h-4 text-emerald-800 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-emerald-800 shrink-0" />
                  )}
                </button>
                {solvedDropdownOpen && (
                  <div className="px-3 pb-2.5 pt-1 border-t border-emerald-200 divide-y divide-emerald-200 max-h-48 overflow-y-auto">
                    {resolvedIssues.map((item) => (
                      <div key={item.id} className="py-2 text-[11px]">
                        <div className="font-mono font-semibold text-emerald-950">
                          {item.code}
                          {item.processId ? ` · ${item.processId}` : ''}
                          {item.date ? ` · ${formatDateUI(item.date)}` : ''}
                        </div>
                        <div className="text-slate-500 line-through mt-0.5">
                          {item.originalMessage}
                        </div>
                        <div className="text-emerald-800 font-medium mt-0.5">
                          Fix: {item.appliedFixTitle}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {groupedDisplayIssues.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
                Zero conflicts or preference warnings detected.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                {groupedDisplayIssues.map((item) => (
                  <button
                    key={item.key}
                    onClick={() =>
                      setHighlightedCell({
                        employeeId: item.employeeId,
                        processId: item.processId,
                        date: item.date,
                      })
                    }
                    className={`text-left p-2.5 rounded border transition-colors ${
                      item.severity === 'ERROR'
                        ? 'bg-red-50/70 border-red-200 hover:bg-red-50'
                        : 'bg-amber-50/60 border-amber-200 hover:bg-amber-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono font-semibold">
                      <span
                        className={
                          item.severity === 'ERROR'
                            ? 'text-red-800'
                            : 'text-amber-800'
                        }
                      >
                        {item.severity} · {item.code}
                      </span>
                      {item.groupedDates && item.groupedDates.length > 1 ? (
                        <span className="text-amber-700">
                          {item.groupedDates.length} dates
                        </span>
                      ) : (
                        item.date && (
                          <span className="text-slate-500">
                            {formatDateUI(item.date)}
                          </span>
                        )
                      )}
                    </div>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      {item.message}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Simulated Fixes Panel */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Simulated Fixes ({suggestions.length})
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                0-Error Verified
              </span>
            </div>

            {suggestions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 leading-relaxed">
                No active coverage gaps requiring fixes.
              </p>
            ) : (
              <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1">
                {suggestions.map((sug) => (
                  <div
                    key={sug.id}
                    className="p-3 rounded border border-slate-200 bg-slate-50/60 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {sug.type} · {formatDateUI(sug.date)}
                      </span>
                      <span>
                        {sug.compOffsCreated} CO ·{' '}
                        {sug.samePod ? 'Same Pod' : 'Cross Pod'}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900">
                      {formatTextDatesUI(sug.title)}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {formatTextDatesUI(sug.description)}
                    </p>
                    {sug.simulatedEntries && (
                      <button
                        onClick={() => handleApplySuggestion(sug)}
                        className="mt-1 self-start px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded transition-colors flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Apply Validated Fix
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
