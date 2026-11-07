import { describe, it, expect } from 'vitest';
import {
  calculateUtilityConversion,
  processEscrowWaterfall,
} from '../src/core/exchangeService';
import { UTILITY_BONUS_RATIO } from '../src/core/constants';

describe('Exchange Service (1.25x Utility Bonus & Escrow Waterfall)', () => {
  it('converts work rebate tokens to utility tokens with 1.25x bonus', () => {
    const res = calculateUtilityConversion(100000);
    expect(res.utilityTokensCredited).toBe(125000);
    expect(res.bonusRatio).toBe(UTILITY_BONUS_RATIO);
  });

  it('throws error when converting non-positive rebate tokens', () => {
    expect(() => calculateUtilityConversion(0)).toThrow('greater than zero');
    expect(() => calculateUtilityConversion(-50)).toThrow('greater than zero');
  });

  it('allocates revenue escrow waterfall payouts subordinated to realized pool', () => {
    // $10,000 gross revenue ($1,000,000 cents), 30% escrow = $3,000 ($300,000 cents)
    // 60,000 tokens = $125.00 (12,500 cents)
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 1000000,
      escrowPercentage: 0.30,
      claims: [
        { userId: 'usr-1', tokensToRedeem: 60000, paypalEmail: 'usr1@example.com' },
        { userId: 'usr-2', tokensToRedeem: 120000, paypalEmail: 'usr2@example.com' },
      ],
    });

    expect(waterfall.escrowPoolCents).toBe(300000);
    expect(waterfall.payouts).toHaveLength(2);
    expect(waterfall.payouts[0].status).toBe('approved');
    expect(waterfall.payouts[0].payoutCents).toBe(12500); // $125.00
    expect(waterfall.payouts[1].status).toBe('approved');
    expect(waterfall.payouts[1].payoutCents).toBe(25000); // $250.00
    expect(waterfall.totalFiatApprovedCents).toBe(37500);
    expect(waterfall.remainingEscrowPoolCents).toBe(262500);
  });

  it('rejects claims that exceed the remaining escrow pool', () => {
    // Small revenue: $100 ($10,000 cents), 30% pool = $30 ($3,000 cents)
    // Claim requires 60,000 tokens = $125.00 (12,500 cents) > $30.00
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 10000,
      escrowPercentage: 0.30,
      claims: [
        { userId: 'usr-high', tokensToRedeem: 60000, paypalEmail: 'high@example.com' },
      ],
    });

    expect(waterfall.payouts[0].status).toBe('rejected_insufficient_pool');
    expect(waterfall.payouts[0].payoutCents).toBe(0);
    expect(waterfall.totalFiatApprovedCents).toBe(0);
  });

  it('enforces tax_compliance_locked gate when cumulative redemption reaches $599 threshold without verification', () => {
    // User already redeemed $500 (50,000 cents). Claim requires 60,000 tokens ($125.00 / 12,500 cents).
    // Total = $625.00 >= $599.00. User has taxComplianceVerified = false.
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 1000000,
      escrowPercentage: 0.30,
      claims: [
        {
          userId: 'usr-unverified-tax',
          tokensToRedeem: 60000,
          paypalEmail: 'unverified@example.com',
          ytdFiatRedeemedCents: 50000,
          taxComplianceVerified: false,
        },
      ],
    });

    expect(waterfall.payouts[0].status).toBe('tax_compliance_locked');
    expect(waterfall.payouts[0].reason).toContain('IRS 1099-NEC threshold ($599.00) reached');
    expect(waterfall.totalFiatApprovedCents).toBe(0);
  });

  it('approves claims reaching $599 threshold when tax compliance is verified', () => {
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 1000000,
      escrowPercentage: 0.30,
      claims: [
        {
          userId: 'usr-verified-tax',
          tokensToRedeem: 60000,
          paypalEmail: 'verified@example.com',
          ytdFiatRedeemedCents: 50000,
          taxComplianceVerified: true,
        },
      ],
    });

    expect(waterfall.payouts[0].status).toBe('approved');
    expect(waterfall.payouts[0].payoutCents).toBe(12500);
  });

  it('prevents split claims in the same batch from bypassing the $599 tax gate (SEC-0008)', () => {
    // 60,000 tokens = $125.00 (12,500 cents).
    // Claim 1: 192,000 tokens = $400.00 (40,000 cents) -> under $599 threshold
    // Claim 2: 144,000 tokens = $300.00 (30,000 cents) -> cumulative = $700.00 >= $599 threshold
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 10000000,
      escrowPercentage: 0.30,
      claims: [
        {
          userId: 'usr-split',
          tokensToRedeem: 192000,
          paypalEmail: 'split@example.com',
          ytdFiatRedeemedCents: 0,
          taxComplianceVerified: false,
        },
        {
          userId: 'usr-split',
          tokensToRedeem: 144000,
          paypalEmail: 'split@example.com',
          ytdFiatRedeemedCents: 0,
          taxComplianceVerified: false,
        },
      ],
    });

    expect(waterfall.payouts).toHaveLength(2);
    expect(waterfall.payouts[0].status).toBe('approved');
    expect(waterfall.payouts[0].payoutCents).toBe(40000);
    expect(waterfall.payouts[1].status).toBe('tax_compliance_locked');
    expect(waterfall.payouts[1].reason).toContain('IRS 1099-NEC threshold ($599.00) reached');
    expect(waterfall.totalFiatApprovedCents).toBe(40000);
  });

  it('enforces higher updated YTD on later claims in a batch (SEC-0008-UPDATED)', () => {
    // Claim 1: YTD 0, claims $100 (48,000 tokens = 10,000 cents). Approved. Cumulative becomes 10,000.
    // Claim 2: Updated YTD reports 55,000 cents, claims $100 (10,000 cents).
    // Cumulative YTD must use Math.max(55000, 10000) = 55,000 + 10,000 = 65,000 >= 59,900 -> locked!
    const waterfall = processEscrowWaterfall({
      period: '2026-11',
      grossRevenueCents: 10000000,
      escrowPercentage: 0.30,
      claims: [
        {
          userId: 'usr-updated-ytd',
          tokensToRedeem: 48000,
          paypalEmail: 'updated@example.com',
          ytdFiatRedeemedCents: 0,
          taxComplianceVerified: false,
        },
        {
          userId: 'usr-updated-ytd',
          tokensToRedeem: 48000,
          paypalEmail: 'updated@example.com',
          ytdFiatRedeemedCents: 55000,
          taxComplianceVerified: false,
        },
      ],
    });

    expect(waterfall.payouts[0].status).toBe('approved');
    expect(waterfall.payouts[1].status).toBe('tax_compliance_locked');
    expect(waterfall.payouts[1].reason).toContain('IRS 1099-NEC threshold ($599.00) reached');
  });
});
