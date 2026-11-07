export type TokenClass = 'utility_token' | 'work_rebate_token';

export type RedemptionPriorityTier = 'standard_contributor' | 'subordinated_house';

export type TransactionType =
  | 'SYSTEM_BOUNTY_ESCROW'
  | 'SYSTEM_PAYPAL_REDEMPTION'
  | 'UTILITY_CONVERSION'
  | 'PRESTIGE_OVERFLOW_DONATION'
  | 'ECOSYSTEM_SERVICE_BURN'
  | 'MANUAL_ADJUSTMENT'
  | 'LEGACY';

export type LedgerMode = 'standard_workspace' | 'audited_production' | 'personal_organizer';

export type ProofType =
  | 'commit_sha'
  | 'pr_url'
  | 'zkp_attestation_id'
  | 'ai_usage_logs';

export interface ItemVerificationProof {
  hasArtifactProof: boolean;
  proofType?: ProofType;
  proofRef?: string;
  reason?: string;
}

export interface WorkItemMetadata {
  commit_sha?: string;
  commit_hash?: string;
  commit_hashes?: string[];
  pr_url?: string;
  pr_urls?: string[];
  pr_number?: number | string;
  zkp_attestation_id?: string;
  zkp_hash?: string;
  ai_usage_logs?: Array<Record<string, any>>;
  has_ai_logs?: boolean;
  bounty_hours?: number;
  estimated_hours?: number;
  fixed_reward_tokens?: number;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  [key: string]: any;
}

export interface WorkItemRecord {
  id: string;
  project_id?: string;
  tenant_id?: string;
  title?: string;
  status: string;
  project_ledger_mode?: LedgerMode;
  metadata?: WorkItemMetadata;
  assignee?: string;
  assignee_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PricingQuote {
  workItemId?: string;
  baseHours: number;
  hourlyTokenRate: number; // 60,000 tokens/hr
  neglectMultiplier: number; // 1.0x to 3.5x
  isFixedReward: boolean;
  bountyTokens: number;
  tokensPerMinute: number;
  upkeepHours: number; // 0.05 hrs default
  upkeepTokens: number; // 3,000 tokens default
  daysNeglected: number;
}

export interface CapacityCheckOptions {
  claimantUserId: string;
  newTaskHours: number;
  existingWeeklyHours?: number;
  flexBankHoursAvailable?: number;
  allowOverride?: boolean;
  referenceDate?: Date | string;
}

export interface CapacityCheckResult {
  claimantUserId: string;
  isoWeek: string;
  claimedHoursThisWeek: number;
  newTaskHours: number;
  projectedTotalHours: number;
  maxWeeklyHours: number; // 20
  flexBankHoursAvailable: number; // up to 10
  effectiveCapacityCeiling: number; // 20 + flexBankHoursAvailable
  isPermitted: boolean;
  isOverridden: boolean;
  rejectionReason?: string;
}

export interface MintEfficiencyOptions {
  item: WorkItemRecord;
  claimantUserId?: string;
  systemPoolUserId?: string;
  neglectMultiplier?: number;
  vested?: boolean;
}

export interface MintEfficiencyResult {
  success: boolean;
  workItemId: string;
  tenantId?: string;
  projectId?: string;
  claimantUserId?: string;
  systemPoolUserId: string;
  isEligibleForBounty: boolean;
  isEligibleForUpkeep: boolean;
  bountyTokensMinted: number;
  upkeepTokensMinted: number;
  proof?: ItemVerificationProof;
  reason?: string;
  walletState?: UserTokenWallet;
}

export interface UtilityConversionOptions {
  userId: string;
  rebateTokens: number;
}

export interface UtilityConversionResult {
  success: boolean;
  userId: string;
  rebateTokensBurned: number;
  utilityTokensCredited: number;
  bonusRatio: number; // 1.25
  walletState?: UserTokenWallet;
}

export interface UtilityBurnOptions {
  userId: string;
  amount: number;
  serviceName: string;
  referenceId?: string;
  description?: string;
}

export interface UtilityBurnResult {
  success: boolean;
  userId: string;
  utilityTokensBurned: number;
  serviceName: string;
  referenceId?: string;
  walletState?: UserTokenWallet;
}

export interface UserTokenWallet {
  user_id: string;
  utility_balance: number;
  rebate_balance_vested: number;
  rebate_units_pending: number;
  lifetime_rebate_minted: number;
  prestige_overflow_donated: number;
  prestige_mentor_status: boolean;
  priority_tier: RedemptionPriorityTier;
  ytd_fiat_redeemed_cents: number;
  tax_compliance_verified: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HubTokenLedgerEntry {
  id?: string;
  user_id: string;
  counterparty_user_id?: string | null;
  token_class: TokenClass;
  transaction_type: TransactionType;
  amount: number;
  description?: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface EscrowWaterfallClaim {
  userId: string;
  tokensToRedeem: number;
  paypalEmail?: string;
  ytdFiatRedeemedCents?: number;
  taxComplianceVerified?: boolean;
}

export interface EscrowWaterfallOptions {
  period: string; // YYYY-MM
  grossRevenueCents: number;
  escrowPercentage?: number; // e.g. 0.30 (30%)
  claims: EscrowWaterfallClaim[];
}

export interface EscrowWaterfallPayout {
  userId: string;
  tokensRedeemed: number;
  payoutCents: number;
  paypalEmail?: string;
  status: 'approved' | 'rejected_insufficient_pool' | 'tax_compliance_locked';
  reason?: string;
}

export interface EscrowWaterfallResult {
  period: string;
  grossRevenueCents: number;
  escrowPoolCents: number;
  totalTokensRequested: number;
  totalFiatApprovedCents: number;
  remainingEscrowPoolCents: number;
  payouts: EscrowWaterfallPayout[];
}
