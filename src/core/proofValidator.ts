import type { ItemVerificationProof, WorkItemRecord } from '../types';

const GIT_COMMIT_SHA_REGEX = /^(commit-|sha-)?[0-9a-f]{3,40}$/i;
const PR_URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*(\/pull\/|\/merge_requests?\/|\/pull-requests?\/)\d+/i;
const ZKP_PROOF_REGEX = /^[a-zA-Z0-9_\-]{8,128}$/;

/**
 * Validates whether a completed work item possesses verifiable artifact proof of execution.
 * Enforces strict anti-chore farming verification against git commit hashes, pull requests,
 * ZKP attestations, and structured AI telemetry logs.
 */
export function validateArtifactProof(item: WorkItemRecord): ItemVerificationProof {
  const ledgerMode = item.project_ledger_mode || 'standard_workspace';
  if (ledgerMode === 'personal_organizer') {
    return {
      hasArtifactProof: false,
      reason: 'Personal organizer items are strictly excluded from commercial verification and token minting.',
    };
  }

  const meta = item.metadata || {};

  // 1. Git Commit SHA / Hash (Single string or Array)
  if (meta.commit_sha && GIT_COMMIT_SHA_REGEX.test(String(meta.commit_sha).trim())) {
    return {
      hasArtifactProof: true,
      proofType: 'commit_sha',
      proofRef: String(meta.commit_sha).trim(),
    };
  }

  if (meta.commit_hash && GIT_COMMIT_SHA_REGEX.test(String(meta.commit_hash).trim())) {
    return {
      hasArtifactProof: true,
      proofType: 'commit_sha',
      proofRef: String(meta.commit_hash).trim(),
    };
  }

  if (Array.isArray(meta.commit_hashes)) {
    const validHash = meta.commit_hashes.find(
      (h) => typeof h === 'string' && GIT_COMMIT_SHA_REGEX.test(h.trim())
    );
    if (validHash) {
      return {
        hasArtifactProof: true,
        proofType: 'commit_sha',
        proofRef: String(validHash).trim(),
      };
    }
  }

  // 2. Pull Request URL or Number
  if (meta.pr_url && typeof meta.pr_url === 'string') {
    const trimmed = meta.pr_url.trim();
    if (PR_URL_REGEX.test(trimmed) || (trimmed.startsWith('http') && trimmed.includes('/pull/'))) {
      return {
        hasArtifactProof: true,
        proofType: 'pr_url',
        proofRef: trimmed,
      };
    }
  }

  if (Array.isArray(meta.pr_urls)) {
    const validUrl = meta.pr_urls.find(
      (u) =>
        typeof u === 'string' &&
        (PR_URL_REGEX.test(u.trim()) || (u.trim().startsWith('http') && u.includes('/pull/')))
    );
    if (validUrl) {
      return {
        hasArtifactProof: true,
        proofType: 'pr_url',
        proofRef: String(validUrl).trim(),
      };
    }
  }

  if (meta.pr_number !== undefined && meta.pr_number !== null) {
    const isNum = typeof meta.pr_number === 'number' && Number.isInteger(meta.pr_number) && meta.pr_number > 0;
    const isNumStr = typeof meta.pr_number === 'string' && /^\d+$/.test(meta.pr_number.trim()) && Number(meta.pr_number.trim()) > 0;
    if (isNum || isNumStr) {
      return {
        hasArtifactProof: true,
        proofType: 'pr_url',
        proofRef: String(meta.pr_number).trim(),
      };
    }
  }

  // 3. ZKP Attestation
  if (meta.zkp_attestation_id) {
    const s = String(meta.zkp_attestation_id).trim();
    if (ZKP_PROOF_REGEX.test(s) && !/^(true|false|null|undefined)$/i.test(s)) {
      return {
        hasArtifactProof: true,
        proofType: 'zkp_attestation_id',
        proofRef: s,
      };
    }
  }

  if (meta.zkp_hash) {
    const s = String(meta.zkp_hash).trim();
    if (ZKP_PROOF_REGEX.test(s) && !/^(true|false|null|undefined)$/i.test(s)) {
      return {
        hasArtifactProof: true,
        proofType: 'zkp_attestation_id',
        proofRef: s,
      };
    }
  }

  // 4. Structured AI Telemetry Logs (Array of non-empty telemetry run objects)
  if (
    Array.isArray(meta.ai_usage_logs) &&
    meta.ai_usage_logs.length > 0 &&
    typeof meta.ai_usage_logs[0] === 'object' &&
    meta.ai_usage_logs[0] !== null
  ) {
    return {
      hasArtifactProof: true,
      proofType: 'ai_usage_logs',
      proofRef: 'verified_telemetry_logs',
    };
  }

  return {
    hasArtifactProof: false,
    reason: 'Work item does not possess verifiable artifact proof (git commit, PR, ZKP attestation, or AI telemetry logs).',
  };
}
