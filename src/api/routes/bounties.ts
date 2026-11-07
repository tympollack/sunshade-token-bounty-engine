import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { calculateBountyPricing } from '../../core/pricingEngine';
import { assertRunnerWeeklyCapacity } from '../../core/capacityGovernor';
import type { WorkItemRecord } from '../../types';

const ClaimSchema = z.object({
  claimantUserId: z.string(),
  newTaskHours: z.number().positive(),
  existingWeeklyHours: z.number().nonnegative().optional(),
  flexBankHoursAvailable: z.number().nonnegative().optional(),
  allowOverride: z.boolean().optional(),
});

function isAuthorizedAdmin(req: Request): boolean {
  const adminKey = req.headers['x-admin-key'] as string | undefined;
  const configuredAdminKey = process.env.ADMIN_OVERRIDE_KEY;

  if (configuredAdminKey) {
    return adminKey === configuredAdminKey;
  }

  // In non-production environments, allow test admin key or header
  if (process.env.NODE_ENV !== 'production') {
    return (
      adminKey === 'sunshade-test-admin-key' ||
      req.headers['x-admin-override'] === 'true' ||
      req.headers['x-role'] === 'admin'
    );
  }

  return false;
}

export function createBountiesRouter(): Router {
  const router = Router();

  // Quote bounty rate and neglect multiplier for a task
  router.get('/quote', (req: Request, res: Response): void => {
    const rawBountyHours = req.query.bounty_hours ? Number(req.query.bounty_hours) : undefined;
    const rawEstHours = req.query.estimated_hours ? Number(req.query.estimated_hours) : undefined;
    const rawFixedTokens = req.query.fixed_reward_tokens ? Number(req.query.fixed_reward_tokens) : undefined;

    const mockItem: WorkItemRecord = {
      id: String(req.query.work_item_id || 'quote-item'),
      status: 'todo',
      created_at: typeof req.query.created_at === 'string' ? req.query.created_at : undefined,
      updated_at: typeof req.query.updated_at === 'string' ? req.query.updated_at : undefined,
      metadata: {
        bounty_hours: rawBountyHours,
        estimated_hours: rawEstHours,
        fixed_reward_tokens: rawFixedTokens,
      },
    };

    const quote = calculateBountyPricing(mockItem);
    res.json({
      success: true,
      quote,
    });
  });

  // Verify and assert runner weekly capacity before claiming a bounty task
  router.post('/claim', (req: Request, res: Response): void => {
    const parsed = ClaimSchema.parse(req.body);

    // Administrative override gate: only allow override when explicitly authorized
    const hasAdminRole = isAuthorizedAdmin(req);
    if (parsed.allowOverride && !hasAdminRole) {
      res.status(403).json({
        success: false,
        error: 'Unauthorized: allowOverride requires administrative authorization (x-admin-key or admin role).',
      });
      return;
    }

    const capacityResult = assertRunnerWeeklyCapacity({
      claimantUserId: parsed.claimantUserId,
      newTaskHours: parsed.newTaskHours,
      existingWeeklyHours: parsed.existingWeeklyHours,
      flexBankHoursAvailable: parsed.flexBankHoursAvailable,
      allowOverride: parsed.allowOverride && hasAdminRole,
    });

    if (!capacityResult.isPermitted) {
      res.status(403).json({
        success: false,
        error: capacityResult.rejectionReason,
        capacity: capacityResult,
      });
      return;
    }

    res.json({
      success: true,
      capacity: capacityResult,
    });
  });

  return router;
}
