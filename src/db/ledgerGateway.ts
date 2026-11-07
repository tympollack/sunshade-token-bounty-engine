import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabaseClient';
import type { UserTokenWallet, HubTokenLedgerEntry } from '../types';

export class LedgerGateway {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client || getSupabaseAdmin();
  }

  /**
   * Fetches the user token wallet rollup, creating it if it does not exist yet.
   */
  async getUserWallet(userId: string): Promise<UserTokenWallet> {
    const { data, error } = await this.client
      .from('user_token_wallets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch wallet for user ${userId}: ${error.message}`);
    }

    if (!data) {
      // Upsert empty initial wallet idempotently to prevent concurrent duplicate key collisions
      const newWallet: Partial<UserTokenWallet> = {
        user_id: userId,
        utility_balance: 0,
        rebate_balance_vested: 0,
        rebate_units_pending: 0,
        lifetime_rebate_minted: 0,
        prestige_overflow_donated: 0,
        prestige_mentor_status: false,
        priority_tier: 'standard_contributor',
        ytd_fiat_redeemed_cents: 0,
        tax_compliance_verified: false,
      };

      const { data: created, error: createErr } = await this.client
        .from('user_token_wallets')
        .upsert(newWallet, { onConflict: 'user_id', ignoreDuplicates: true })
        .select('*')
        .maybeSingle();

      if (created) {
        return created as UserTokenWallet;
      }

      // If already created concurrently, refetch
      const { data: refetched } = await this.client
        .from('user_token_wallets')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (refetched) {
        return refetched as UserTokenWallet;
      }

      if (createErr) {
        throw new Error(`Failed to initialize wallet for user ${userId}: ${createErr.message}`);
      }
    }

    return data as UserTokenWallet;
  }

  /**
   * Authoritatively credits work-rebate tokens via the database RPC with 1B Prestige Cap protection.
   */
  async creditWorkRebate(
    userId: string,
    amount: number,
    description: string = 'Bounty Work-Rebate Award',
    vested: boolean = true,
    metadata: Record<string, any> = {}
  ): Promise<UserTokenWallet> {
    const { data, error } = await this.client.rpc('credit_work_rebate', {
      p_user_id: userId,
      p_amount: amount,
      p_description: description,
      p_vested: vested,
      p_metadata: metadata,
    });

    if (error) {
      throw new Error(`Failed to credit work rebate to user ${userId}: ${error.message}`);
    }

    return data as UserTokenWallet;
  }

  /**
   * Converts pending work-rebate tokens into vested tokens via the database RPC.
   */
  async vestPendingWorkRebates(userId: string, amount: number): Promise<UserTokenWallet> {
    const { data, error } = await this.client.rpc('vest_pending_work_rebates', {
      p_user_id: userId,
      p_amount: amount,
    });

    if (error) {
      throw new Error(`Failed to vest work rebates for user ${userId}: ${error.message}`);
    }

    return data as UserTokenWallet;
  }

  /**
   * Converts vested work-rebates to utility tokens with 1.25x bonus via the database RPC.
   */
  async convertRebateToUtility(
    userId: string,
    rebateTokens: number
  ): Promise<{ wallet: UserTokenWallet; utility_tokens_credited: number }> {
    const { data, error } = await this.client.rpc('convert_rebate_to_utility', {
      p_user_id: userId,
      p_rebate_tokens: rebateTokens,
    });

    if (error) {
      throw new Error(`Failed to convert rebate tokens for user ${userId}: ${error.message}`);
    }

    return {
      wallet: data.wallet as UserTokenWallet,
      utility_tokens_credited: data.utility_tokens_credited,
    };
  }

  /**
   * Burns utility tokens for in-app goods, stickers, Makerverse fees, or workspace grants.
   * Executes atomically via the database RPC with row locking and ledger insertion.
   */
  async burnUtilityTokens(
    userId: string,
    amount: number,
    serviceName: string,
    referenceId?: string,
    description?: string
  ): Promise<UserTokenWallet> {
    const { data, error } = await this.client.rpc('burn_utility_tokens', {
      p_user_id: userId,
      p_amount: amount,
      p_service_name: serviceName,
      p_reference_id: referenceId ?? null,
      p_description: description ?? null,
    });

    if (error) {
      throw new Error(`Failed to burn utility tokens for user ${userId}: ${error.message}`);
    }

    return data as UserTokenWallet;
  }

  /**
   * Checks whether an award has already been recorded for a specific work item and stream.
   * Prevents duplicate minting on network retries. Throws on database failure to avoid duplicate awards.
   */
  async findExistingWorkItemAward(
    workItemId: string,
    stream: 'personal_bounty' | 'triage_upkeep'
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from('hub_tokens_ledger')
      .select('id')
      .contains('metadata', { work_item_id: workItemId, stream })
      .limit(1);

    if (error) {
      throw new Error(
        `Failed to query existing work item award for item ${workItemId} (${stream}): ${error.message}`
      );
    }

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response when querying prior award for work item ${workItemId}.`);
    }

    return data.length > 0;
  }

  /**
   * Appends an entry directly to public.hub_tokens_ledger.
   */
  async appendLedgerEntry(entry: HubTokenLedgerEntry): Promise<void> {
    const { error } = await this.client.from('hub_tokens_ledger').insert({
      user_id: entry.user_id,
      counterparty_user_id: entry.counterparty_user_id || null,
      token_class: entry.token_class,
      transaction_type: entry.transaction_type,
      amount: entry.amount,
      description: entry.description,
      metadata: entry.metadata || {},
    });

    if (error) {
      throw new Error(`Failed to append transaction to hub_tokens_ledger: ${error.message}`);
    }
  }
}
