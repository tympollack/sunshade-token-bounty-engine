import { describe, it, expect } from 'vitest';
import {
  calculateNeglectMultiplier,
  calculateBountyPricing,
} from '../src/core/pricingEngine';
import { TOKEN_PER_HOUR, TRIAGE_UPKEEP_HOURS_PER_ITEM } from '../src/core/constants';
import type { WorkItemRecord } from '../src/types';

describe('Pricing Engine (Neglect Multipliers & 60k/hr Rates)', () => {
  const refDate = new Date('2026-11-01T12:00:00Z');

  it('keeps neglect multiplier at 1.0x for fresh tasks under 7 days idle', () => {
    const createdDate = new Date('2026-10-28T12:00:00Z'); // 4 days ago
    const res = calculateNeglectMultiplier(createdDate, undefined, refDate);
    expect(res.multiplier).toBe(1.0);
    expect(res.daysNeglected).toBe(4);
  });

  it('scales neglect multiplier up to 3.5x for tasks idle past 21 days', () => {
    const createdDate = new Date('2026-10-10T12:00:00Z'); // 22 days ago
    const res = calculateNeglectMultiplier(createdDate, undefined, refDate);
    expect(res.multiplier).toBe(3.5);
    expect(res.daysNeglected).toBe(22);
  });

  it('calculates bounty tokens accurately based on 60,000 tokens/hr base', () => {
    const item: WorkItemRecord = {
      id: 'task-std',
      status: 'todo',
      created_at: new Date('2026-10-30T12:00:00Z').toISOString(), // 2 days ago
      metadata: {
        bounty_hours: 1.5,
      },
    };

    const quote = calculateBountyPricing(item, refDate);
    expect(quote.baseHours).toBe(1.5);
    expect(quote.hourlyTokenRate).toBe(TOKEN_PER_HOUR);
    expect(quote.neglectMultiplier).toBe(1.0);
    expect(quote.bountyTokens).toBe(90000); // 1.5 * 60,000
    expect(quote.tokensPerMinute).toBe(1000);
    expect(quote.upkeepHours).toBe(TRIAGE_UPKEEP_HOURS_PER_ITEM);
    expect(quote.upkeepTokens).toBe(3000);
  });

  it('honors fixed reward tokens when explicitly specified in metadata', () => {
    const item: WorkItemRecord = {
      id: 'task-fixed',
      status: 'todo',
      metadata: {
        fixed_reward_tokens: 250000,
        bounty_hours: 2.0,
      },
    };

    const quote = calculateBountyPricing(item, refDate);
    expect(quote.isFixedReward).toBe(true);
    expect(quote.bountyTokens).toBe(250000);
  });
});
