import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { processEscrowWaterfall } from '../../core/exchangeService';

const EscrowWaterfallSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
  grossRevenueCents: z.number().int().nonnegative(),
  escrowPercentage: z.number().min(0).max(1).optional(),
  claims: z.array(
    z.object({
      userId: z.string(),
      tokensToRedeem: z.number().int().positive(),
      paypalEmail: z.string().email().optional(),
    })
  ),
});

export function createEscrowRouter(): Router {
  const router = Router();

  // Calculate monthly revenue-gated PayPal escrow waterfall
  router.post('/waterfall', (req: Request, res: Response): void => {
    const parsed = EscrowWaterfallSchema.parse(req.body);
    const result = processEscrowWaterfall(parsed);

    res.json({
      success: true,
      result,
    });
  });

  return router;
}
