import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/api/app';
import { LedgerGateway, DatabaseError } from '../src/db/ledgerGateway';
import type { UserTokenWallet } from '../src/types';

describe('Bounty Engine API Routes Integration Tests', () => {
  const TEST_API_KEY = 'sunshade-test-api-key';
  process.env.ENGINE_API_KEY = TEST_API_KEY;

  const mockWallet: UserTokenWallet = {
    user_id: 'usr-42',
    utility_balance: 50000,
    rebate_balance_vested: 100000,
    rebate_units_pending: 12000,
    lifetime_rebate_minted: 112000,
    prestige_overflow_donated: 0,
    prestige_mentor_status: false,
    priority_tier: 'standard_contributor',
    ytd_fiat_redeemed_cents: 0,
    tax_compliance_verified: true,
  };

  let mockGateway: LedgerGateway;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockGateway = {
      getUserWallet: vi.fn().mockResolvedValue(mockWallet),
      creditWorkRebate: vi.fn().mockResolvedValue({
        ...mockWallet,
        rebate_balance_vested: mockWallet.rebate_balance_vested + 12000,
      }),
      vestPendingWorkRebates: vi.fn().mockResolvedValue(mockWallet),
      convertRebateToUtility: vi.fn().mockResolvedValue({
        wallet: {
          ...mockWallet,
          rebate_balance_vested: mockWallet.rebate_balance_vested - 50000,
          utility_balance: mockWallet.utility_balance + 62500,
        },
        utility_tokens_credited: 62500,
      }),
      burnUtilityTokens: vi.fn().mockResolvedValue({
        ...mockWallet,
        utility_balance: mockWallet.utility_balance - 10000,
      }),
      findExistingWorkItemAward: vi.fn().mockResolvedValue(false),
      appendLedgerEntry: vi.fn().mockResolvedValue(undefined),
    } as unknown as LedgerGateway;

    app = createApp({ gateway: mockGateway });
  });

  describe('Health & Authentication', () => {
    it('GET /api/v1/health is public and returns 200', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('sunshade-token-bounty-engine');
    });

    it('rejects protected routes without valid API key with 401', async () => {
      const res = await request(app).get('/api/v1/bounties/quote?bounty_hours=1.0');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('accepts protected routes with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/bounties/quote?bounty_hours=1.0')
        .set('Authorization', `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.quote.bountyTokens).toBe(60000);
    });

    it('blocks default key in production mode (SEC-0001)', async () => {
      const origEnv = process.env.NODE_ENV;
      const origKey = process.env.ENGINE_API_KEY;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ENGINE_API_KEY;

        const res = await request(app)
          .get('/api/v1/bounties/quote?bounty_hours=1.0')
          .set('x-api-key', 'sunshade-test-api-key');

        expect(res.status).toBe(500);
        expect(res.body.error).toContain('ENGINE_API_KEY environment variable is not configured');
      } finally {
        process.env.NODE_ENV = origEnv;
        process.env.ENGINE_API_KEY = origKey;
      }
    });
  });

  describe('Bounty Quoting & Capacity Gate', () => {
    it('POST /api/v1/bounties/claim enforces 20h capacity limit', async () => {
      // 18h existing + 4h new = 22h > 20h (without flex bank)
      const res = await request(app)
        .post('/api/v1/bounties/claim')
        .set('x-api-key', TEST_API_KEY)
        .send({
          claimantUserId: 'usr-runner',
          newTaskHours: 4.0,
          existingWeeklyHours: 18.0,
          flexBankHoursAvailable: 0,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.capacity.isPermitted).toBe(false);
    });

    it('POST /api/v1/bounties/claim permits task when covered by flex bank', async () => {
      const res = await request(app)
        .post('/api/v1/bounties/claim')
        .set('x-api-key', TEST_API_KEY)
        .send({
          claimantUserId: 'usr-runner',
          newTaskHours: 4.0,
          existingWeeklyHours: 18.0,
          flexBankHoursAvailable: 5.0,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.capacity.isPermitted).toBe(true);
    });

    it('rejects allowOverride when caller lacks admin privileges (SEC-0001)', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ADMIN_OVERRIDE_KEY = 'real-admin-secret-key';

        const res = await request(app)
          .post('/api/v1/bounties/claim')
          .set('x-api-key', TEST_API_KEY)
          .set('x-role', 'admin') // Client header without secret
          .send({
            claimantUserId: 'usr-runner',
            newTaskHours: 5.0,
            existingWeeklyHours: 20.0,
            allowOverride: true,
          });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('allowOverride requires administrative authorization');
      } finally {
        process.env.NODE_ENV = origEnv;
        delete process.env.ADMIN_OVERRIDE_KEY;
      }
    });

    it('allows allowOverride when caller has admin authorization header', async () => {
      const res = await request(app)
        .post('/api/v1/bounties/claim')
        .set('x-api-key', TEST_API_KEY)
        .set('x-admin-key', 'sunshade-test-admin-key')
        .send({
          claimantUserId: 'usr-runner',
          newTaskHours: 5.0,
          existingWeeklyHours: 20.0,
          allowOverride: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.capacity.isPermitted).toBe(true);
      expect(res.body.capacity.isOverridden).toBe(true);
    });
  });

  describe('Efficiency Minting Bridge', () => {
    it('POST /api/v1/mint/efficiency rejects personal organizer chores', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .send({
          item: {
            id: 'chore-1',
            status: 'complete',
            project_ledger_mode: 'personal_organizer',
            metadata: { commit_sha: 'commit-12345678' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.bountyTokensMinted).toBe(0);
      expect(res.body.reason).toContain('Personal organizer items are strictly excluded');
    });

    it('POST /api/v1/mint/efficiency mints dual-stream for verified commercial tasks', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-verified',
            status: 'complete',
            project_ledger_mode: 'audited_production',
            assignee_id: 'usr-42',
            metadata: {
              commit_sha: 'sha-abcdef0123456789',
              bounty_hours: 0.20,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isEligibleForUpkeep).toBe(true);
      expect(res.body.isEligibleForBounty).toBe(true);
      expect(res.body.upkeepTokensMinted).toBe(3000);
      expect(res.body.bountyTokensMinted).toBe(12000); // 0.20 hrs * 60k
      expect(mockGateway.creditWorkRebate).toHaveBeenCalled();
    });

    it('is idempotent on repeat mints (BUG-0002)', async () => {
      (mockGateway.findExistingWorkItemAward as any).mockResolvedValue(true);

      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-repeat',
            status: 'complete',
            assignee_id: 'usr-42',
            metadata: { commit_sha: 'sha-abcdef0123456789' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.upkeepTokensMinted).toBe(0);
      expect(res.body.bountyTokensMinted).toBe(0);
      expect(res.body.reason).toContain('already minted in prior transaction (idempotent no-op)');
    });

    it('does not overstate bounty minted on partial retry (BUG-0004)', async () => {
      // Upkeep award is missing, but personal award was already minted
      (mockGateway.findExistingWorkItemAward as any).mockImplementation((_id: string, stream: string) => {
        return Promise.resolve(stream === 'personal_bounty');
      });

      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-partial-retry',
            status: 'complete',
            assignee_id: 'usr-42',
            metadata: {
              commit_sha: 'sha-abcdef0123456789',
              bounty_hours: 0.20,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.upkeepTokensMinted).toBe(3000);
      expect(res.body.bountyTokensMinted).toBe(0); // Correctly reports 0 minted this request
    });

    it('handles concurrent retry unique constraint violation idempotently via DatabaseError (SEC-0005)', async () => {
      // Both lookup checks return false (race condition before insert)
      (mockGateway.findExistingWorkItemAward as any).mockResolvedValue(false);

      // creditWorkRebate throws DatabaseError with 23505 unique constraint violation
      (mockGateway.creditWorkRebate as any).mockRejectedValue(
        new DatabaseError(
          'duplicate key value violates unique constraint "idx_hub_tokens_ledger_work_item_stream"',
          {
            code: '23505',
            details:
              'Key ((metadata ->> work_item_id), (metadata ->> stream))=(task-concurrent, personal_bounty) already exists.',
          }
        )
      );

      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-concurrent',
            status: 'complete',
            assignee_id: 'usr-42',
            metadata: {
              commit_sha: 'sha-abcdef0123456789',
              bounty_hours: 0.20,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.upkeepTokensMinted).toBe(0);
      expect(res.body.bountyTokensMinted).toBe(0);
    });

    it('returns zero bounty tokens for unassigned tasks (BUG-0005)', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .send({
          item: {
            id: 'task-unassigned',
            status: 'complete',
            // No assignee_id and no claimantUserId
            metadata: { commit_sha: 'sha-abcdef0123456789' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isEligibleForUpkeep).toBe(true);
      expect(res.body.isEligibleForBounty).toBe(false);
      expect(res.body.bountyTokensMinted).toBe(0);
      expect(res.body.upkeepTokensMinted).toBe(3000);
      expect(res.body.reason).toContain('Work item is not assigned to a claimant');
    });

    it('honors fixed_reward_tokens over hours-based calculation (BUG-0004)', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-fixed-reward',
            status: 'complete',
            assignee_id: 'usr-42',
            metadata: {
              commit_sha: 'sha-abcdef0123456789',
              bounty_hours: 2.0,
              fixed_reward_tokens: 250000,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.bountyTokensMinted).toBe(250000);
    });

    it('rejects claimant spoofing when claimantUserId contradicts item assignee (SEC-0002)', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-impostor')
        .send({
          item: {
            id: 'task-spoof',
            status: 'complete',
            assignee_id: 'usr-legit',
            metadata: { commit_sha: 'sha-abcdef0123456789' },
          },
          claimantUserId: 'usr-impostor',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Claimant user ID does not match work item assignee');
    });

    it('rejects unauthenticated cross-user mint when x-user-id is omitted (SEC-0003)', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        // No x-user-id and no admin authorization
        .send({
          item: {
            id: 'task-unauth-mint',
            status: 'complete',
            assignee_id: 'usr-victim',
            metadata: { commit_sha: 'sha-abcdef0123456789' },
          },
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Caller identification header (x-user-id)');
    });

    it('validates bounty hours upfront before minting upkeep pool tokens (BUG-0003)', async () => {
      const res = await request(app)
        .post('/api/v1/mint/efficiency')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          item: {
            id: 'task-invalid-hours',
            status: 'complete',
            assignee_id: 'usr-42',
            metadata: {
              commit_sha: 'sha-abcdef0123456789',
              bounty_hours: -5.0, // Invalid
            },
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or non-positive bounty hours');
      // Upkeep credit must NOT have been called
      expect(mockGateway.creditWorkRebate).not.toHaveBeenCalled();
    });
  });

  describe('Exchanges & Wallet Rollups', () => {
    it('POST /api/v1/exchange/utility converts with 1.25x bonus', async () => {
      const res = await request(app)
        .post('/api/v1/exchange/utility')
        .set('x-api-key', TEST_API_KEY)
        .send({
          userId: 'usr-42',
          rebateTokens: 50000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.utilityTokensCredited).toBe(62500); // 50,000 * 1.25
      expect(res.body.bonusRatio).toBe(1.25);
    });

    it('POST /api/v1/exchange/burn burns utility tokens for authorized user', async () => {
      const res = await request(app)
        .post('/api/v1/exchange/burn')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-42')
        .send({
          userId: 'usr-42',
          amount: 10000,
          serviceName: 'cozy_sticker_pack',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.utilityTokensBurned).toBe(10000);
      expect(mockGateway.burnUtilityTokens).toHaveBeenCalledWith(
        'usr-42',
        10000,
        'cozy_sticker_pack',
        undefined,
        undefined
      );
    });

    it('rejects burn when caller header x-user-id is missing (SEC-0002)', async () => {
      const res = await request(app)
        .post('/api/v1/exchange/burn')
        .set('x-api-key', TEST_API_KEY)
        // No x-user-id
        .send({
          userId: 'usr-victim',
          amount: 5000,
          serviceName: 'sticker_burn',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Missing caller user identification header (x-user-id)');
    });

    it('rejects burning another user tokens without authorization (SEC-0002)', async () => {
      const res = await request(app)
        .post('/api/v1/exchange/burn')
        .set('x-api-key', TEST_API_KEY)
        .set('x-user-id', 'usr-different')
        .send({
          userId: 'usr-victim',
          amount: 5000,
          serviceName: 'sticker_burn',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cannot burn utility tokens from another user wallet');
    });

    it('GET /api/v1/wallets/:userId returns user wallet', async () => {
      const res = await request(app)
        .get('/api/v1/wallets/usr-42')
        .set('x-api-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.wallet.user_id).toBe('usr-42');
      expect(res.body.wallet.utility_balance).toBe(50000);
    });

    it('POST /api/v1/escrow/waterfall calculates monthly revenue waterfall and enriches wallet tax info (SEC-0007)', async () => {
      const res = await request(app)
        .post('/api/v1/escrow/waterfall')
        .set('x-api-key', TEST_API_KEY)
        .send({
          period: '2026-11',
          grossRevenueCents: 500000,
          escrowPercentage: 0.30,
          claims: [
            { userId: 'usr-42', tokensToRedeem: 60000, paypalEmail: 'tym@sunshade.icu' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.totalFiatApprovedCents).toBe(12500); // $125.00
      expect(mockGateway.getUserWallet).toHaveBeenCalledWith('usr-42');
    });
  });
});
