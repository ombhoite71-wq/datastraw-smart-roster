# Smart Roster Management System

> A deterministic monthly roster generation, validation, and operational repair engine designed for multi-client D2C operations.

## Live Deployment & Submission

* **Live Application:** [YOUR_VERCEL_URL_HERE]
* **GitHub Repository:** https://github.com/ombhoite71-wq/datastraw-smart-roster
* **Walkthrough Video (Loom/Drive):** [YOUR_LOOM_OR_DRIVE_VIDEO_LINK_HERE]
* **Candidate:** Om Bhoite | [LinkedIn Profile](https://www.linkedin.com/in/om-bhoite-769a08363/)

---

## 1. System Architecture & Workflow

The core challenge of this assignment is that **brands operate on client calendars, but staff operate on labor and welfare rules**. If a single-resource brand operates Monday through Saturday, the assigned employee cannot simply take Sunday off if the brand also runs Sunday support, nor can 365-day brands shut down because staff need rest days.

To solve this cleanly without state corruption or silent bugs:

1. **Decoupled Data Architecture:** `Brand`, `Process`, `Employee`, and `Assignment` are modeled independently. Operating rules live on the `Process`, not on the person.
2. **Deterministic Engine (`src/lib/engine/`):** Pure TypeScript functions with zero UI or DOM dependencies.
   * `matrix.ts`: Generates day-by-day required staffing counts.
   * `generator.ts`: 7-stage deterministic assignment solver prioritizing constrained single-resource workers first, then pool workers, then floaters.
   * `validator.ts`: Pure verification pass auditing 7 hard `ERROR` types and 2 soft `WARNING` types.
   * `suggestions.ts`: Pre-flight simulation engine that validates potential shift patches *before* presenting them to the user.
3. **No Phantom State:** All issues (coverage gaps, consecutive streak breaches) are evaluated on the fly by `validateRoster(roster, data)`. The roster state contains only concrete shifts (`WORK`, `WEEKLY_OFF`, `HOLIDAY`, `LEAVE`, `COMP_OFF`), making race conditions impossible.

---

## 2. Quickstart & Local Setup

```bash
# Clone the repository
git clone https://github.com/ombhoite71-wq/datastraw-smart-roster.git
cd datastraw-smart-roster

# Install dependencies
npm install

# Start development server
npm run dev

# Run full TypeScript verification & production build
npm run build
```

---

## 3. Tell Us How You Think (Architectural Decisions & Reasoning)

### Q1: How did you model employees, brands, processes, pods, and their relationships?

I realized early on that linking employees directly to brands would fall apart as soon as a brand had multiple functions with different hours (like customer service running 7 days a week, but billing/escalations only running Monday to Friday).

So I made **Process** the central operational unit:
* **Brand:** A high-level client entity (e.g., `M2 - Glowbar` or `S01 - PureGlow`).
* **Process:** Child of a brand carrying the actual operational schedule: `openDays` (e.g., Mon–Sat vs. 365 days), `operatesOnHolidays`, and `minStaff`.
* **Pod:** Organizational group (`P1` to `P4`) led by a Pod Lead (`L1`–`L4`). I set `podLeadsCountForCoverage = false` so supervisory staff are never used to mask daily headcount shortages.
* **Employee:** Holds pod affiliation, soft preferred off-days, and hard fixed off-days (`fixedOffDay`).
* **Assignment:** A join relationship connecting an `employeeId` to a `processId` with a role (`PRIMARY` or `BACKUP`).

This structure cleanly handles single-resource owners (`E01` on all `S01` processes), multi-employee brands (staggered across `M1`–`M5`), and floater backups (`E31`, `E32`) stepping in during off-days without altering brand ownership.

---

### Q2: How does your system generate a roster and determine whether it satisfies the required constraints?

Instead of a slow, non-deterministic random solver, I built a deterministic 7-stage pipeline in `src/lib/engine/generator.ts`:

1. **Target Matrix Calculation:** First, compute exactly how many people each process needs for all 31 days in the month based on its operating calendar and holiday rules.
2. **Lock Immovable Days:** Approved leaves (`LEAVE`), scheduled comp-offs (`COMP_OFF`), and brand-wide closed days (`HOLIDAY`) are locked down first.
3. **Tightness-First Scheduling:** Sort employees by how constrained they are. Single-resource brand owners are scheduled first because they have zero internal swap flexibility; multi-resource pools and floaters are scheduled later.
4. **Scored Welfare Off-Day Placement:** For each 7-day Monday–Sunday block, evaluate candidate weekly-off days using a penalty score:
   ```text
   Score = (Coverage Gap * 1000) + (Preference Clash * 10) + Spacing Penalties
   ```
5. **No Cheating on Welfare:** If giving someone their required weekly off causes a coverage gap on a 7-day brand, the engine **still gives them the day off**. It intentionally surfaces a red `COVERAGE_GAP` in the validator rather than silently violating labor laws to make the schedule look green.
6. **Bounded 3-Pass Local Swapping:** An automated pass looks for unlocked days in the same week to swap off-days with available slack days.
7. **On-Demand Validation:** Finally, `validateRoster()` audits the generated matrix. It tests for maximum 6 consecutive work days, 1 mandatory rest day per week, minimum staff coverage, orphan processes, and preferred rest day adherence.

---

### Q3: How did you handle the difference between single-resource brands and brands with multiple employees?

* **Single-Resource Brands (80% of portfolio / 20 brands):**
  One dedicated person handles all functions.
  * For standard Monday–Saturday brands (like `S01`–`S10`), their mandatory weekly off maps naturally to the client's closed day (Sunday).
  * For 7-day single-resource brands (like `S11`–`S20`), one human physically cannot cover all 7 days without violating the 6-consecutive-day limit. The system pairs these accounts with designated floaters (`E31 Devika Hegde` and `E32 Akash Malhotra`) who act as pre-assigned `BACKUP` staff to cover the primary owner's rest day.
* **Multi-Employee Brands (20% of portfolio / 5 brands):**
  Brands like `M2 Glowbar` or `M1 UrbanClad` have multiple people assigned to shared processes. Here, the engine staggers weekly offs across the assigned team so that days with higher minimum staffing (like Glowbar CS requiring 2 staff on Fri/Sat/Sun) always maintain required headcount.

---

### Q4: What happens when an employee managing all processes for a brand is unavailable on a required working day?

When a single-resource owner takes an approved leave on an active operating day:
1. The engine locks that cell to `LV` and re-runs validation.
2. The validator immediately fires a red `COVERAGE_GAP` error for that date, detailing the root cause (e.g., *"S02 - ChatCraft CS requires 1 staff, but only 0 working. Cause: E02 Vivaan Sharma on approved leave"*).
3. The suggestion engine (`suggestFixes`) scans available backups within the pod or company-wide floaters, running a test validation on each candidate.
4. If an eligible floater is found, the UI presents an **"Apply Validated Fix"** action. One click assigns the replacement, grants a compensatory credit if necessary, clears the error, and logs it into the **Issues Solved** collapsible dropdown.
5. If no backup is available, it explicitly flags *"Needs external resource"* and offers a managerial override button to waive coverage for that day.

---

### Q5: How does your system handle conflicting requirements or insufficient staffing?

I followed a strict design principle: **Never fail silently and never fake a valid schedule.**

* **Hard Errors vs. Soft Warnings:** Labor welfare (1 off per week, maximum 6 consecutive days) and client minimum coverage are non-negotiable hard `ERROR` conditions. Soft employee preferences (`preferredOffDays`) are `WARNING` conditions. When they conflict, business continuity wins, the shift is scheduled, and a yellow warning is shown explaining why the preference was overridden.
* **Structural Shortages:** In edge cases like Scenario S8 (where both assigned workers on a brand are on leave on the same day), the system does not silently remove the client's requirement. It highlights the deficit, flags the exact gap count (`0/2 active`), and requires an explicit managerial action (either reassigning a cross-pod agent or confirming a formal coverage waiver).

---

### Q6: Which parts of the process did you automate, and which did you leave under human control? Why?

* **Automated:** Baseline shift calculation, constraint checking, holiday comp-off credit tracking (`+CO` for staff working on holidays like Christmas for 365-day brands), candidate fix simulation, and real-time error auditing. These involve repetitive combinatorial arithmetic that software handles quickly and reliably.
* **Human Control:** Approving leaves, publishing rosters, overriding locked shifts, and granting operational coverage waivers. In a real B2B service agency, deciding whether to run short-staffed or pay emergency overtime to an external contractor is a business judgment call that software should inform, not decide unilaterally.

---

### Q7: If the company doubled its team and brand count, what would you change about your solution?

If scaled to 70+ employees and 50+ brands:
1. **Pod-Partitioned Solver Workers:** Since 90% of assignments and backups are constrained within pods, I would break the single generator into 4 parallel Web Worker jobs (one per pod), solving them concurrently in the browser before running a light global pass for cross-pod floaters.
2. **Sub-Day & Split Shifts:** Currently, shifts are modeled as daily units (`WORK`, `OFF`). I would introduce intraday time blocks (e.g., 08:00–16:00 and 14:00–22:00) to support fractional shifts and lunch-hour handovers.
3. **PostgreSQL + Row-Level Locking:** Replace the client-side state with a Node.js/PostgreSQL backend using Prisma and WebSockets. If two Pod Leads edit December Week 2 simultaneously, optimistic locking would prevent schedule overwrite collisions.

---

### Q8: If you had one additional week to work on this, what would you improve first?

1. **Interactive Timeline / Gantt Drag-and-Drop:** Replace the table cells with an interactive drag-and-drop timeline grid (using `@dnd-kit` or FullCalendar) so managers can drag a floater onto a sick employee's slot with real-time visual clash indicators.
2. **Dynamic Cross-Pod Floater Bidding & Balance:** A smart recommendation algorithm that ranks available backup workers across the whole company based on who has worked the fewest weekend shifts and who has the lowest burnout index.
3. **Full Native Bi-Directional Google Sheets Sync:** Rather than one-way CSV export, integrate the Google Sheets API via OAuth so publishing a roster updates the live operations team sheet in real time and imports supervisor leave approvals back into the app.
4. **Employee Self-Service Shift Swapping:** A dedicated view for agents to propose direct 1-to-1 shift swaps with pod teammates, automatically screening both workers' schedules for consecutive-day breaches before notifying the Pod Lead for sign-off.
5. **Historical Fairness & Fatigue Analytics:** A rolling 3-month fairness dashboard tracking who worked major public holidays (like Diwali or Christmas), who had split rest days, and comp-off balances to prevent favoritism across monthly roster cycles.

---

## 4. Documented Assumptions

1. **Weekly-Off Window:** A "week" is strictly Monday 00:00 through Sunday 23:59. Every employee must receive at least 1 rest day in this 7-day period. Partial boundary weeks (e.g., Dec 1–6) require an off-day only if they contain 4 or more working days.
2. **Consecutive Days Limit:** An employee can work a maximum of 6 consecutive days. Any rest day (`WEEKLY_OFF`, `HOLIDAY`, `LEAVE`, or `COMP_OFF`) resets the streak counter.
3. **Public Holiday Comp-Offs:** Employees working a 365-day brand process on a company public holiday (Founders' Day Dec 15, Christmas Eve Dec 24, Christmas Day Dec 25) are flagged with `+CO` indicating an earned compensatory day credit.
4. **Pod Leads:** Pod Leads (`L1`–`L4`) act in a supervisory capacity and are never counted toward process minimum staffing thresholds (`podLeadsCountForCoverage = false`).
5. **Floaters:** Employees `E31` and `E32` are unassigned in the baseline seed and operate as floating backups. They satisfy single-resource weekend off-day coverage when assigned with role `BACKUP`.

---

## 5. Built-in Automated Verification Suite

The application includes an in-browser verification suite accessible via the **System Verification** tab that runs scenarios S1 through S11 on-demand:

* **S1:** Generate Dec 2026 baseline on seed data -> `0 ERRORS` (with expected soft preference warnings).
* **S2:** Sunday-off brands closed Sundays -> Sunday required headcount is `0`.
* **S3:** 365-day brand owner (`E16`) scheduled on Christmas -> marked `WORK` with comp-off credit `+CO`.
* **S4:** Glowbar CS has both `E22` & `E23` working Fri/Sat/Sun -> verifies 2/2 staffing.
* **S5:** Deterministic test: Running generation twice produces identical schedules.
* **S6:** Regeneration preserves locked manual overrides and approved leaves.
* **S7:** Approving leave for single-resource owner (`E02`) on 08/12/2026 -> triggers red `COVERAGE_GAP`.
* **S8:** Both Glowbar CS workers taking leave on 12/12/2026 -> triggers red `COVERAGE_GAP` and flags external backup needed.
* **S9:** Removing floater `E31` from 365-day brand -> validator catches weekly coverage deficit.
* **S10:** High staffing demand on limited pod -> catches `INSUFFICIENT_HEADCOUNT`.
* **S11:** Brand process with no assigned staff -> validator reports `NO_ASSIGNED_EMPLOYEE`.
