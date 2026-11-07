import type {
  PricingQuote,
  CapacityCheckResult,
  MintEfficiencyResult,
  UtilityConversionResult,
  UtilityBurnResult,
  UserTokenWallet,
  EscrowWaterfallResult,
  WorkItemRecord,
  EscrowWaterfallClaim,
} from '../types';

export interface BountyEngineClientOptions {
  baseUrl: string;
  apiKey?: string;
  adminKey?: string;
  userId?: string;
  fetchFn?: typeof fetch;
}

export class BountyEngineClient {
  private baseUrl: string;
  private apiKey?: string;
  private adminKey?: string;
  private userId?: string;
  private fetchFn: typeof fetch;

  constructor(options: BountyEngineClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.adminKey = options.adminKey;
    this.userId = options.userId;
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['x-api-key'] = this.apiKey;
    }

    if (this.adminKey) {
      headers['x-admin-key'] = this.adminKey;
    }

    if (this.userId && !headers['x-user-id']) {
      headers['x-user-id'] = this.userId;
    }

    const res = await this.fetchFn(url, {
      ...options,
      headers,
    });

    const data = (await res.json()) as any;
    if (!res.ok || data.success === false) {
      throw new Error(data.error || data.reason || `HTTP ${res.status}: Request failed.`);
    }

    return data as T;
  }

  /**
   * Health check
   */
  async getHealth(): Promise<{ status: string; service: string; version: string }> {
    return this.request('/api/v1/health');
  }

  /**
   * Get dynamic bounty pricing and neglect multiplier quote
   */
  async getQuote(params: {
    work_item_id?: string;
    bounty_hours?: number;
    estimated_hours?: number;
    created_at?: string;
    updated_at?: string;
    fixed_reward_tokens?: number;
  }): Promise<{ success: boolean; quote: PricingQuote }> {
    const qs = new URLSearchParams();
    if (params.work_item_id) qs.set('work_item_id', params.work_item_id);
    if (params.bounty_hours !== undefined) qs.set('bounty_hours', String(params.bounty_hours));
    if (params.estimated_hours !== undefined) qs.set('estimated_hours', String(params.estimated_hours));
    if (params.created_at) qs.set('created_at', params.created_at);
    if (params.updated_at) qs.set('updated_at', params.updated_at);
    if (params.fixed_reward_tokens !== undefined) qs.set('fixed_reward_tokens', String(params.fixed_reward_tokens));

    return this.request(`/api/v1/bounties/quote?${qs.toString()}`);
  }

  /**
   * Assert runner weekly capacity before claiming a bounty task
   */
  async claimBounty(params: {
    claimantUserId: string;
    newTaskHours: number;
    existingWeeklyHours?: number;
    flexBankHoursAvailable?: number;
    allowOverride?: boolean;
    callerUserId?: string;
  }): Promise<{ success: boolean; capacity: CapacityCheckResult }> {
    const callerId = params.callerUserId || params.claimantUserId || this.userId;
    const customHeaders: Record<string, string> = {};
    if (callerId) {
      customHeaders['x-user-id'] = callerId;
    }

    return this.request('/api/v1/bounties/claim', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify(params),
    });
  }

  /**
   * Mint efficiency yield (dual personal bounty & ecosystem upkeep pool)
   */
  async mintEfficiencyYield(params: {
    item: WorkItemRecord;
    claimantUserId?: string;
    systemPoolUserId?: string;
    neglectMultiplier?: number;
    vested?: boolean;
    callerUserId?: string;
  }): Promise<MintEfficiencyResult> {
    const callerId =
      params.callerUserId || params.claimantUserId || params.item.assignee_id || this.userId;
    const customHeaders: Record<string, string> = {};
    if (callerId) {
      customHeaders['x-user-id'] = callerId;
    }

    return this.request('/api/v1/mint/efficiency', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify(params),
    });
  }

  /**
   * Convert work rebate tokens to utility tokens at 1.25x bonus
   */
  async convertRebateToUtility(params: {
    userId: string;
    rebateTokens: number;
    callerUserId?: string;
  }): Promise<UtilityConversionResult> {
    const callerId = params.callerUserId || params.userId || this.userId;
    const customHeaders: Record<string, string> = {};
    if (callerId) {
      customHeaders['x-user-id'] = callerId;
    }

    return this.request('/api/v1/exchange/utility', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify(params),
    });
  }

  /**
   * Burn utility tokens for ecosystem services
   */
  async burnUtilityTokens(params: {
    userId: string;
    amount: number;
    serviceName: string;
    referenceId?: string;
    description?: string;
    callerUserId?: string;
  }): Promise<UtilityBurnResult> {
    const callerId = params.callerUserId || params.userId || this.userId;
    const customHeaders: Record<string, string> = {};
    if (callerId) {
      customHeaders['x-user-id'] = callerId;
    }

    return this.request('/api/v1/exchange/burn', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify(params),
    });
  }

  /**
   * Fetch user consolidated token wallet
   */
  async getWallet(userId: string): Promise<{ success: boolean; wallet: UserTokenWallet }> {
    return this.request(`/api/v1/wallets/${userId}`);
  }

  /**
   * Compute monthly revenue-gated PayPal escrow waterfall
   */
  async calculateEscrowWaterfall(params: {
    period: string;
    grossRevenueCents: number;
    escrowPercentage?: number;
    claims: EscrowWaterfallClaim[];
  }): Promise<{ success: boolean; result: EscrowWaterfallResult }> {
    return this.request('/api/v1/escrow/waterfall', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}
