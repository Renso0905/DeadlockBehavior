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

test('runtime permanent buff ownership is current cross-replay authority', () => {
  const registry = loadClaimRegistry();
  const permanent = requireClaim(
    'runtime_permanent_buff_ownership',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(permanent.authorityStatus, 'current');
  assert.equal(permanent.semanticValidation, 'pass');
  assert.equal(permanent.replicationStatus, 'cross_replay_replicated');
  assert.equal(permanent.valueSummary.independentReplicationReplays, 5);
  assert.equal(permanent.valueSummary.semanticConsistentReplays, 5);
  assert.equal(permanent.valueSummary.fullStrongReplays, 5);
  assert.equal(permanent.valueSummary.permanentFamilies, 6);
  assert.equal(permanent.valueSummary.permanentSourceCandidates, 18);
  assert.equal(permanent.valueSummary.positiveAccumulationEvents, 1297);
  assert.equal(permanent.valueSummary.exactAmountEvents, 1297);
  assert.equal(permanent.valueSummary.inferredPickupUnits, 1635);
  assert.equal(permanent.valueSummary.negativeInPlaceDeltas, 0);
  assert.equal(permanent.valueSummary.finalExactUnitMultiples, 619);
  assert.equal(permanent.valueSummary.finalValueRows, 619);
  assert.deepEqual(permanent.valueSummary.familyValueTypes, {
    ammo_permanent_pickup: 63,
    cd_permanent_pickup: 98,
    firerate_permanent_pickup: 91,
    hp_permanent_pickup: 43,
    spirit_permanent_pickup: 158,
    wp_permanent_pickup: 19,
  });
});

test('runtime bridge buff ownership is current cross-replay reconstructed authority', () => {
  const registry = loadClaimRegistry();
  const bridge = requireClaim(
    'runtime_bridge_buff_ownership',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(bridge.authorityStatus, 'current');
  assert.equal(bridge.integrityValidation, 'pass');
  assert.equal(bridge.semanticValidation, 'pass');
  assert.equal(bridge.replicationStatus, 'cross_replay_replicated');
  assert.equal(bridge.valueSummary.bridgePowerupTypes, 4);
  assert.equal(bridge.valueSummary.independentReplicationReplays, 5);
  assert.equal(bridge.valueSummary.semanticConsistentCollectionReplays, 5);
  assert.equal(bridge.valueSummary.collectionEvents, 76);
  assert.equal(bridge.valueSummary.collectorWithin300Count, 76);
  assert.equal(bridge.valueSummary.collectorWithin300Rate, 1);
  assert.equal(bridge.valueSummary.shiftedPlaceboWithin800Count, 2);
  assert.ok(bridge.valueSummary.shiftedPlaceboWithin800Rate <= 0.03);
  assert.equal(bridge.valueSummary.twoWaveCompleteBlocks, 12);
  assert.equal(bridge.valueSummary.twoWaveExactComplementBlocks, 12);
  assert.equal(bridge.valueSummary.sharedDurationSeconds, 160);
  assert.equal(bridge.valueSummary.directDurationConsequenceBuff, 'survival_powerup_pickup');
  assert.equal(bridge.valueSummary.survivalNaturalEvidenceReplays, 4);
  assert.equal(bridge.valueSummary.survivalUncensoredNaturalExpirations, 11);
  assert.equal(bridge.valueSummary.survivalValidatedNaturalExpirations, 11);
  assert.equal(bridge.valueSummary.survivalNaturalExpirationRate, 1);
  assert.equal(bridge.valueSummary.survivalDeathTerminationAnchors, 7);
  assert.equal(bridge.valueSummary.survivalDeathTerminationsObserved, 7);
  assert.equal(bridge.valueSummary.survivalDeathTerminationRate, 1);
  assert.equal(bridge.valueSummary.matchEndCensoredCandidates, 1);
  assert.ok(bridge.downstreamUses.includes('PlayerState(t)'));
  assert.ok(bridge.downstreamUses.includes('effective weapon state'));
  assert.match(bridge.scope, /Reconstructed per-player bridge-powerup intervals/);
  assert.match(bridge.scope, /PostGame censoring/);
  assert.match(bridge.notes, /directly serialized player-side bridge modifier ID was not established/);
  assert.match(bridge.notes, /Exact 5-to-40-minute bridge effect interpolation remains unresolved/);
});

test('permanent-buff authority no longer describes bridge runtime state as unresolved', () => {
  const registry = loadClaimRegistry();
  const permanent = requireClaim('runtime_permanent_buff_ownership', { requireSemantic: true, requireReplication: true }, registry);
  assert.match(permanent.notes, /Bridge powerups are tracked separately under runtime_bridge_buff_ownership/);
  assert.doesNotMatch(permanent.notes, /Bridge powerups remain a separate unresolved runtime claim/);
});

test('integrated PlayerState(t) is current cross-replay event-sourced authority', () => {
  const registry = loadClaimRegistry();
  const playerState = requireClaim(
    'player_state_t_v1',
    { requireSemantic: true, requireReplication: true },
    registry
  );

  assert.equal(playerState.authorityStatus, 'current');
  assert.equal(playerState.integrityValidation, 'pass');
  assert.equal(playerState.semanticValidation, 'pass');
  assert.equal(playerState.replicationStatus, 'cross_replay_replicated');
  assert.equal(playerState.valueSummary.independentReplicationReplays, 5);
  assert.equal(playerState.valueSummary.integrityPassReplays, 5);
  assert.equal(playerState.valueSummary.semanticPassReplays, 5);
  assert.equal(playerState.valueSummary.coverageCompleteReplays, 5);
  assert.equal(playerState.valueSummary.totalContradictions, 0);
  assert.equal(playerState.valueSummary.players, 60);
  assert.equal(playerState.valueSummary.timelineEvents, 604530);
  assert.equal(playerState.valueSummary.itemTransitions, 1518);
  assert.equal(playerState.valueSummary.bridgeIntervals, 76);
  assert.equal(playerState.valueSummary.permanentFamiliesAcrossCohort, 6);
  assert.equal(playerState.valueSummary.runtimeModel, 'event_sourced_latest_event_at_or_before_t');
  assert.equal(playerState.valueSummary.effectiveStatsComposed, false);
  assert.equal(playerState.valueSummary.effectiveWeaponStateEstablished, false);
  assert.ok(playerState.downstreamUses.includes('effective weapon state'));
  assert.match(playerState.scope, /latest authoritative event at or before t without future leakage/);
  assert.match(playerState.notes, /does not establish effective_weapon_state/);
});

test('effective weapon state remains unresolved after PlayerState(t) promotion', () => {
  const registry = loadClaimRegistry();
  const weapon = getClaim('effective_weapon_state', registry);
  assert.equal(weapon.authorityStatus, 'missing');
  assert.equal(isClaimUsable(weapon), false);
});
