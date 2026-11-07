import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { processEscrowWaterfall } from '../../core/exchangeService';
import { LedgerGateway } from '../../db/ledgerGateway';

const EscrowWaterfallSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
  grossRevenueCents: z.number().int().nonnegative(),
  escrowPercentage: z.number().min(0).max(1).optional(),
  claims: z.array(
    z.object({
      userId: z.string(),
      tokensToRedeem: z.number().int().positive(),
      paypalEmail: z.string().email().optional(),
      ytdFiatRedeemedCents: z.number().int().nonnegative().optional(),
      taxComplianceVerified: z.boolean().optional(),
    })
  ),
});

export function createEscrowRouter(gateway?: LedgerGateway): Router {
  const router = Router();

  // Calculate monthly revenue-gated PayPal escrow waterfall
  router.post('/waterfall', async (req: Request, res: Response): Promise<void> => {
    const parsed = EscrowWaterfallSchema.parse(req.body);

    // If claims lack YTD tax state and gateway is provided, enrich from user wallet rollups
    if (gateway) {
      await Promise.all(
        parsed.claims.map(async (claim) => {
          if (claim.ytdFiatRedeemedCents === undefined || claim.taxComplianceVerified === undefined) {
            try {
              const wallet = await gateway.getUserWallet(claim.userId);
              if (claim.ytdFiatRedeemedCents === undefined) {
                claim.ytdFiatRedeemedCents = wallet.ytd_fiat_redeemed_cents ?? 0;
              }
              if (claim.taxComplianceVerified === undefined) {
                claim.taxComplianceVerified = wallet.tax_compliance_verified ?? false;
              }
            } catch {
              // Fallback to defaults if wallet lookup fails
            }
          }
        })
      );
    }

    const result = processEscrowWaterfall(parsed);

    res.json({
      success: true,
      result,
    });
  });

  return router;
}
