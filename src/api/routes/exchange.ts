import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LedgerGateway } from '../../db/ledgerGateway';
import { UTILITY_BONUS_RATIO } from '../../core/constants';
import type { UtilityConversionResult, UtilityBurnResult } from '../../types';

const ConvertUtilitySchema = z.object({
  userId: z.string(),
  rebateTokens: z.number().int().positive(),
});

const BurnUtilitySchema = z.object({
  userId: z.string(),
  amount: z.number().int().positive(),
  serviceName: z.string().min(1),
  referenceId: z.string().optional(),
  description: z.string().optional(),
});

export function createExchangeRouter(gateway: LedgerGateway): Router {
  const router = Router();

  // Convert work-rebate tokens into in-app utility tokens at 1.25x bonus
  router.post('/utility', async (req: Request, res: Response): Promise<void> => {
    const parsed = ConvertUtilitySchema.parse(req.body);

    const { wallet, utility_tokens_credited } = await gateway.convertRebateToUtility(
      parsed.userId,
      parsed.rebateTokens
    );

    res.json({
      success: true,
      userId: parsed.userId,
      rebateTokensBurned: parsed.rebateTokens,
      utilityTokensCredited: utility_tokens_credited,
      bonusRatio: UTILITY_BONUS_RATIO,
      walletState: wallet,
    } satisfies UtilityConversionResult);
  });

  // Burn utility tokens for ecosystem services (Makerverse, Cozy, games, grants)
  router.post('/burn', async (req: Request, res: Response): Promise<void> => {
    const parsed = BurnUtilitySchema.parse(req.body);

    // Cross-user authorization check: caller identification is required unless authenticated as admin/service
    const callerUserId = req.headers['x-user-id'] as string | undefined;
    const adminKey = req.headers['x-admin-key'] as string | undefined;
    const configuredAdminKey = process.env.ADMIN_OVERRIDE_KEY;
    const hasAdminOrServiceRole =
      (configuredAdminKey && adminKey === configuredAdminKey) ||
      (process.env.NODE_ENV !== 'production' &&
        (req.headers['x-role'] === 'admin' ||
          req.headers['x-service-role'] === 'true' ||
          adminKey === 'sunshade-test-admin-key'));

    if (!callerUserId && !hasAdminOrServiceRole) {
      res.status(401).json({
        success: false,
        error: 'Missing caller user identification header (x-user-id) or administrative authorization.',
      });
      return;
    }

    if (callerUserId && callerUserId !== parsed.userId && !hasAdminOrServiceRole) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot burn utility tokens from another user wallet without admin/service role.',
      });
      return;
    }

    const updatedWallet = await gateway.burnUtilityTokens(
      parsed.userId,
      parsed.amount,
      parsed.serviceName,
      parsed.referenceId,
      parsed.description
    );

    res.json({
      success: true,
      userId: parsed.userId,
      utilityTokensBurned: parsed.amount,
      serviceName: parsed.serviceName,
      referenceId: parsed.referenceId,
      walletState: updatedWallet,
    } satisfies UtilityBurnResult);
  });

  return router;
}
