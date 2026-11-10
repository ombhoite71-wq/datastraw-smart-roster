/**
 * Smart Roster Management System - Deterministic Seed Data & LocalStorage Store
 * Strictly follows PROJECT_SPEC.md Section 2 (Fallback) and Section 10.
 *
 * Demographic Name Ratio (Indian Names):
 * - Total People: 36 (32 operational E01-E32 + 4 pod leads L1-L4)
 * - Operational E01-E30 (30 brand owners): 24 Majority (80.0%) + 6 Minority (20.0%)
 * - Full Roster (36 total): 29 Majority (80.6%) + 7 Minority (19.4%)
 *   Minority representation includes Muslim (Zoya Khan, Farhan Shaikh),
 *   Sikh (Gurpreet Kaur, Harpreet Singh), Christian (Roshan Mathew, Rebecca D'Souza),
 *   and Parsi (Darius Irani) names.
 */

import { generateRoster } from './engine/generate';
import {
  Assignment,
  Brand,
  CoverageRule,
  Employee,
  Holiday,
  Leave,
  Pod,
  Process,
  Roster,
  RosterDataset,
  Setting,
} from './engine/types';

export const STORAGE_KEY = 'smart_roster_dataset_v1';
export const DEFAULT_DEMO_MONTH = '2026-12';

export const DEFAULT_SETTINGS: Setting = {
  maxConsecutiveWorkDays: 6,
  holidayCountsAsWeeklyOff: true,
  partialWeekMinDays: 4,
  podLeadsCountForCoverage: false,
};

export const SEED_PODS: Pod[] = [
  { id: 'P1', name: 'Pod Alpha (North)', leadEmployeeId: 'L1' },
  { id: 'P2', name: 'Pod Beta (West)', leadEmployeeId: 'L2' },
  { id: 'P3', name: 'Pod Gamma (South)', leadEmployeeId: 'L3' },
  { id: 'P4', name: 'Pod Delta (East)', leadEmployeeId: 'L4' },
];

export const SEED_EMPLOYEES: Employee[] = [
  // =========================================================================
  // Operational Employees: E01 - E32 (32 employees)
  // =========================================================================
  // S01-S12 Owners (E01-E11): Mon-Sat brands (Sundays + holidays off)
  {
    id: 'E01',
    name: 'E01 - Aarav Mehta', // Majority (1)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [0],
    fixedOffDay: 0, // Hard fixed Sunday off example
  },
  {
    id: 'E02',
    name: 'E02 - Vivaan Sharma', // Majority (2)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E03',
    name: 'E03 - Aditya Verma', // Majority (3)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E04',
    name: 'E04 - Diya Nair', // Majority (4)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E05',
    name: 'E05 - Zoya Khan', // Minority (1 - Muslim) | Multi-brand owner (S05 & S06)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E06',
    name: 'E06 - Ananya Iyer', // Majority (5)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E07',
    name: 'E07 - Vikram Joshi', // Majority (6)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E08',
    name: 'E08 - Kavya Reddy', // Majority (7)
    podId: 'P1',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E09',
    name: 'E09 - Siddharth Deshmukh', // Majority (8)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E10',
    name: 'E10 - Gurpreet Kaur', // Minority (2 - Sikh)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E11',
    name: 'E11 - Nikhil Tiwari', // Majority (9)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // S13-S16 Owners (E12-E15): Daily except holidays (backed up by E31 / E32)
  {
    id: 'E12',
    name: 'E12 - Sneha Menon', // Majority (10)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [2], // Soft preference: Tuesday
    fixedOffDay: null,
  },
  {
    id: 'E13',
    name: 'E13 - Arjun Rao', // Majority (11)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E14',
    name: 'E14 - Meera Sundaram', // Majority (12)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [2], // Soft preference: Tuesday
    fixedOffDay: null,
  },
  {
    id: 'E15',
    name: 'E15 - Roshan Mathew', // Minority (3 - Christian)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // S17-S20 Owners (E16-E18): 365 days (backed up by E31 / E32)
  {
    id: 'E16',
    name: 'E16 - Nisha Bansal', // Majority (13)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [3],
    fixedOffDay: 3, // Hard fixed Wednesday off example
  },
  {
    id: 'E17',
    name: 'E17 - Pranav Mishra', // Majority (14)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E18',
    name: 'E18 - Tanvi Gokhale', // Majority (15) | Multi-brand owner (S19 & S20)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // M1 UrbanNest (E19-E21): Daily except holidays
  {
    id: 'E19',
    name: 'E19 - Harshvardhan Chauhan', // Majority (16)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E20',
    name: 'E20 - Farhan Shaikh', // Minority (4 - Muslim)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E21',
    name: 'E21 - Gaurav Saxena', // Majority (17)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // M2 Glowbar (E22-E24): 365 days (CS shared E22+E23 min 2 Fri-Sun; ACC E24 Mon-Sat override)
  {
    id: 'E22',
    name: 'E22 - Shreya Sengupta', // Majority (18)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [1], // Soft preference: Monday
    fixedOffDay: null,
  },
  {
    id: 'E23',
    name: 'E23 - Manish Pandey', // Majority (19)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [6], // Soft preference: Saturday (clashes with Fri-Sun min 2 -> WARNING)
    fixedOffDay: null,
  },
  {
    id: 'E24',
    name: 'E24 - Nandini Pillai', // Majority (20)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // M3 FitFuel (E25-E26): Sundays + holidays off
  {
    id: 'E25',
    name: "E25 - Rebecca D'Souza", // Minority (5 - Christian)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E26',
    name: 'E26 - Kunal Bhardwaj', // Majority (21)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // M4 KidoKart (E27 in P3, E28 in P4 -> spans 2 pods per Section 10)
  {
    id: 'E27',
    name: 'E27 - Ritika Chawla', // Majority (22)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E28',
    name: 'E28 - Varun Триpathy'.replace('Триpathy', 'Tripathy'), // Majority (23)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // M5 Zenwear (E29-E30): 365 days CS shared, NDR Mon-Sat
  {
    id: 'E29',
    name: 'E29 - Harpreet Singh', // Minority (6 - Sikh)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E30',
    name: 'E30 - Pallavi Kulkarni', // Majority (24)
    podId: 'P4',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // Floaters (E31 & E32 - BACKUP role across S13-S20)
  {
    id: 'E31',
    name: 'E31 - Devika Hegde', // Majority (25) | Floater 1 (backs up S13, S14, S17, S19)
    podId: 'P2',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },
  {
    id: 'E32',
    name: 'E32 - Akash Malhotra', // Majority (26) | Floater 2 (backs up S15, S16, S18, S20)
    podId: 'P3',
    isPodLead: false,
    active: true,
    preferredOffDays: [],
    fixedOffDay: null,
  },

  // =========================================================================
  // Pod Leads: L1 - L4 (4 pod leads, supervise & do not count toward coverage)
  // =========================================================================
  {
    id: 'L1',
    name: 'L1 - Rajeshwari Natarajan', // Majority (27)
    podId: 'P1',
    isPodLead: true,
    active: true,
    preferredOffDays: [0],
    fixedOffDay: null,
  },
  {
    id: 'L2',
    name: 'L2 - Saurabh Bhatia', // Majority (28)
    podId: 'P2',
    isPodLead: true,
    active: true,
    preferredOffDays: [0],
    fixedOffDay: null,
  },
  {
    id: 'L3',
    name: 'L3 - Darius Irani', // Minority (7 - Parsi)
    podId: 'P3',
    isPodLead: true,
    active: true,
    preferredOffDays: [0],
    fixedOffDay: null,
  },
  {
    id: 'L4',
    name: 'L4 - Priyamvada Dixit', // Majority (29)
    podId: 'P4',
    isPodLead: true,
    active: true,
    preferredOffDays: [0],
    fixedOffDay: null,
  },
];

// ===========================================================================
// 25 Brands: 20 Single-Resource (S01-S20) + 5 Multi-Employee (M1-M5)
// ===========================================================================
export const SEED_BRANDS: Brand[] = [
  // S01-S12: Sundays + holidays off (Mon-Sat)
  { id: 'S01', name: 'S01 - ChaiCraft' },
  { id: 'S02', name: 'S02 - VedaBotanics' },
  { id: 'S03', name: 'S03 - LoomKala' },
  { id: 'S04', name: 'S04 - SpiceRoute' },
  { id: 'S05', name: 'S05 - KhadiAura' },
  { id: 'S06', name: 'S06 - MittiHome' },
  { id: 'S07', name: 'S07 - DesiGrains' },
  { id: 'S08', name: 'S08 - NariSilk' },
  { id: 'S09', name: 'S09 - AyurPulse' },
  { id: 'S10', name: 'S10 -KaveriCoffee'.replace('-K', '- K') },
  { id: 'S11', name: 'S11 - Bamboozle' },
  { id: 'S12', name: 'S12 - ZariVault' },

  // S13-S16: Daily except holidays
  { id: 'S13', name: 'S13 - PranaSnacks' },
  { id: 'S14', name: 'S14 - SuryaGlow' },
  { id: 'S15', name: 'S15 - IndusSole' },
  { id: 'S16', name: 'S16 - PahadiRoots' },

  // S17-S20: 365 days
  { id: 'S17', name: 'S17 - DeccanBrew' },
  { id: 'S18', name: 'S18 - RasaRituals' },
  { id: 'S19', name: 'S19 - TaraJewels' },
  { id: 'S20', name: 'S20 - MokshaCare' },

  // M1-M5: Multi-employee brands
  { id: 'M1', name: 'M1 UrbanNest' },
  { id: 'M2', name: 'M2 Glowbar' },
  { id: 'M3', name: 'M3 FitFuel' },
  { id: 'M4', name: 'M4 KidoKart' },
  { id: 'M5', name: 'M5 Zenwear' },
];

const MON_SAT = [1, 2, 3, 4, 5, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Helper to create 2-3 processes (CS, ACC, and NDR or RETENTION) for each single-resource brand.
 */
function buildSingleBrandProcesses(): Process[] {
  const list: Process[] = [];

  const singleBrandConfigs: Array<{
    brandId: string;
    openDays: number[];
    operatesOnHolidays: boolean;
    processNames: string[];
  }> = [
    // S01-S12: Sundays + holidays off (Mon-Sat)
    { brandId: 'S01', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC', 'NDR'] },
    { brandId: 'S02', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S03', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'NDR'] },
    { brandId: 'S04', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'RETENTION'] },
    { brandId: 'S05', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S06', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'NDR'] },
    { brandId: 'S07', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC', 'RETENTION'] },
    { brandId: 'S08', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S09', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'NDR'] },
    { brandId: 'S10', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'RETENTION'] },
    { brandId: 'S11', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S12', openDays: MON_SAT, operatesOnHolidays: false, processNames: ['CS', 'NDR'] },

    // S13-S16: Daily except holidays
    { brandId: 'S13', openDays: ALL_DAYS, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S14', openDays: ALL_DAYS, operatesOnHolidays: false, processNames: ['CS', 'NDR'] },
    { brandId: 'S15', openDays: ALL_DAYS, operatesOnHolidays: false, processNames: ['CS', 'ACC'] },
    { brandId: 'S16', openDays: ALL_DAYS, operatesOnHolidays: false, processNames: ['CS', 'RETENTION'] },

    // S17-S20: 365 days
    { brandId: 'S17', openDays: ALL_DAYS, operatesOnHolidays: true, processNames: ['CS', 'ACC'] },
    { brandId: 'S18', openDays: ALL_DAYS, operatesOnHolidays: true, processNames: ['CS', 'NDR'] },
    { brandId: 'S19', openDays: ALL_DAYS, operatesOnHolidays: true, processNames: ['CS', 'ACC'] },
    { brandId: 'S20', openDays: ALL_DAYS, operatesOnHolidays: true, processNames: ['CS', 'RETENTION'] },
  ];

  for (const cfg of singleBrandConfigs) {
    for (const pName of cfg.processNames) {
      list.push({
        id: `${cfg.brandId}-${pName}`,
        brandId: cfg.brandId,
        name: pName,
        openDays: [...cfg.openDays],
        operatesOnHolidays: cfg.operatesOnHolidays,
        minStaff: 1,
      });
    }
  }

  return list;
}

export const SEED_PROCESSES: Process[] = [
  ...buildSingleBrandProcesses(),

  // M1 UrbanNest: Daily except holidays (CS, ACC, NDR)
  {
    id: 'M1-CS',
    brandId: 'M1',
    name: 'CS',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: false,
    minStaff: 1,
  },
  {
    id: 'M1-ACC',
    brandId: 'M1',
    name: 'ACC',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: false,
    minStaff: 1,
  },
  {
    id: 'M1-NDR',
    brandId: 'M1',
    name: 'NDR',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: false,
    minStaff: 1,
  },

  // M2 Glowbar: CS is 365 days (min 2 on Fri-Sun via CoverageRule);
  // ACC has process-level calendar override: Mon-Sat only
  {
    id: 'M2-CS',
    brandId: 'M2',
    name: 'CS',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: true,
    minStaff: 1,
  },
  {
    id: 'M2-ACC',
    brandId: 'M2',
    name: 'ACC',
    openDays: [...MON_SAT],
    operatesOnHolidays: false,
    minStaff: 1,
  },

  // M3 FitFuel: Sundays + holidays off (CS, RETENTION)
  {
    id: 'M3-CS',
    brandId: 'M3',
    name: 'CS',
    openDays: [...MON_SAT],
    operatesOnHolidays: false,
    minStaff: 1,
  },
  {
    id: 'M3-RETENTION',
    brandId: 'M3',
    name: 'RETENTION',
    openDays: [...MON_SAT],
    operatesOnHolidays: false,
    minStaff: 1,
  },

  // M4 KidoKart: Daily except holidays (CS shared, NDR overlapping)
  {
    id: 'M4-CS',
    brandId: 'M4',
    name: 'CS',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: false,
    minStaff: 1,
  },
  {
    id: 'M4-NDR',
    brandId: 'M4',
    name: 'NDR',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: false,
    minStaff: 1,
  },

  // M5 Zenwear: CS 365 days; NDR Mon-Sat only
  {
    id: 'M5-CS',
    brandId: 'M5',
    name: 'CS',
    openDays: [...ALL_DAYS],
    operatesOnHolidays: true,
    minStaff: 1,
  },
  {
    id: 'M5-NDR',
    brandId: 'M5',
    name: 'NDR',
    openDays: [...MON_SAT],
    operatesOnHolidays: false,
    minStaff: 1,
  },
];

function buildSeedAssignments(processes: Process[]): Assignment[] {
  const assignments: Assignment[] = [];
  const addForBrand = (
    brandId: string,
    employeeId: string,
    role: 'PRIMARY' | 'BACKUP'
  ) => {
    const brandProcs = processes.filter((p) => p.brandId === brandId);
    for (const proc of brandProcs) {
      assignments.push({
        id: `asgn-${proc.id}-${employeeId}`,
        employeeId,
        processId: proc.id,
        role,
      });
    }
  };

  // S01-S12 Primary Owners (E01-E11; E05 owns S05 & S06)
  addForBrand('S01', 'E01', 'PRIMARY');
  addForBrand('S02', 'E02', 'PRIMARY');
  addForBrand('S03', 'E03', 'PRIMARY');
  addForBrand('S04', 'E04', 'PRIMARY');
  addForBrand('S05', 'E05', 'PRIMARY');
  addForBrand('S06', 'E05', 'PRIMARY');
  addForBrand('S07', 'E06', 'PRIMARY');
  addForBrand('S08', 'E07', 'PRIMARY');
  addForBrand('S09', 'E08', 'PRIMARY');
  addForBrand('S10', 'E09', 'PRIMARY');
  addForBrand('S11', 'E10', 'PRIMARY');
  addForBrand('S12', 'E11', 'PRIMARY');

  // S13-S16 Primary Owners (E12-E15)
  addForBrand('S13', 'E12', 'PRIMARY');
  addForBrand('S14', 'E13', 'PRIMARY');
  addForBrand('S15', 'E14', 'PRIMARY');
  addForBrand('S16', 'E15', 'PRIMARY');

  // S17-S20 Primary Owners (E16-E18; E18 owns S19 & S20)
  addForBrand('S17', 'E16', 'PRIMARY');
  addForBrand('S18', 'E17', 'PRIMARY');
  addForBrand('S19', 'E18', 'PRIMARY');
  addForBrand('S20', 'E18', 'PRIMARY');

  // Floaters (BACKUP role):
  // E31 backs up S13, S14, S17, S19
  addForBrand('S13', 'E31', 'BACKUP');
  addForBrand('S14', 'E31', 'BACKUP');
  addForBrand('S17', 'E31', 'BACKUP');
  addForBrand('S19', 'E31', 'BACKUP');

  // E32 backs up S15, S16, S18, S20
  addForBrand('S15', 'E32', 'BACKUP');
  addForBrand('S16', 'E32', 'BACKUP');
  addForBrand('S18', 'E32', 'BACKUP');
  addForBrand('S20', 'E32', 'BACKUP');

  // M1 UrbanNest: CS: E19, ACC: E20, NDR: E21 (with internal brand cross-backup for weekly offs)
  assignments.push(
    { id: 'asgn-M1-CS-E19', employeeId: 'E19', processId: 'M1-CS', role: 'PRIMARY' },
    { id: 'asgn-M1-CS-E20', employeeId: 'E20', processId: 'M1-CS', role: 'BACKUP' },
    { id: 'asgn-M1-ACC-E20', employeeId: 'E20', processId: 'M1-ACC', role: 'PRIMARY' },
    { id: 'asgn-M1-ACC-E21', employeeId: 'E21', processId: 'M1-ACC', role: 'BACKUP' },
    { id: 'asgn-M1-NDR-E21', employeeId: 'E21', processId: 'M1-NDR', role: 'PRIMARY' },
    { id: 'asgn-M1-NDR-E19', employeeId: 'E19', processId: 'M1-NDR', role: 'BACKUP' }
  );

  // M2 Glowbar: CS: E22 + E23 shared; ACC: E24 (Mon-Sat override)
  assignments.push(
    { id: 'asgn-M2-CS-E22', employeeId: 'E22', processId: 'M2-CS', role: 'PRIMARY' },
    { id: 'asgn-M2-CS-E23', employeeId: 'E23', processId: 'M2-CS', role: 'PRIMARY' },
    { id: 'asgn-M2-ACC-E24', employeeId: 'E24', processId: 'M2-ACC', role: 'PRIMARY' }
  );

  // M3 FitFuel: CS: E25, RETENTION: E26
  assignments.push(
    { id: 'asgn-M3-CS-E25', employeeId: 'E25', processId: 'M3-CS', role: 'PRIMARY' },
    { id: 'asgn-M3-RETENTION-E26', employeeId: 'E26', processId: 'M3-RETENTION', role: 'PRIMARY' }
  );

  // M4 KidoKart: CS: E27 + E28 shared; NDR: E28 (overlapping assignment, E27 backup)
  assignments.push(
    { id: 'asgn-M4-CS-E27', employeeId: 'E27', processId: 'M4-CS', role: 'PRIMARY' },
    { id: 'asgn-M4-CS-E28', employeeId: 'E28', processId: 'M4-CS', role: 'PRIMARY' },
    { id: 'asgn-M4-NDR-E28', employeeId: 'E28', processId: 'M4-NDR', role: 'PRIMARY' },
    { id: 'asgn-M4-NDR-E27', employeeId: 'E27', processId: 'M4-NDR', role: 'BACKUP' }
  );

  // M5 Zenwear: CS: E29 + E30 shared; NDR: E30 (Mon-Sat only)
  assignments.push(
    { id: 'asgn-M5-CS-E29', employeeId: 'E29', processId: 'M5-CS', role: 'PRIMARY' },
    { id: 'asgn-M5-CS-E30', employeeId: 'E30', processId: 'M5-CS', role: 'PRIMARY' },
    { id: 'asgn-M5-NDR-E30', employeeId: 'E30', processId: 'M5-NDR', role: 'PRIMARY' }
  );

  return assignments;
}

export const SEED_ASSIGNMENTS: Assignment[] =
  buildSeedAssignments(SEED_PROCESSES);

// M2 Glowbar CS: min 2 on Fri (5), Sat (6), Sun (0)
export const SEED_COVERAGE_RULES: CoverageRule[] = [
  {
    id: 'rule-M2-CS-fri',
    processId: 'M2-CS',
    weekday: 5, // Friday
    date: null,
    minStaff: 2,
  },
  {
    id: 'rule-M2-CS-sat',
    processId: 'M2-CS',
    weekday: 6, // Saturday
    date: null,
    minStaff: 2,
  },
  {
    id: 'rule-M2-CS-sun',
    processId: 'M2-CS',
    weekday: 0, // Sunday
    date: null,
    minStaff: 2,
  },
];

// Holidays for December 2026: Dec 15 Founders' Day (sample) & Dec 25 Christmas
export const SEED_HOLIDAYS: Holiday[] = [
  {
    id: 'hol-2026-12-15',
    date: '2026-12-15',
    name: "Founders' Day (sample)",
  },
  {
    id: 'hol-2026-12-25',
    date: '2026-12-25',
    name: 'Christmas',
  },
];

// 1 APPROVED leave (blocks availability) & 1 PENDING leave (ignored until approved)
export const SEED_LEAVES: Leave[] = [
  {
    id: 'leave-approved-1',
    employeeId: 'E22',
    startDate: '2026-12-09',
    endDate: '2026-12-09',
    type: 'LEAVE',
    status: 'APPROVED',
    reason: 'Planned personal day (covered by shared Glowbar CS teammate E23)',
  },
  {
    id: 'leave-pending-1',
    employeeId: 'E02',
    startDate: '2026-12-08',
    endDate: '2026-12-08',
    type: 'LEAVE',
    status: 'PENDING',
    reason: 'Pending request on Tuesday Dec 8 (ignored until approved; approving triggers S7 gap)',
  },
];

export const SEED_ROSTERS: Roster[] = [
  {
    id: 'roster-2026-12',
    month: '2026-12',
    status: 'DRAFT',
  },
];

/**
 * Builds a fresh, deterministic deep copy of the baseline dataset with
 * pre-generated December 2026 roster entries.
 */
export function createSeedDataset(): RosterDataset {
  const pods = SEED_PODS.map((p) => ({ ...p }));
  const employees = SEED_EMPLOYEES.map((e) => ({
    ...e,
    preferredOffDays: [...e.preferredOffDays],
  }));
  const brands = SEED_BRANDS.map((b) => ({ ...b }));
  const processes = SEED_PROCESSES.map((p) => ({
    ...p,
    openDays: [...p.openDays],
  }));
  const assignments = SEED_ASSIGNMENTS.map((a) => ({ ...a }));
  const coverageRules = SEED_COVERAGE_RULES.map((r) => ({ ...r }));
  const holidays = SEED_HOLIDAYS.map((h) => ({ ...h }));
  const leaves = SEED_LEAVES.map((l) => ({ ...l }));
  const rosters = SEED_ROSTERS.map((r) => ({ ...r }));
  const settings: Setting = { ...DEFAULT_SETTINGS };

  const generated = generateRoster({
    month: DEFAULT_DEMO_MONTH,
    rosterId: 'roster-2026-12',
    pods,
    brands,
    employees,
    processes,
    assignments,
    coverageRules,
    holidays,
    leaves,
    settings,
    entries: [],
  });

  return {
    pods,
    employees,
    brands,
    processes,
    assignments,
    coverageRules,
    holidays,
    leaves,
    rosters,
    entries: generated.entries,
    settings,
  };
}

/**
 * Loads dataset from browser localStorage, seeding deterministically if not present.
 */
export function loadDatasetFromStorage(): RosterDataset {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createSeedDataset();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = createSeedDataset();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw) as RosterDataset;
  } catch {
    return createSeedDataset();
  }
}

/**
 * Persists dataset to browser localStorage.
 */
export function saveDatasetToStorage(dataset: RosterDataset): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
}

/**
 * Resets browser localStorage to the deterministic baseline seed data.
 */
export function resetDemoData(): RosterDataset {
  const fresh = createSeedDataset();
  saveDatasetToStorage(fresh);
  return fresh;
}
