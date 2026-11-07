import { describe, it, expect } from 'vitest';
import { validateArtifactProof } from '../src/core/proofValidator';
import type { WorkItemRecord } from '../src/types';

describe('Proof Validator (Anti-Chore Farming & Verifiable Artifacts)', () => {
  it('strictly excludes personal_organizer items regardless of metadata claims', () => {
    const choreItem: WorkItemRecord = {
      id: 'chore-1',
      status: 'complete',
      project_ledger_mode: 'personal_organizer',
      metadata: {
        commit_sha: 'commit-1234567890abcdef',
        pr_url: 'https://github.com/sunshade/app/pull/10',
      },
    };

    const res = validateArtifactProof(choreItem);
    expect(res.hasArtifactProof).toBe(false);
    expect(res.reason).toContain('Personal organizer items are strictly excluded');
  });

  it('validates single git commit SHAs (hex 3-40 chars and prefixed tags)', () => {
    const item1: WorkItemRecord = {
      id: 'task-sha1',
      status: 'done',
      metadata: { commit_sha: 'commit-fedcba9876543210' },
    };
    expect(validateArtifactProof(item1).hasArtifactProof).toBe(true);
    expect(validateArtifactProof(item1).proofType).toBe('commit_sha');

    const item2: WorkItemRecord = {
      id: 'task-sha2',
      status: 'done',
      metadata: { commit_hash: 'abc1234' },
    };
    expect(validateArtifactProof(item2).hasArtifactProof).toBe(true);
    expect(validateArtifactProof(item2).proofType).toBe('commit_sha');
  });

  it('validates array of commit hashes and selects the valid hash', () => {
    const item: WorkItemRecord = {
      id: 'task-arr',
      status: 'complete',
      metadata: { commit_hashes: ['invalid_hash', '0123456789abcdef'] },
    };
    const res = validateArtifactProof(item);
    expect(res.hasArtifactProof).toBe(true);
    expect(res.proofRef).toBe('0123456789abcdef');
  });

  it('validates PR URLs and numeric PR IDs', () => {
    const itemUrl: WorkItemRecord = {
      id: 'task-pr1',
      status: 'done',
      metadata: { pr_url: 'https://github.com/tympollack/sunshade-tracker/pull/143' },
    };
    expect(validateArtifactProof(itemUrl).hasArtifactProof).toBe(true);
    expect(validateArtifactProof(itemUrl).proofType).toBe('pr_url');

    const itemNum: WorkItemRecord = {
      id: 'task-pr2',
      status: 'done',
      metadata: { pr_number: 144 },
    };
    expect(validateArtifactProof(itemNum).hasArtifactProof).toBe(true);
    expect(validateArtifactProof(itemNum).proofRef).toBe('144');
  });

  it('validates ZKP attestation IDs and hashes', () => {
    const item: WorkItemRecord = {
      id: 'task-zkp',
      status: 'complete',
      metadata: { zkp_attestation_id: 'zkp_proof_verified_999888' },
    };
    const res = validateArtifactProof(item);
    expect(res.hasArtifactProof).toBe(true);
    expect(res.proofType).toBe('zkp_attestation_id');
  });

  it('validates structured AI telemetry logs and rejects empty arrays or boolean flags', () => {
    const validAiItem: WorkItemRecord = {
      id: 'task-ai',
      status: 'complete',
      metadata: {
        ai_usage_logs: [{ session_id: 'sess-1', tokens: 4200, duration_ms: 12000 }],
      },
    };
    expect(validateArtifactProof(validAiItem).hasArtifactProof).toBe(true);
    expect(validateArtifactProof(validAiItem).proofType).toBe('ai_usage_logs');

    const fakeAiItem: WorkItemRecord = {
      id: 'task-fake-ai',
      status: 'complete',
      metadata: { has_ai_logs: true, ai_usage_logs: [] },
    };
    expect(validateArtifactProof(fakeAiItem).hasArtifactProof).toBe(false);
  });

  it('rejects items with empty or malformed metadata', () => {
    const emptyItem: WorkItemRecord = {
      id: 'task-empty',
      status: 'complete',
      metadata: {},
    };
    expect(validateArtifactProof(emptyItem).hasArtifactProof).toBe(false);
  });
});
