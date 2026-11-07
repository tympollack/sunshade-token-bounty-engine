export const TOKEN_PER_HOUR = 60000;
export const TOKEN_PER_MINUTE = 1000;

export const WEEKLY_SOVEREIGN_HOURS_CAP = 20;
export const WEEKLY_SOVEREIGN_TOKEN_TARGET = 1200000; // 20 hrs * 60,000 tokens/hr
export const MAX_FLEX_BANK_HOURS = 10; // Up to 10 hours banked from previous weeks

export const PRESTIGE_CAP_TOKENS = 1000000000; // 1 Billion tokens career cap (~20 years at 1.2M/wk)

export const TRIAGE_UPKEEP_HOURS_PER_ITEM = 0.05; // 3 minutes = 3,000 tokens
export const AUTONOMOUS_BOUNTY_HOURS_PER_ITEM = 0.20; // 12 minutes = 12,000 tokens baseline
export const MAX_BOUNTY_HOURS_PER_ITEM = 40.0; // Maximum allowed hours per single work item
export const MAX_BOUNTY_TOKENS_PER_ITEM = 8400000; // 40h * 60,000 * 3.5 max neglect multiplier ceiling

export const MIN_NEGLECT_MULTIPLIER = 1.0;
export const MAX_NEGLECT_MULTIPLIER = 3.5;
export const NEGLECT_THRESHOLD_DAYS = 7; // Days without activity before multiplier accelerates

export const UTILITY_BONUS_RATIO = 1.25; // 25% internal utility conversion bonus

export const SYSTEM_ECOSYSTEM_POOL_USER_ID = '00000000-0000-0000-0000-000000000001';

export const IRS_1099_NEC_THRESHOLD_CENTS = 59900; // $599.00 tax compliance gate

export const COMPLETION_STATUSES = new Set(['complete', 'completed', 'done', 'closed', 'resolved']);
