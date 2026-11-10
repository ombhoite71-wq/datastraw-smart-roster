# Smart Roster Management System

A deterministic, browser-based operations roster scheduling, conflict detection, and change-management system built for multi-brand D2C operations teams (`Customer Support`, `Abandoned Cart Conversions`, `NDR`, `Retention`).

---

## Setup & Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server (runs on port `3000`):
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```

---

## Architecture & Pure Scheduling Engine (`src/lib/engine/`)

- **`src/lib/engine/types.ts`**: Plain TypeScript interfaces (`Pod`, `Employee`, `Brand`, `Process`, `Assignment`, `CoverageRule`, `Holiday`, `Leave`, `Roster`, `RosterEntry`, `Setting`, `Issue`, `Suggestion`).
- **`src/lib/engine/calendar.ts`**: Pure UTC calendar helpers, Monday–Sunday clipped week window builders, `isProcessOpen`, `requiredStaff`, and availability checks.
- **`src/lib/engine/requirements.ts`**: Builds the `req[processId][date]` staffing matrix, resolves active assignees, and computes earned holiday comp-off credits.
- **`src/lib/engine/validate.ts`**: Single source of truth (`validateRoster`) implementing all 7 `ERROR` codes (`COVERAGE_GAP`, `NO_ASSIGNED_EMPLOYEE`, `INSUFFICIENT_HEADCOUNT`, `MISSING_WEEKLY_OFF`, `MAX_CONSECUTIVE_DAYS`, `LEAVE_CONFLICT`, `FIXED_OFF_VIOLATED`) and 2 `WARNING` codes (`OVERLOAD`, `PREFERENCE_VIOLATED`).
- **`src/lib/engine/generate.ts`**: Deterministic 7-step generator (`generateRoster`) with tightness ordering, candidate scoring, mandatory welfare weekly-off placement, and a 3-iteration zero-violation repair pass.
- **`src/lib/engine/suggest.ts`**: Simulate-before-suggest engine (`suggestFixes`) evaluating off-day swaps, same-pod/floater call-ins, and explicit manager minimum waivers against a copy of the roster, returning only fixes that introduce `0` new `ERROR`s.

---

## Answers to the 8 Assessment Questions ("Tell Us How You Think")

### 1. How did you model employees, brands, processes, pods and their relationships?
- **Pod (`1:N` Employee, `1:1` Lead):** Each `Employee` belongs to one `Pod` (`podId`), and each `Pod` designates a supervisory lead (`leadEmployeeId`, `isPodLead = true`) who does not count toward process coverage by default.
- **Brand (`1:N` Process):** A `Brand` is a logical container for one or more operational `Process` entities (`CS`, `ACC`, `NDR`, `RETENTION`). Operating calendars (`openDays`, `operatesOnHolidays`, `minStaff`, and `CoverageRule` overrides) live on `Process` rather than `Brand` so processes within the same brand can follow different schedules (e.g., `M2 Glowbar CS` open 365 days with Fri–Sun `minStaff = 2`, while `M2 Glowbar ACC` operates Mon–Sat only).
- **Employee (`N:M` Process via `Assignment`):** Many-to-many `Assignment` records (`role: PRIMARY | BACKUP`) allow a single employee to own multiple processes for one brand, own multiple brands (`E05`, `E18`), share a high-volume process (`E22 + E23`), or act as a cross-brand backup floater (`E31`, `E32`).

### 2. How does your system generate a roster and decide whether it satisfies the constraints?
- **Generation (`generateRoster`):**
  1. Builds the month's dates and `req[processId][date]` matrix.
  2. Prefills locked `APPROVED` leaves/comp-offs, preserves locked manual cells, marks days where all of an employee's processes are closed as `HOLIDAY` or `WEEKLY_OFF`, and marks remaining days `WORK`.
  3. Sorts active employees deterministically by tightness: sole process assignees first, then multi-brand primary owners, then floaters and shared staff, tie-breaking by ID.
  4. For each employee-week requiring an off day, scores every eligible day using `hardViolations * 1000 + preferenceViolation * 10 + fairnessPenalty + spacingPenalty + coAssigneeTightnessPenalty` and places the lowest-scoring `WEEKLY_OFF`.
  5. Runs up to 3 repair iterations to shift unlocked `AUTO` weekly offs within their week when doing so resolves a coverage gap or streak violation with zero new violations.
- **Validation (`validateRoster`):** Acts as the single source of truth called after generation, after every manual cell click, and after every data change.

### 3. How did you handle single-resource brands versus brands with multiple employees?
- Both are handled uniformly by the same data model and scoring rules without special-casing brand IDs:
  - **Single-resource Mon–Sat brands (`S01`–`S12`):** All processes are closed on Sundays and public holidays, so Step 2 prefill naturally assigns `WEEKLY_OFF` on Sundays and `HOLIDAY` on public holidays with zero coverage gaps.
  - **Single-resource 7-day / 365-day brands (`S13`–`S20`):** Primary owners (`E12`–`E18`) are paired with `BACKUP` floaters (`E31`, `E32`). Tightness ordering and co-assignee spacing stagger the primary owners' weekday offs across Monday–Thursday so the floater covers at most 1–2 brands per day and takes their own weekly off on Friday–Sunday when primary owners work.
  - **Multi-employee brands (`M1`–`M5`):** Shared assignees (`M2-CS`, `M4-CS`, `M5-CS`) and cross-trained brand teammates (`M1`) automatically stagger their off days on days where `working - 1 >= requiredStaff`.

### 4. What happens when an employee managing all processes for a brand is unavailable on a required working day?
- When an `APPROVED` leave is recorded (e.g., `E02` on Tuesday `08/12/2026` for `S02 - VedaBotanics`), that employee's cell is locked as `LEAVE`.
- `validateRoster` immediately flags a `COVERAGE_GAP` (`ERROR`) on each affected process of that brand with the exact cause (`"E02 - Vivaan Sharma on approved leave"`).
- `suggestFixes` simulates candidate fixes on a copy of the roster (calling in a same-pod employee or backup floater who is off that day, or an explicit manager waiver of minimum staffing) and presents only verified 0-error options with one-click **Apply Validated Fix**.

### 5. How does your system handle conflicting requirements or insufficient staffing?
- **Never hides conflicts:** Welfare rules (weekly off) and approved leaves are never silently dropped to make coverage look green. If placing a mandatory weekly off causes a shortage (e.g., when removing floater `E31` from 365-day brand `S17`), the generator still places the weekly off and lets `validateRoster` surface the `COVERAGE_GAP` `ERROR`.
- **Structural vs. Date-Specific Distinction:** The validator separates structural configuration errors (`NO_ASSIGNED_EMPLOYEE` when `assigned === 0`, `INSUFFICIENT_HEADCOUNT` when `minStaff > assigned`) from date-specific operational shortages (`COVERAGE_GAP`).
- **Mandatory vs. Soft Preferences:** Hard coverage beats soft `preferredOffDays` (`E23` works Saturday on `M2-CS` to satisfy `minStaff = 2`, raising a yellow `PREFERENCE_VIOLATED` `WARNING` rather than an `ERROR`).

### 6. Which parts did you automate, and which did you leave under human control, and why?
- **Automated:** Monthly prefill, tightness-ordered weekly-off placement, multi-iteration gap/streak repair, instant revalidation on every edit, and pre-simulated candidate fix ranking.
- **Human Control:** Approving pending leaves, applying suggested fixes (swap off, backup call-in earning a comp-off, or waiving minimum headcount for a date), locking manual cell overrides, and confirming roster publication when unresolved `ERROR`s exist. Operations managers own client SLA trade-offs and overtime/comp-off budgets, so the system simulates consequences and lets the manager decide.

### 7. If the company doubled its team and brand count, what would you change?
- **Persistence & Concurrency:** Move from single-browser storage to PostgreSQL with row-level optimistic locking on `RosterEntry` edits and audit logs for manual overrides.
- **Constraint Solver Option:** While our $O(E \times W \times D)$ greedy + 3-pass local repair runs in $< 15\text{ms}$ for 70+ employees and 50+ brands, scaling to hundreds of cross-assigned floaters with complex skill matrices would benefit from an MILP / CP-SAT solver pass behind a background worker queue.
- **Virtualized Grid:** Use row/column windowing for smooth rendering of 100+ employee rows across 31 columns.

### 8. With one more week, what would you improve first?
1. **Multi-Month Comp-Off Ledger:** Track earned holiday/call-in comp-off balances across months with expiration dates and one-click scheduling of accrued comp-offs.
2. **CSV / Excel Import & Export:** Bulk upload for monthly leave requests and downloadable brand/pod schedule sheets.
3. **What-If Sandbox Mode:** Allow managers to clone a published roster into a draft branch to test hiring/reassignment scenarios before committing changes.
