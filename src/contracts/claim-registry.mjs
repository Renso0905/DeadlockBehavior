import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CLAIM_REGISTRY_PATH = path.resolve(__dirname, '../../contracts/claim_registry_v03.json');

export function loadClaimRegistry(registryPath = DEFAULT_CLAIM_REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

export function indexClaims(registry) {
  return new Map(registry.claims.map((claim) => [claim.claimId, claim]));
}

export function getClaim(claimId, registry = loadClaimRegistry()) {
  const claim = indexClaims(registry).get(claimId);
  if (!claim) throw new Error(`Unknown claimId: ${claimId}`);
  return claim;
}

export function listClaims({ authorityStatus = null, domain = null } = {}, registry = loadClaimRegistry()) {
  return registry.claims.filter((claim) => {
    if (authorityStatus && claim.authorityStatus !== authorityStatus) return false;
    if (domain && claim.domain !== domain) return false;
    return true;
  });
}

export function isClaimUsable(claim, {
  requireSemantic = true,
  requireReplication = false,
  allowProvisional = false,
} = {}) {
  if (claim.authorityStatus === 'withdrawn' || claim.authorityStatus === 'missing') return false;
  if (!allowProvisional && claim.authorityStatus !== 'current') return false;
  if (claim.integrityValidation === 'fail') return false;
  if (requireSemantic && !['pass', 'strong_support', 'resource_contract'].includes(claim.semanticValidation)) return false;
  if (requireReplication && !['cross_replay_replicated', 'multi_replay_supported', 'resource_build_bound'].includes(claim.replicationStatus)) return false;
  return true;
}

export function requireClaim(claimId, options = {}, registry = loadClaimRegistry()) {
  const claim = getClaim(claimId, registry);
  if (!isClaimUsable(claim, options)) {
    throw new Error(
      `Claim ${claimId} is not usable under requested policy: authority=${claim.authorityStatus}, ` +
      `integrity=${claim.integrityValidation}, semantic=${claim.semanticValidation}, replication=${claim.replicationStatus}`
    );
  }
  return claim;
}
