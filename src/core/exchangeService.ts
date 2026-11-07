import {
  UTILITY_BONUS_RATIO,
  IRS_1099_NEC_THRESHOLD_CENTS,
  TOKEN_PER_HOUR,
} from './constants';
import type {
  UtilityConversionOptions,
  UtilityConversionResult,
  UtilityBurnOptions,
  UtilityBurnResult,
  EscrowWaterfallOptions,
  EscrowWaterfallResult,
  EscrowWaterfallPayout,
} from '../types';

/**
 * Calculates conversion of work rebate tokens to in-app utility tokens with 1.25x bonus.
 */
export function calculateUtilityConversion(
  rebateTokens: number
): { utilityTokensCredited: number; bonusRatio: number } {
  if (rebateTokens <= 0) {
    throw new Error('Rebate tokens to convert must be greater than zero.');
  }

  const utilityTokensCredited = Math.round(rebateTokens * UTILITY_BONUS_RATIO);
  return {
    utilityTokensCredited,
    bonusRatio: UTILITY_BONUS_RATIO,
  };
}

/**
 * Processes monthly revenue escrow waterfall calculations for PayPal cashout requests.
 * Ensures payouts are subordinated strictly to realized B2B revenue pools and enforces
 * the $599 IRS 1099-NEC tax compliance gate.
 */
export function processEscrowWaterfall(options: EscrowWaterfallOptions): EscrowWaterfallResult {
  const { period, grossRevenueCents, escrowPercentage = 0.30, claims } = options;

  const escrowPoolCents = Math.floor(grossRevenueCents * escrowPercentage);
  let remainingPoolCents = escrowPoolCents;
  let totalFiatApprovedCents = 0;
  let totalTokensRequested = 0;

  const payouts: EscrowWaterfallPayout[] = [];
  const userCumulativeYtdCents = new Map<string, number>();

  // Conversion rate baseline: 60,000 tokens = $125.00 (12,500 cents) -> 1 token = 12500 / 60000 = ~0.2083 cents
  const CENTS_PER_TOKEN = 12500 / TOKEN_PER_HOUR;

  for (const claim of claims) {
    totalTokensRequested += claim.tokensToRedeem;
    const requiredCents = Math.floor(claim.tokensToRedeem * CENTS_PER_TOKEN);

    if (requiredCents <= 0) {
      payouts.push({
        userId: claim.userId,
        tokensRedeemed: 0,
        payoutCents: 0,
        status: 'rejected_insufficient_pool',
        reason: 'Requested tokens translate to less than 1 cent.',
      });
      continue;
    }

    const claimYtd = claim.ytdFiatRedeemedCents ?? 0;
    const existingYtd = userCumulativeYtdCents.get(claim.userId) ?? 0;
    const currentYtd = Math.max(claimYtd, existingYtd);
    const isTaxVerified = claim.taxComplianceVerified ?? false;

    // IRS 1099-NEC Threshold Gate ($599.00 / 59,900 cents)
    if (currentYtd + requiredCents >= IRS_1099_NEC_THRESHOLD_CENTS && !isTaxVerified) {
      userCumulativeYtdCents.set(claim.userId, currentYtd);
      payouts.push({
        userId: claim.userId,
        tokensRedeemed: 0,
        payoutCents: 0,
        paypalEmail: claim.paypalEmail,
        status: 'tax_compliance_locked',
        reason: `IRS 1099-NEC threshold ($599.00) reached. YTD: $${(currentYtd / 100).toFixed(2)}, Claim: $${(requiredCents / 100).toFixed(2)}. Tax compliance verification required.`,
      });
      continue;
    }

    if (requiredCents > remainingPoolCents) {
      userCumulativeYtdCents.set(claim.userId, currentYtd);
      payouts.push({
        userId: claim.userId,
        tokensRedeemed: 0,
        payoutCents: 0,
        paypalEmail: claim.paypalEmail,
        status: 'rejected_insufficient_pool',
        reason: `Insufficient escrow pool funds for period ${period}. Requested: $${(requiredCents / 100).toFixed(2)}, Available: $${(remainingPoolCents / 100).toFixed(2)}.`,
      });
      continue;
    }

    remainingPoolCents -= requiredCents;
    totalFiatApprovedCents += requiredCents;
    userCumulativeYtdCents.set(claim.userId, currentYtd + requiredCents);

    payouts.push({
      userId: claim.userId,
      tokensRedeemed: claim.tokensToRedeem,
      payoutCents: requiredCents,
      paypalEmail: claim.paypalEmail,
      status: 'approved',
    });
  }

  return {
    period,
    grossRevenueCents,
    escrowPoolCents,
    totalTokensRequested,
    totalFiatApprovedCents,
    remainingEscrowPoolCents: remainingPoolCents,
    payouts,
  };
}
