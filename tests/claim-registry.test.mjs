import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadClaimRegistry,
  getClaim,
  listClaims,
  isClaimUsable,
  requireClaim,
} from '../src/contracts/claim-registry.mjs';

const VALID_AUTHORITY = new Set(['current', 'provisional', 'withdrawn', 'missing']);
const VALID_INTEGRITY = new Set(['pass', 'partial', 'fail', 'not_applicable']);
const VALID_SEMANTIC = new Set(['pass', 'strong_support', 'resource_contract', 'provisional', 'fail', 'not_established', 'not_applicable']);
const VALID_REPLICATION = new Set(['cross_replay_replicated', 'multi_replay_supported', 'single_replay_only', 'resource_build_bound', 'not_replicated', 'not_applicable', 'pending']);

test('claim registry schema and IDs are internally consistent', () => {
  const registry = loadClaimRegistry();
  assert.equal(registry.version, 'CLAIM_AUTHORITY_REGISTRY_V03');
  assert.ok(Array.isArray(registry.claims));
  assert.ok(registry.claims.length >= 35);

  const ids = new Set();
  for (const claim of registry.claims) {
    assert.ok(claim.claimId && typeof claim.claimId === 'string');
    assert.ok(!ids.has(claim.claimId), `duplicate claimId ${claim.claimId}`);
    ids.add(claim.claimId);
    assert.ok(VALID_AUTHORITY.has(claim.authorityStatus), `${claim.claimId}: bad authorityStatus`);
    assert.ok(VALID_INTEGRITY.has(claim.integrityValidation), `${claim.claimId}: bad integrityValidation`);
    assert.ok(VALID_SEMANTIC.has(claim.semanticValidation), `${claim.claimId}: bad semanticValidation`);
    assert.ok(VALID_REPLICATION.has(claim.replicationStatus), `${claim.claimId}: bad replicationStatus`);
    assert.ok(Array.isArray(claim.sourceScripts), `${claim.claimId}: sourceScripts must be array`);
    assert.ok(Array.isArray(claim.currentArtifacts), `${claim.claimId}: currentArtifacts must be array`);
    assert.ok(Array.isArray(claim.downstreamUses), `${claim.claimId}: downstreamUses must be array`);
  }
});

test('withdrawn claims cannot be consumed as current authority', () => {
  const registry = loadClaimRegistry();
  const withdrawn = listClaims({ authorityStatus: 'withdrawn' }, registry);
  assert.ok(withdrawn.length > 0);
  for (const claim of withdrawn) assert.equal(isClaimUsable(claim), false, claim.claimId);
});

test('missing claims cannot be consumed as current authority', () => {
  const registry = loadClaimRegistry();
  const missing = listClaims({ authorityStatus: 'missing' }, registry);
  assert.ok(missing.length > 0);
  for (const claim of missing) assert.equal(isClaimUsable(claim), false, claim.claimId);
});

test('standard shop catalog is current and old exact vacuum threshold is withdrawn', () => {
  const registry = loadClaimRegistry();
  const shop = requireClaim('standard_shop_catalog_v02', { requireSemantic: true }, registry);
  assert.equal(shop.valueSummary.standardItemCount, 156);
  assert.deepEqual(shop.valueSummary.standardTierPrices, { '1': 800, '2': 1600, '3': 3200, '4': 6400 });

  const oldVacuum = getClaim('assigned_gold_exact_732_735hu_threshold', registry);
  assert.equal(oldVacuum.authorityStatus, 'withdrawn');
  assert.equal(isClaimUsable(oldVacuum), false);
});

test('replication-sensitive gate rejects single-replay authority', () => {
  const registry = loadClaimRegistry();
  const aim = getClaim('eye_angle_aim_orientation', registry);
  assert.equal(aim.replicationStatus, 'single_replay_only');
  assert.equal(isClaimUsable(aim, { requireReplication: true }), false);
});


test('Script139 V03 item-effect substrate remains current', () => {
  const registry = loadClaimRegistry();
  const effects = requireClaim('shop_item_effect_contract', { requireSemantic: true }, registry);
  assert.equal(effects.valueSummary.catalogRows, 156);
  assert.equal(effects.valueSummary.itemsWithWeaponEffectEvidence, 57);
  assert.equal(effects.valueSummary.itemsWithWeaponOperationEvidence, 35);
  assert.equal(effects.valueSummary.itemsWithWeaponDamageOrPowerEvidence, 33);

});


test('runtime item ownership is current cross-replay authority', () => {
  const registry = loadClaimRegistry();
  const ownership = requireClaim(
    'runtime_item_ownership',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(ownership.authorityStatus, 'current');
  assert.equal(ownership.replicationStatus, 'cross_replay_replicated');
  assert.equal(ownership.valueSummary.independentReplicationReplays, 5);
  assert.equal(ownership.valueSummary.semanticStrongReplays, 5);
  assert.equal(ownership.valueSummary.minStandardShopMappingRate, 1);
  assert.ok(ownership.valueSummary.weightedImmediateSpendAssociation8Ticks >= 0.99);
  assert.ok(ownership.valueSummary.weightedShiftedPlaceboAssociation32Ticks <= 0.03);
  assert.ok(ownership.valueSummary.weightedExactAmountAgreement >= 0.97);
});

test('runtime world-buff ownership remains unresolved after item ownership promotion', () => {
  const registry = loadClaimRegistry();
  for (const claimId of ['runtime_permanent_buff_ownership', 'runtime_bridge_buff_ownership']) {
    const claim = getClaim(claimId, registry);
    assert.equal(claim.authorityStatus, 'missing');
    assert.equal(isClaimUsable(claim), false);
  }
});
