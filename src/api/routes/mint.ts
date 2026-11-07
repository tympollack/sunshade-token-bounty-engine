import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateArtifactProof } from '../../core/proofValidator';
import { calculateNeglectMultiplier } from '../../core/pricingEngine';
import {
  TOKEN_PER_HOUR,
  TRIAGE_UPKEEP_HOURS_PER_ITEM,
  AUTONOMOUS_BOUNTY_HOURS_PER_ITEM,
  MAX_BOUNTY_HOURS_PER_ITEM,
  MAX_BOUNTY_TOKENS_PER_ITEM,
  SYSTEM_ECOSYSTEM_POOL_USER_ID,
  COMPLETION_STATUSES,
  MIN_NEGLECT_MULTIPLIER,
  MAX_NEGLECT_MULTIPLIER,
} from '../../core/constants';
import { LedgerGateway } from '../../db/ledgerGateway';
import type { WorkItemRecord, MintEfficiencyResult } from '../../types';

const MintEfficiencySchema = z.object({
  item: z.object({
    id: z.string().min(1, 'Work item ID cannot be empty'),
    project_id: z.string().optional(),
    tenant_id: z.string().optional(),
    title: z.string().optional(),
    status: z.string(),
    project_ledger_mode: z.enum(['standard_workspace', 'audited_production', 'personal_organizer']).optional(),
    metadata: z.record(z.any()).optional(),
    assignee_id: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  }),
  claimantUserId: z.string().optional(),
  systemPoolUserId: z.string().optional(),
  neglectMultiplier: z.number().optional(),
  vested: z.boolean().optional(),
});

function isAuthorizedAdminOrService(req: Request): boolean {
  const adminKey = req.headers['x-admin-key'] as string | undefined;
  const configuredAdminKey = process.env.ADMIN_OVERRIDE_KEY;

  if (configuredAdminKey) {
    return adminKey === configuredAdminKey;
  }

  if (process.env.NODE_ENV !== 'production') {
    return (
      adminKey === 'sunshade-test-admin-key' ||
      req.headers['x-admin-override'] === 'true' ||
      req.headers['x-role'] === 'admin'
    );
  }

  return false;
}

export function createMintRouter(gateway: LedgerGateway): Router {
  const router = Router();

  router.post('/efficiency', async (req: Request, res: Response): Promise<void> => {
    const parsed = MintEfficiencySchema.parse(req.body);
    const item = parsed.item as WorkItemRecord;
    const systemPoolId = parsed.systemPoolUserId || SYSTEM_ECOSYSTEM_POOL_USER_ID;

    // Strict Rule 1: Personal organizer items strictly excluded
    const ledgerMode = item.project_ledger_mode || 'standard_workspace';
    if (ledgerMode === 'personal_organizer') {
      res.json({
        success: false,
        workItemId: item.id,
        tenantId: item.tenant_id,
        projectId: item.project_id,
        systemPoolUserId: systemPoolId,
        isEligibleForBounty: false,
        isEligibleForUpkeep: false,
        bountyTokensMinted: 0,
        upkeepTokensMinted: 0,
        reason: 'Personal organizer items are strictly excluded from all sovereign token minting ($0.00 and 0.0 hrs).',
      } satisfies MintEfficiencyResult);
      return;
    }

    // Strict Rule 2: Must be completed
    const rawStatus = String(item.status || '').toLowerCase().trim();
    if (!COMPLETION_STATUSES.has(rawStatus)) {
      res.json({
        success: false,
        workItemId: item.id,
        tenantId: item.tenant_id,
        projectId: item.project_id,
        systemPoolUserId: systemPoolId,
        isEligibleForBounty: false,
        isEligibleForUpkeep: false,
        bountyTokensMinted: 0,
        upkeepTokensMinted: 0,
        reason: 'Work item is not in completed status.',
      } satisfies MintEfficiencyResult);
      return;
    }

    // Anti-spoofing guard: claimantUserId cannot contradict assignee_id
    if (parsed.claimantUserId && item.assignee_id && parsed.claimantUserId !== item.assignee_id) {
      res.status(403).json({
        success: false,
        error: 'Claimant user ID does not match work item assignee.',
      });
      return;
    }

    const claimantId = parsed.claimantUserId || item.assignee_id;
    const isVested = parsed.vested !== false;

    // Caller authorization check: caller must be identified or authenticated as admin
    const callerUserId = req.headers['x-user-id'] as string | undefined;
    const isAdmin = isAuthorizedAdminOrService(req);

    if (claimantId && !isAdmin) {
      if (!callerUserId) {
        res.status(401).json({
          success: false,
          error: 'Caller identification header (x-user-id) or administrative authorization is required to claim personal bounty yield.',
        });
        return;
      }
      if (callerUserId !== claimantId) {
        res.status(403).json({
          success: false,
          error: 'Caller is not authorized to mint tokens for another claimant user ID.',
        });
        return;
      }
    }

    // Calculate neglect multiplier clamped [1.0, 3.5]
    let multiplier = parsed.neglectMultiplier;
    if (multiplier === undefined) {
      const calc = calculateNeglectMultiplier(item.created_at, item.updated_at);
      multiplier = calc.multiplier;
    }
    multiplier = Math.min(MAX_NEGLECT_MULTIPLIER, Math.max(MIN_NEGLECT_MULTIPLIER, multiplier));

    // Pre-validate bounty tokens and hours BEFORE any database credits
    const isFixedReward =
      typeof item.metadata?.fixed_reward_tokens === 'number' && item.metadata.fixed_reward_tokens > 0;

    let bountyTokens = 0;
    if (isFixedReward) {
      const rawFixed = Number(item.metadata!.fixed_reward_tokens);
      if (isNaN(rawFixed) || rawFixed <= 0) {
        res.status(400).json({ success: false, error: 'Invalid or non-positive fixed reward tokens specified.' });
        return;
      }
      bountyTokens = Math.min(MAX_BOUNTY_TOKENS_PER_ITEM, Math.floor(rawFixed));
    } else {
      const rawHours = Number(
        item.metadata?.bounty_hours ?? item.metadata?.estimated_hours ?? AUTONOMOUS_BOUNTY_HOURS_PER_ITEM
      );
      if (isNaN(rawHours) || rawHours <= 0) {
        res.status(400).json({ success: false, error: 'Invalid or non-positive bounty hours specified.' });
        return;
      }
      const boundedHours = Math.min(MAX_BOUNTY_HOURS_PER_ITEM, Math.max(0.1, rawHours));
      bountyTokens = Math.min(
        MAX_BOUNTY_TOKENS_PER_ITEM,
        Math.floor(boundedHours * TOKEN_PER_HOUR * multiplier)
      );
    }

    // Check for prior mints to prevent duplicate token awards on retries
    const alreadyUpkeepMinted = await gateway.findExistingWorkItemAward(item.id, 'triage_upkeep');
    const alreadyPersonalMinted = await gateway.findExistingWorkItemAward(item.id, 'personal_bounty');

    if (alreadyUpkeepMinted && alreadyPersonalMinted) {
      res.json({
        success: true,
        workItemId: item.id,
        tenantId: item.tenant_id,
        projectId: item.project_id,
        claimantUserId: claimantId,
        systemPoolUserId: systemPoolId,
        isEligibleForUpkeep: true,
        isEligibleForBounty: true,
        upkeepTokensMinted: 0,
        bountyTokensMinted: 0,
        reason: 'Work item yield already minted in prior transaction (idempotent no-op).',
      } satisfies MintEfficiencyResult);
      return;
    }

    // 1. Triage Upkeep Stream (0.05 hrs = 3,000 tokens)
    let upkeepTokensMinted = 0;
    if (!alreadyUpkeepMinted) {
      const upkeepAmount = Math.floor(TRIAGE_UPKEEP_HOURS_PER_ITEM * TOKEN_PER_HOUR);
      try {
        await gateway.creditWorkRebate(
          systemPoolId,
          upkeepAmount,
          `Triage Upkeep Stream for item ${item.id}`,
          true,
          {
            stream: 'triage_upkeep',
            work_item_id: item.id,
            project_id: item.project_id,
            tenant_id: item.tenant_id,
          }
        );
        upkeepTokensMinted = upkeepAmount;
      } catch (err: any) {
        if (err.message && (err.message.includes('unique') || err.message.includes('duplicate'))) {
          upkeepTokensMinted = 0;
        } else {
          throw err;
        }
      }
    }

    // 2. Personal Bounty Stream
    const proof = validateArtifactProof(item);

    if (!proof.hasArtifactProof) {
      res.json({
        success: true,
        workItemId: item.id,
        tenantId: item.tenant_id,
        projectId: item.project_id,
        claimantUserId: claimantId,
        systemPoolUserId: systemPoolId,
        isEligibleForUpkeep: true,
        isEligibleForBounty: false,
        upkeepTokensMinted: upkeepTokensMinted,
        bountyTokensMinted: 0,
        proof,
        reason: proof.reason || 'Artifact proof is required to unlock personal autonomous bounty stream.',
      } satisfies MintEfficiencyResult);
      return;
    }

    // Unassigned tasks cannot receive personal bounty credits
    if (!claimantId) {
      res.json({
        success: true,
        workItemId: item.id,
        tenantId: item.tenant_id,
        projectId: item.project_id,
        systemPoolUserId: systemPoolId,
        isEligibleForUpkeep: true,
        isEligibleForBounty: false,
        upkeepTokensMinted: upkeepTokensMinted,
        bountyTokensMinted: 0,
        proof,
        reason: 'Work item is not assigned to a claimant; personal bounty stream requires a valid assignee.',
      } satisfies MintEfficiencyResult);
      return;
    }

    let personalTokensMinted = 0;
    let updatedWallet;
    if (!alreadyPersonalMinted && bountyTokens > 0) {
      try {
        updatedWallet = await gateway.creditWorkRebate(
          claimantId,
          bountyTokens,
          `Autonomous Personal Bounty for item ${item.id}`,
          isVested,
          {
            stream: 'personal_bounty',
            work_item_id: item.id,
            project_id: item.project_id,
            tenant_id: item.tenant_id,
            proof_type: proof.proofType,
            proof_ref: proof.proofRef,
            neglect_multiplier: multiplier,
          }
        );
        personalTokensMinted = bountyTokens;
      } catch (err: any) {
        if (err.message && (err.message.includes('unique') || err.message.includes('duplicate'))) {
          personalTokensMinted = 0;
        } else {
          throw err;
        }
      }
    }

    res.json({
      success: true,
      workItemId: item.id,
      tenantId: item.tenant_id,
      projectId: item.project_id,
      claimantUserId: claimantId,
      systemPoolUserId: systemPoolId,
      isEligibleForUpkeep: true,
      isEligibleForBounty: true,
      upkeepTokensMinted: upkeepTokensMinted,
      bountyTokensMinted: personalTokensMinted,
      proof,
      walletState: updatedWallet,
    } satisfies MintEfficiencyResult);
  });

  return router;
}
