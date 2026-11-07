import {
  WEEKLY_SOVEREIGN_HOURS_CAP,
  MAX_FLEX_BANK_HOURS,
  WEEKLY_SOVEREIGN_TOKEN_TARGET,
} from './constants';
import type { CapacityCheckOptions, CapacityCheckResult } from '../types';

/**
 * Derives the ISO 8601 week label (e.g. '2026-W45') for a given date.
 */
export function getIsoWeekLabel(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and count number of weeks
  const weekNumber = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Checks and enforces the 20-hour weekly capacity limit for a contributor.
 * A runner can claim up to 20.0 hours per week plus an optional flex time-bank allowance (up to 10.0 hrs).
 */
export function assertRunnerWeeklyCapacity(options: CapacityCheckOptions): CapacityCheckResult {
  const {
    claimantUserId,
    newTaskHours,
    existingWeeklyHours = 0,
    flexBankHoursAvailable = 0,
    allowOverride = false,
    referenceDate = new Date(),
  } = options;

  const isoWeek = getIsoWeekLabel(referenceDate);
  const clampedFlexBank = Math.min(MAX_FLEX_BANK_HOURS, Math.max(0, flexBankHoursAvailable));
  const effectiveCapacityCeiling = WEEKLY_SOVEREIGN_HOURS_CAP + clampedFlexBank;

  const projectedTotalHours = Number((existingWeeklyHours + newTaskHours).toFixed(2));
  const exceedsCapacity = projectedTotalHours > effectiveCapacityCeiling;

  if (exceedsCapacity && !allowOverride) {
    return {
      claimantUserId,
      isoWeek,
      claimedHoursThisWeek: existingWeeklyHours,
      newTaskHours,
      projectedTotalHours,
      maxWeeklyHours: WEEKLY_SOVEREIGN_HOURS_CAP,
      flexBankHoursAvailable: clampedFlexBank,
      effectiveCapacityCeiling,
      isPermitted: false,
      isOverridden: false,
      rejectionReason: `Runner weekly capacity exceeded for week ${isoWeek}. Projected: ${projectedTotalHours}h, Allowed: ${effectiveCapacityCeiling}h (${WEEKLY_SOVEREIGN_HOURS_CAP}h cap + ${clampedFlexBank}h flex bank).`,
    };
  }

  return {
    claimantUserId,
    isoWeek,
    claimedHoursThisWeek: existingWeeklyHours,
    newTaskHours,
    projectedTotalHours,
    maxWeeklyHours: WEEKLY_SOVEREIGN_HOURS_CAP,
    flexBankHoursAvailable: clampedFlexBank,
    effectiveCapacityCeiling,
    isPermitted: true,
    isOverridden: exceedsCapacity && allowOverride,
  };
}
