import {
  TOKEN_PER_HOUR,
  TOKEN_PER_MINUTE,
  MIN_NEGLECT_MULTIPLIER,
  MAX_NEGLECT_MULTIPLIER,
  NEGLECT_THRESHOLD_DAYS,
  TRIAGE_UPKEEP_HOURS_PER_ITEM,
} from './constants';
import type { PricingQuote, WorkItemRecord } from '../types';

/**
 * Calculates the dynamic neglect multiplier for an item based on idle age.
 * Tasks idle beyond 7 days gain up to 3.5x boost to prioritize neglected public backlog tasks.
 */
export function calculateNeglectMultiplier(
  createdAt?: string | Date,
  updatedAt?: string | Date,
  referenceDate: Date = new Date()
): { multiplier: number; daysNeglected: number } {
  const refTime = referenceDate.getTime();
  const createdTime = createdAt ? new Date(createdAt).getTime() : refTime;
  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : createdTime;

  const relevantTime = !isNaN(updatedTime) && updatedTime > 0 ? updatedTime : createdTime;
  if (isNaN(relevantTime) || relevantTime <= 0) {
    return { multiplier: MIN_NEGLECT_MULTIPLIER, daysNeglected: 0 };
  }

  const ageMs = Math.max(0, refTime - relevantTime);
  const daysNeglected = Number((ageMs / (1000 * 60 * 60 * 24)).toFixed(2));

  if (daysNeglected <= NEGLECT_THRESHOLD_DAYS) {
    return { multiplier: MIN_NEGLECT_MULTIPLIER, daysNeglected };
  }

  // Linear scaling from 1.0x at 7 days to 3.5x at 21+ days (14 day acceleration window)
  const daysOverThreshold = daysNeglected - NEGLECT_THRESHOLD_DAYS;
  const rawMultiplier = 1.0 + (daysOverThreshold / 14) * 2.5;
  const clampedMultiplier = Number(
    Math.min(MAX_NEGLECT_MULTIPLIER, Math.max(MIN_NEGLECT_MULTIPLIER, rawMultiplier)).toFixed(2)
  );

  return { multiplier: clampedMultiplier, daysNeglected };
}

/**
 * Calculates the comprehensive bounty pricing and upkeep tokens for a work item.
 */
export function calculateBountyPricing(
  item: WorkItemRecord,
  referenceDate: Date = new Date()
): PricingQuote {
  const meta = item.metadata || {};
  const isFixedReward = typeof meta.fixed_reward_tokens === 'number' && meta.fixed_reward_tokens > 0;

  // Base hours derivation
  const rawHours = meta.bounty_hours ?? meta.estimated_hours ?? 1.0;
  const baseHours = Math.max(0.1, Number(rawHours));

  const { multiplier, daysNeglected } = calculateNeglectMultiplier(
    item.created_at || meta.created_at,
    item.updated_at || meta.updated_at,
    referenceDate
  );

  let bountyTokens: number;
  if (isFixedReward) {
    bountyTokens = Math.floor(meta.fixed_reward_tokens!);
  } else {
    // 60,000 tokens/hr * baseHours * neglectMultiplier
    bountyTokens = Math.floor(baseHours * TOKEN_PER_HOUR * multiplier);
  }

  const totalMinutes = Math.max(1, Math.round(baseHours * 60));
  const tokensPerMinute = Number((bountyTokens / totalMinutes).toFixed(1));

  // Ecosystem upkeep pool derivation
  const upkeepHours = TRIAGE_UPKEEP_HOURS_PER_ITEM;
  const upkeepTokens = Math.floor(upkeepHours * TOKEN_PER_HOUR);

  return {
    workItemId: item.id,
    baseHours,
    hourlyTokenRate: TOKEN_PER_HOUR,
    neglectMultiplier: multiplier,
    isFixedReward,
    bountyTokens,
    tokensPerMinute,
    upkeepHours,
    upkeepTokens,
    daysNeglected,
  };
}
