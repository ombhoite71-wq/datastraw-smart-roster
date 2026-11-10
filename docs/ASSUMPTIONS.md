# Documented Scheduling Assumptions (`ASSUMPTIONS.md`)

All configurable assumptions implemented in `src/lib/engine/` and `src/lib/seedData.ts` per `PROJECT_SPEC.md`:

1. **Process-Level Operating Calendar (`Process.openDays`, `Process.operatesOnHolidays`):**
   - Operating calendars live at the **Process** level rather than the Brand level so different processes within the same brand (e.g., `M2 Glowbar CS` vs. `M2 Glowbar ACC`, and `M5 Zenwear CS` vs. `M5 Zenwear NDR`) can follow different operating days and holiday rules.

2. **Weekly-Off Window & Partial Week Rule (`partialWeekMinDays = 4`):**
   - Each active employee requires **1 weekly off** per Monday–Sunday week clipped to the month boundaries.
   - A partial week at the start or end of the month requires an off day only if it contains at least `partialWeekMinDays` (default `4`) days within the month.
   - If a partial week at the month edge has its natural process-closed weekday (such as Sunday for Mon–Sat processes during Dec 28–31, 2026) or an employee's `fixedOffDay` in the adjacent month's portion of that Mon–Sun week, the weekly off naturally falls on that clipped day.

3. **Public Holidays & Weekly-Off Credit (`holidayCountsAsWeeklyOff = true`):**
   - When all of an employee's assigned processes are closed on a public holiday, the employee is prefilled as `HOLIDAY`, which counts toward that week's off requirement when `holidayCountsAsWeeklyOff` is `true` ( provided consecutive working days do not exceed `maxConsecutiveWorkDays`).

4. **Maximum Consecutive Working Days (`maxConsecutiveWorkDays = 6`):**
   - Employees may work at most `6` consecutive days (`status === 'WORK'`) within the month. `WEEKLY_OFF`, `HOLIDAY`, `LEAVE`, and `COMP_OFF` break the working streak.

5. **Comp-Off Credits (`getEarnedCompOffHolidayDates`):**
   - Working (`status === 'WORK'`) on a company-wide public holiday for a process that operates on holidays (`operatesOnHolidays = true`) earns the employee 1 comp-off credit displayed in the UI (not auto-scheduled without manager approval).

6. **Pod Leads (`podLeadsCountForCoverage = false`):**
   - Pod leads (`L1`–`L4`) supervise their respective pods (`P1`–`P4`) and do not count toward process minimum staffing coverage unless `podLeadsCountForCoverage` is explicitly enabled.

7. **Backup Assignments & Overload Threshold (`OVERLOAD` > 3 brands):**
   - `BACKUP` assignments count toward coverage on par with `PRIMARY` assignments when the employee is working (`WORK`) on that date.
   - A working floater covers all assigned processes that day, but if one employee is the **sole working cover** for more than **3 distinct brands** on the same date, the validator raises an `OVERLOAD` (`WARNING`).

8. **Mandatory Constraints vs. Soft Preferences:**
   - Client coverage (`COVERAGE_GAP`), weekly rest (`MISSING_WEEKLY_OFF`), streak limits (`MAX_CONSECUTIVE_DAYS`), approved leaves (`LEAVE_CONFLICT`), and fixed off days (`FIXED_OFF_VIOLATED`) are mandatory (`ERROR`).
   - `preferredOffDays` are soft (`WARNING: PREFERENCE_VIOLATED`). When coverage and preferred off days clash (e.g., `E23` preferring Saturday on `M2 Glowbar CS` where Fri–Sun requires `minStaff = 2`), client coverage takes priority.
