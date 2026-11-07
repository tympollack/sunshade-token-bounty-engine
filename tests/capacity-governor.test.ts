import { describe, it, expect } from 'vitest';
import { assertRunnerWeeklyCapacity, getIsoWeekLabel } from '../src/core/capacityGovernor';
import { WEEKLY_SOVEREIGN_HOURS_CAP } from '../src/core/constants';

describe('Capacity Governor (20-Hour Weekly Sovereign Cap & Flex Bank)', () => {
  it('correctly formats ISO week labels', () => {
    const label = getIsoWeekLabel('2026-11-02T12:00:00Z');
    expect(label).toBe('2026-W45');
  });

  it('permits tasks when projected weekly hours are within the 20h cap', () => {
    const res = assertRunnerWeeklyCapacity({
      claimantUserId: 'usr-1',
      newTaskHours: 3.5,
      existingWeeklyHours: 12.0,
    });

    expect(res.isPermitted).toBe(true);
    expect(res.projectedTotalHours).toBe(15.5);
    expect(res.maxWeeklyHours).toBe(WEEKLY_SOVEREIGN_HOURS_CAP);
    expect(res.isOverridden).toBe(false);
  });

  it('permits tasks that exceed 20h if covered by available flex time-bank allowance', () => {
    // 18.0 existing + 4.0 new = 22.0h (exceeds 20.0h, but 5.0h flex bank gives 25.0h ceiling)
    const res = assertRunnerWeeklyCapacity({
      claimantUserId: 'usr-2',
      newTaskHours: 4.0,
      existingWeeklyHours: 18.0,
      flexBankHoursAvailable: 5.0,
    });

    expect(res.isPermitted).toBe(true);
    expect(res.effectiveCapacityCeiling).toBe(25.0);
    expect(res.projectedTotalHours).toBe(22.0);
  });

  it('rejects tasks when exceeding 20h + flex bank ceiling without override', () => {
    // 19.0 existing + 4.0 new = 23.0h (flex bank is 2.0h -> ceiling is 22.0h)
    const res = assertRunnerWeeklyCapacity({
      claimantUserId: 'usr-3',
      newTaskHours: 4.0,
      existingWeeklyHours: 19.0,
      flexBankHoursAvailable: 2.0,
      allowOverride: false,
    });

    expect(res.isPermitted).toBe(false);
    expect(res.rejectionReason).toContain('Runner weekly capacity exceeded');
    expect(res.rejectionReason).toContain('Projected: 23h');
  });

  it('rejects tasks when unrounded sum strictly exceeds cap even if rounded sum would equal cap', () => {
    // 19.999 + 0.002 = 20.001h > 20.00h (previously rounded to 20.00 and permitted)
    const res = assertRunnerWeeklyCapacity({
      claimantUserId: 'usr-precision',
      newTaskHours: 0.002,
      existingWeeklyHours: 19.999,
      flexBankHoursAvailable: 0,
      allowOverride: false,
    });

    expect(res.isPermitted).toBe(false);
    expect(res.rejectionReason).toContain('Runner weekly capacity exceeded');
    expect(res.rejectionReason).toContain('Projected: 20.001h');
  });

  it('permits tasks exceeding ceiling when allowOverride is explicitly set to true', () => {
    const res = assertRunnerWeeklyCapacity({
      claimantUserId: 'usr-admin',
      newTaskHours: 5.0,
      existingWeeklyHours: 20.0,
      allowOverride: true,
    });

    expect(res.isPermitted).toBe(true);
    expect(res.isOverridden).toBe(true);
  });
});
