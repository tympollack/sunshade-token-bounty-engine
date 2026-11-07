import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateArtifactProof } from '../../core/proofValidator';
import { calculateNeglectMultiplier } from '../../core/pricingEngine';
import {
  TOKEN_PER_HOUR,
  TRIAGE_UPKEEP_HOURS_PER_ITEM,
  AUTONOMOUS_BOUNTY_HOURS_PER_ITEM,
  SYSTEM_ECOSYSTEM_POOL_USER_ID,
  COMPLETION_STATUSES,
  MIN_NEGLECT_MULTIPLIER,
  MAX_NEGLECT_MULTIPLIER,
} from '../../core/constants';
import { LedgerGateway } from '../../db/ledgerGateway';
import type { WorkItemRecord, MintEfficiencyResult } from '../../types';

const MintEfficiencySchema = z.object({
  item: z.object({
    id: z.string(),
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

    // Caller authorization check: callers cannot mint for another user unless admin
    const callerUserId = req.headers['x-user-id'] as string | undefined;
    const callerRole = (req.headers['x-role'] as string | undefined) || '';
    const isAdmin = callerRole === 'admin' || req.headers['x-admin-override'] === 'true';

    if (callerUserId && !isAdmin && claimantId && claimantId !== callerUserId) {
      res.status(403).json({
        success: false,
        error: 'Caller is not authorized to mint tokens for another claimant user ID.',
      });
      return;
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
    let upkeepTokens = 0;
    if (!alreadyUpkeepMinted) {
      upkeepTokens = Math.floor(TRIAGE_UPKEEP_HOURS_PER_ITEM * TOKEN_PER_HOUR);
      await gateway.creditWorkRebate(
        systemPoolId,
        upkeepTokens,
        `Triage Upkeep Stream for item ${item.id}`,
        true,
        {
          stream: 'triage_upkeep',
          work_item_id: item.id,
          project_id: item.project_id,
          tenant_id: item.tenant_id,
        }
      );
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
        upkeepTokensMinted: upkeepTokens,
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
        upkeepTokensMinted: upkeepTokens,
        bountyTokensMinted: 0,
        proof,
        reason: 'Work item is not assigned to a claimant; personal bounty stream requires a valid assignee.',
      } satisfies MintEfficiencyResult);
      return;
    }

    // Calculate neglect multiplier clamped [1.0, 3.5]
    let multiplier = parsed.neglectMultiplier;
    if (multiplier === undefined) {
      const calc = calculateNeglectMultiplier(item.created_at, item.updated_at);
      multiplier = calc.multiplier;
    }
    multiplier = Math.min(MAX_NEGLECT_MULTIPLIER, Math.max(MIN_NEGLECT_MULTIPLIER, multiplier));

    // Calculate bounty tokens, honoring fixed_reward_tokens and bounding hours
    const isFixedReward =
      typeof item.metadata?.fixed_reward_tokens === 'number' && item.metadata.fixed_reward_tokens > 0;

    let bountyTokens = 0;
    if (isFixedReward) {
      bountyTokens = Math.floor(item.metadata!.fixed_reward_tokens!);
    } else {
      const rawHours = Number(
        item.metadata?.bounty_hours ?? item.metadata?.estimated_hours ?? AUTONOMOUS_BOUNTY_HOURS_PER_ITEM
      );
      if (isNaN(rawHours) || rawHours <= 0) {
        res.status(400).json({ success: false, error: 'Invalid or non-positive bounty hours specified.' });
        return;
      }
      // Bound hours to maximum 40.0h per task to prevent unbounded ledger mints
      const boundedHours = Math.min(40.0, Math.max(0.1, rawHours));
      bountyTokens = Math.floor(boundedHours * TOKEN_PER_HOUR * multiplier);
    }

    let updatedWallet;
    if (!alreadyPersonalMinted && bountyTokens > 0) {
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
      upkeepTokensMinted: upkeepTokens,
      bountyTokensMinted: bountyTokens,
      proof,
      walletState: updatedWallet,
    } satisfies MintEfficiencyResult);
  });

  return router;
}
